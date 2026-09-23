import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ActionError } from "@/lib/actions";
import { notify } from "@/lib/notify";

const { conversations: C, conversationMembers: CM, messages: M, groups: G, groupMembers: GM, users: U, files: F } = schema;

type Rows<T> = { rows: T[] };
const rowsOf = <T,>(r: unknown) => (r as Rows<T>).rows;

/**
 * Every group has one conversation (CM-05). Members are the group's members;
 * users who can post announcements can open and write to any group (CM-02).
 */
export async function syncGroupConversations(userId: string, anyGroup: boolean) {
  const groupRows = anyGroup
    ? await db.select({ id: G.id, name: G.name }).from(G)
    : await db.select({ id: G.id, name: G.name }).from(GM).innerJoin(G, eq(G.id, GM.groupId)).where(eq(GM.userId, userId));
  for (const g of groupRows) {
    const key = `group:${g.id}`;
    await db.insert(C).values({ kind: "group", groupId: g.id, title: g.name, directKey: key }).onConflictDoNothing({ target: C.directKey });
    const [conv] = await db.select({ id: C.id, title: C.title }).from(C).where(eq(C.directKey, key));
    if (conv.title !== g.name) await db.update(C).set({ title: g.name }).where(eq(C.id, conv.id));
    const members = await db.select({ userId: GM.userId }).from(GM).where(eq(GM.groupId, g.id));
    const ids = new Set(members.map((m) => m.userId));
    if (anyGroup) ids.add(userId);
    if (ids.size) await db.insert(CM).values([...ids].map((u) => ({ conversationId: conv.id, userId: u }))).onConflictDoNothing();
  }
}

export async function getOrCreateDirect(a: string, b: string) {
  if (a === b) throw new ActionError("Choose someone other than yourself.");
  const [other] = await db.select({ id: U.id }).from(U).where(and(eq(U.id, b), eq(U.status, "active")));
  if (!other) throw new ActionError("That person is not available.");
  const key = [a, b].sort().join(":");
  await db.insert(C).values({ kind: "direct", directKey: key, createdBy: a }).onConflictDoNothing({ target: C.directKey });
  const [conv] = await db.select({ id: C.id }).from(C).where(eq(C.directKey, key));
  await db.insert(CM).values([{ conversationId: conv.id, userId: a }, { conversationId: conv.id, userId: b }]).onConflictDoNothing();
  return conv.id;
}

export type ConversationRow = {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  lastMessageAt: Date | null;
  unread: number;
  lastBody: string | null;
  otherName: string | null;
  memberCount: number;
};

export async function listConversations(userId: string): Promise<ConversationRow[]> {
  const res = await db.execute(sql`
    select c.id, c.kind, c.title, c.last_message_at as "lastMessageAt",
      (select count(*)::int from messages m
         where m.conversation_id = c.id and m.sender_id is distinct from ${userId}::uuid
           and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)) as unread,
      (select m.body from messages m where m.conversation_id = c.id order by m.created_at desc limit 1) as "lastBody",
      (select u.name from conversation_members o join users u on u.id = o.user_id
         where o.conversation_id = c.id and o.user_id <> ${userId}::uuid order by u.name limit 1) as "otherName",
      (select count(*)::int from conversation_members o where o.conversation_id = c.id) as "memberCount"
    from conversation_members cm
    join conversations c on c.id = cm.conversation_id
    where cm.user_id = ${userId}::uuid
    order by c.last_message_at desc nulls last, c.created_at desc`);
  return rowsOf<ConversationRow>(res).map((r) => ({ ...r, lastMessageAt: r.lastMessageAt ? new Date(r.lastMessageAt) : null, unread: Number(r.unread), memberCount: Number(r.memberCount) }));
}

export async function unreadMessageCount(userId: string) {
  const res = await db.execute(sql`
    select coalesce(sum((select count(*) from messages m
      where m.conversation_id = cm.conversation_id and m.sender_id is distinct from ${userId}::uuid
        and m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz))), 0)::int as n
    from conversation_members cm where cm.user_id = ${userId}::uuid`);
  return Number(rowsOf<{ n: number }>(res)[0]?.n ?? 0);
}

export async function isMember(conversationId: string, userId: string) {
  const [m] = await db.select({ u: CM.userId }).from(CM).where(and(eq(CM.conversationId, conversationId), eq(CM.userId, userId)));
  return Boolean(m);
}

export async function loadThread(conversationId: string, userId: string) {
  if (!(await isMember(conversationId, userId))) return null;
  const [conv] = await db.select().from(C).where(eq(C.id, conversationId));
  const [members, messages] = await Promise.all([
    db.select({ id: U.id, name: U.name }).from(CM).innerJoin(U, eq(U.id, CM.userId)).where(eq(CM.conversationId, conversationId)).orderBy(asc(U.name)),
    db
      .select({ id: M.id, body: M.body, createdAt: M.createdAt, senderId: M.senderId, sender: U.name, fileId: M.fileId, fileName: F.name, fileSize: F.size })
      .from(M)
      .leftJoin(U, eq(U.id, M.senderId))
      .leftJoin(F, eq(F.id, M.fileId))
      .where(eq(M.conversationId, conversationId))
      .orderBy(sql`${M.createdAt} desc`)
      .limit(200),
  ]);
  await db.update(CM).set({ lastReadAt: new Date() }).where(and(eq(CM.conversationId, conversationId), eq(CM.userId, userId)));
  return { conversation: conv, members, messages: messages.reverse() };
}

export async function sendMessage(opts: { conversationId: string; senderId: string; senderName: string; body: string; file?: { name: string; mime: string; data: Buffer } | null }) {
  const body = opts.body.trim().slice(0, 5000);
  if (!body && !opts.file) throw new ActionError("Write a message or attach a file.");
  if (!(await isMember(opts.conversationId, opts.senderId))) throw new ActionError("You are not part of this conversation.");

  return db.transaction(async (tx) => {
    let fileId: string | null = null;
    if (opts.file) {
      const [f] = await tx.insert(F).values({ name: opts.file.name.slice(0, 255), mime: opts.file.mime, size: opts.file.data.byteLength, data: opts.file.data, uploadedBy: opts.senderId }).returning({ id: F.id });
      fileId = f.id;
    }
    const now = new Date();
    const [msg] = await tx.insert(M).values({ conversationId: opts.conversationId, senderId: opts.senderId, body: body || "(attachment)", fileId }).returning({ id: M.id });
    await tx.update(C).set({ lastMessageAt: now }).where(eq(C.id, opts.conversationId));
    await tx.update(CM).set({ lastReadAt: now }).where(and(eq(CM.conversationId, opts.conversationId), eq(CM.userId, opts.senderId)));

    // one unread notification per conversation per person, not one per message
    const link = `/messages?c=${opts.conversationId}`;
    const others = (await tx.select({ userId: CM.userId }).from(CM).where(eq(CM.conversationId, opts.conversationId))).map((m) => m.userId).filter((u) => u !== opts.senderId);
    if (others.length) {
      const already = await tx
        .select({ userId: schema.notifications.userId })
        .from(schema.notifications)
        .where(and(inArray(schema.notifications.userId, others), eq(schema.notifications.link, link), isNull(schema.notifications.readAt)));
      const have = new Set(already.map((a) => a.userId));
      const [conv] = await tx.select({ kind: C.kind, title: C.title }).from(C).where(eq(C.id, opts.conversationId));
      await notify(
        tx,
        others.filter((u) => !have.has(u)),
        { type: "message", title: conv.kind === "group" ? `New message in ${conv.title}` : `Message from ${opts.senderName}`, body: body.slice(0, 140) || undefined, link },
      );
    }
    return msg.id;
  });
}

export async function searchMessages(userId: string, q: string) {
  const like = `%${q.replace(/[%_]/g, "\\$&")}%`;
  const res = await db.execute(sql`
    select m.id, m.body, m.created_at as "createdAt", m.conversation_id as "conversationId", u.name as sender,
      coalesce(c.title, (select u2.name from conversation_members o join users u2 on u2.id = o.user_id
        where o.conversation_id = c.id and o.user_id <> ${userId}::uuid limit 1)) as "conversation"
    from messages m
    join conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = ${userId}::uuid
    join conversations c on c.id = m.conversation_id
    left join users u on u.id = m.sender_id
    where m.body ilike ${like}
    order by m.created_at desc
    limit 50`);
  return rowsOf<{ id: string; body: string; createdAt: Date; conversationId: string; sender: string | null; conversation: string | null }>(res).map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
}
