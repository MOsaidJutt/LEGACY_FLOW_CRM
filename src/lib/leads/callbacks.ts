import "server-only";
import { and, eq, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { notify } from "@/lib/notify";

const REMIND_BEFORE_MS = 5 * 60_000;

/** Sends one "callback due" notification per callback, five minutes before it is due. */
export async function processCallbackReminders() {
  const due = await db
    .select({
      id: schema.callbacks.id,
      agentId: schema.callbacks.agentId,
      leadId: schema.callbacks.leadId,
      dueAt: schema.callbacks.dueAt,
      company: schema.leads.company,
      contact: schema.leads.contactName,
    })
    .from(schema.callbacks)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.callbacks.leadId))
    .where(
      and(
        eq(schema.callbacks.status, "pending"),
        isNull(schema.callbacks.remindedAt),
        lte(schema.callbacks.dueAt, new Date(Date.now() + REMIND_BEFORE_MS)),
      ),
    )
    .limit(200);

  for (const cb of due) {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(schema.callbacks)
        .set({ remindedAt: new Date() })
        .where(and(eq(schema.callbacks.id, cb.id), isNull(schema.callbacks.remindedAt)))
        .returning({ id: schema.callbacks.id });
      if (!claimed) return;
      const overdue = cb.dueAt.getTime() < Date.now();
      await notify(tx, [cb.agentId], {
        type: overdue ? "callback_overdue" : "callback_due",
        title: `${overdue ? "Overdue callback" : "Callback due"}: ${cb.company ?? cb.contact ?? "lead"}`,
        link: `/agent/calls?view=follow_up&lead=${cb.leadId}`,
      });
    });
  }
  return due.length;
}
