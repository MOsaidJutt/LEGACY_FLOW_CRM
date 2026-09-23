import type { Metadata } from "next";
import { asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PageHeader, Panel, EmptyState } from "@/components/ui/layout";
import { Badge } from "@/components/ui/badge";
import { AckButton, AnnouncementForm } from "./announcements-client";

export const metadata: Metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const user = await requirePermission("messages.use", "announcements.post");
  const canPost = user.permissions.includes("announcements.post");
  const tz = (await getSettings()).businessTimezone;
  const { announcements: A, announcementAcks: K, groups, groupMembers, users } = schema;

  const myGroups = (await db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, user.id))).map((g) => g.id);
  const visible = canPost ? undefined : or(isNull(A.groupId), myGroups.length ? inArray(A.groupId, myGroups) : undefined, eq(A.authorId, user.id));

  const [rows, groupRows, activeUsers, members] = await Promise.all([
    db.select({ a: A, author: users.name, group: groups.name }).from(A).leftJoin(users, eq(users.id, A.authorId)).leftJoin(groups, eq(groups.id, A.groupId)).where(visible).orderBy(desc(A.createdAt)).limit(50),
    db.select({ id: groups.id, name: groups.name }).from(groups).orderBy(asc(groups.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")),
    db.select().from(groupMembers),
  ]);
  const ids = rows.map((r) => r.a.id);
  const acks = ids.length ? await db.select().from(K).where(inArray(K.announcementId, ids)) : [];
  const nameOf = new Map(activeUsers.map((u) => [u.id, u.name]));

  return (
    <>
      <PageHeader title="Announcements" description="Notices from Management and Admin. Some ask you to confirm you have read them." />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {rows.length === 0 ? (
            <div className="rounded-lg border border-line bg-raised">
              <EmptyState icon={Megaphone} title="No announcements yet" />
            </div>
          ) : null}
          {rows.map(({ a, author, group }) => {
            const mineAcked = acks.some((k) => k.announcementId === a.id && k.userId === user.id);
            const audience = (a.groupId ? members.filter((m) => m.groupId === a.groupId).map((m) => m.userId) : activeUsers.map((u) => u.id)).filter((id) => id !== a.authorId);
            const ackedIds = new Set(acks.filter((k) => k.announcementId === a.id).map((k) => k.userId));
            const waiting = audience.filter((id) => !ackedIds.has(id));
            return (
              <article key={a.id} className="rounded-lg border border-line bg-raised p-5">
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-[15px] font-semibold">{a.title}</h2>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {author ?? "Former user"} · {formatDateTime(a.createdAt, tz)} · {group ? `To ${group}` : "To everyone"}
                    </p>
                  </div>
                  {a.requiresAck ? (
                    a.authorId === user.id || canPost ? (
                      <Badge tone={waiting.length ? "warning" : "success"}>
                        {audience.length - waiting.length} of {audience.length} acknowledged
                      </Badge>
                    ) : mineAcked ? (
                      <Badge tone="success">Acknowledged</Badge>
                    ) : (
                      <AckButton id={a.id} />
                    )
                  ) : null}
                </header>
                <p className="mt-3 max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed text-ink">{a.body}</p>
                {a.requiresAck && canPost && waiting.length ? (
                  <details className="mt-3 text-[13px] text-ink-3">
                    <summary className="cursor-pointer hover:text-ink">Not yet acknowledged</summary>
                    <p className="mt-1">{waiting.map((id) => nameOf.get(id)).filter(Boolean).join(", ")}</p>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
        {canPost ? (
          <Panel title="Post an announcement" className="xl:sticky xl:top-6">
            <AnnouncementForm groups={groupRows} />
          </Panel>
        ) : null}
      </div>
    </>
  );
}

