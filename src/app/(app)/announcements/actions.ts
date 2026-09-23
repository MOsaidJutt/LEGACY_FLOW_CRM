"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, formString, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

export async function postAnnouncementAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize("announcements.post");
    const title = formString(formData, "title").slice(0, 160);
    const body = formString(formData, "body").slice(0, 5000);
    const groupRaw = formString(formData, "groupId");
    const groupId = /^[0-9a-f-]{36}$/i.test(groupRaw) ? groupRaw : null;
    const requiresAck = formData.get("requiresAck") === "on";
    if (title.length < 3 || body.length < 3) return { error: "Add a title and a message." };

    await db.transaction(async (tx) => {
      const [a] = await tx.insert(schema.announcements).values({ title, body, groupId, requiresAck, authorId: user.id }).returning({ id: schema.announcements.id });
      const audience = groupId
        ? (await tx.select({ id: schema.groupMembers.userId }).from(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId))).map((r) => r.id)
        : (await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.status, "active"))).map((r) => r.id);
      await notify(
        tx,
        audience.filter((id) => id !== user.id),
        { type: "announcement", title: `${requiresAck ? "Please acknowledge: " : "Announcement: "}${title}`, body: body.slice(0, 140), link: "/announcements" },
      );
      await audit({ actorId: user.id, action: "announcement_posted", module: "messages", entityType: "announcement", entityId: a.id, after: { title, groupId, requiresAck, audience: audience.length } }, tx);
    });
    revalidatePath("/announcements");
    return { ok: true, message: "Announcement posted." };
  } catch (error) {
    return failure(error);
  }
}

export async function acknowledgeAction(announcementId: string): Promise<ActionState> {
  try {
    const user = await authorize();
    await db.insert(schema.announcementAcks).values({ announcementId, userId: user.id }).onConflictDoNothing();
    revalidatePath("/announcements");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
