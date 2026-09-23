import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { ActionError } from "@/lib/actions";
import { planDial, type DialPlan } from "@/lib/dialer";
import { recordEvent } from "@/lib/monitoring/events";
import { formatPhone } from "@/lib/phone";
import { getSettings } from "@/lib/settings";

const { leads, calls, callbacks, dispositions, leadActivities, dncNumbers } = schema;

type Agent = { id: string; sessionId: string };

/** A lead the agent may work on: locked to them and still open. */
export async function getWorkingLead(agentId: string, leadId: string) {
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.assignedTo, agentId), inArray(leads.status, ["assigned", "follow_up"])))
    .limit(1);
  return lead ?? null;
}

export async function isOnDncList(phoneE164: string | null) {
  if (!phoneE164) return false;
  const [row] = await db.select({ p: dncNumbers.phoneE164 }).from(dncNumbers).where(eq(dncNumbers.phoneE164, phoneE164)).limit(1);
  return Boolean(row);
}

export async function startCall(agent: Agent, leadId: string): Promise<{ callId: string; startedAt: Date; plan: DialPlan; phone: string; digits: string }> {
  const lead = await getWorkingLead(agent.id, leadId);
  if (!lead) throw new ActionError("This lead is no longer in your list.");
  if (!lead.phoneE164) throw new ActionError("This lead has no valid U.S. phone number.");
  if (await isOnDncList(lead.phoneE164)) throw new ActionError("This number is on the do-not-call list.");

  const settings = await getSettings();
  const plan = await planDial(settings.dialer, { phoneE164: lead.phoneE164, agentId: agent.id, leadId });
  const method = plan.method;

  const call = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(calls)
      .values({ leadId, agentId: agent.id, phone: lead.phoneE164, method, externalId: plan.method === "dialer" ? plan.externalId : null })
      .returning();
    await tx
      .update(leads)
      .set({ lastCalledAt: row.startedAt, callCount: sql`${leads.callCount} + 1` })
      .where(eq(leads.id, leadId));
    await tx.insert(leadActivities).values({
      leadId,
      userId: agent.id,
      type: "call",
      summary: method === "dialer" ? "Call placed through VC Dialer" : "Call started",
      data: { callId: row.id, method },
    });
    await recordEvent(tx, {
      userId: agent.id,
      sessionId: agent.sessionId,
      type: "call_start",
      summary: `Called ${lead.company ?? lead.contactName ?? "a lead"}`,
      meta: { leadId, callId: row.id, method },
    });
    return row;
  });

  return { callId: call.id, startedAt: call.startedAt, plan, phone: formatPhone(lead.phoneE164), digits: lead.phoneE164.replace(/^\+1/, "") };
}

export type OutcomeInput = {
  leadId: string;
  callId: string | null;
  dispositionId: string;
  notes: string;
  callbackAt: Date | null;
};

/**
 * Records a call outcome and applies its rule:
 *   release -> stays in the agent's working list, returns to the pool at logout
 *   retain  -> kept by the agent as a follow-up (callback, email, qualified)
 *   close   -> finished
 *   dnc     -> number added to the do-not-call list; other leads with it are blocked
 */
export async function saveOutcome(agent: Agent, input: OutcomeInput) {
  const [disp] = await db.select().from(dispositions).where(and(eq(dispositions.id, input.dispositionId), eq(dispositions.active, true))).limit(1);
  if (!disp) throw new ActionError("Choose a call outcome.");
  const now = new Date();
  if (disp.requiresCallback) {
    if (!input.callbackAt) throw new ActionError("Pick a callback date and time.");
    if (input.callbackAt.getTime() < now.getTime() - 60_000) throw new ActionError("The callback time is in the past.");
  }
  const notes = input.notes.trim().slice(0, 4000);

  return db.transaction(async (tx) => {
    const [lead] = await tx
      .select()
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.assignedTo, agent.id), inArray(leads.status, ["assigned", "follow_up"])))
      .for("update");
    if (!lead) throw new ActionError("This lead is no longer in your list.");

    let callId: string | null = null;
    if (input.callId) {
      const [call] = await tx
        .select()
        .from(calls)
        .where(and(eq(calls.id, input.callId), eq(calls.agentId, agent.id), eq(calls.leadId, lead.id)))
        .limit(1);
      if (call && !call.dispositionId) {
        callId = call.id;
        // duration from the database clock on both ends (the dialer webhook may overwrite it with the real talk time)
        await tx
          .update(calls)
          .set({
            endedAt: call.endedAt ?? sql`now()`,
            durationSec: call.durationSec ?? sql`greatest(0, round(extract(epoch from (now() - ${calls.startedAt}))))::int`,
            dispositionId: disp.id,
            notes: notes || null,
          })
          .where(eq(calls.id, call.id));
      }
    }
    if (!callId) {
      // outcome recorded without using the Call button (e.g. dialed by hand)
      const [row] = await tx
        .insert(calls)
        .values({ leadId: lead.id, agentId: agent.id, phone: lead.phoneE164, method: "manual", startedAt: now, endedAt: now, dispositionId: disp.id, notes: notes || null })
        .returning({ id: calls.id });
      callId = row.id;
      await tx.update(leads).set({ lastCalledAt: now, callCount: sql`${leads.callCount} + 1` }).where(eq(leads.id, lead.id));
    }

    const status =
      disp.action === "retain" ? "follow_up" : disp.action === "close" ? "closed" : disp.action === "dnc" ? "dnc" : lead.status;
    await tx.update(leads).set({ status, lastDispositionId: disp.id }).where(eq(leads.id, lead.id));

    // any open callback on this lead is resolved by this call
    await tx
      .update(callbacks)
      .set({ status: "done", completedAt: now })
      .where(and(eq(callbacks.leadId, lead.id), eq(callbacks.status, "pending")));
    if (disp.requiresCallback && input.callbackAt) {
      await tx.insert(callbacks).values({ leadId: lead.id, agentId: agent.id, dueAt: input.callbackAt, note: notes || null });
    }

    let blocked = 0;
    if (disp.action === "dnc" && lead.phoneE164) {
      await tx.insert(dncNumbers).values({ phoneE164: lead.phoneE164, leadId: lead.id, addedBy: agent.id, reason: notes || "Marked Do Not Call on a call" }).onConflictDoNothing();
      const others = await tx
        .update(leads)
        .set({ status: "dnc" })
        .where(and(eq(leads.phoneE164, lead.phoneE164), ne(leads.id, lead.id), inArray(leads.status, ["available", "assigned", "follow_up"])))
        .returning({ id: leads.id });
      blocked = others.length;
      if (others.length) {
        await tx.insert(leadActivities).values(others.map((o) => ({ leadId: o.id, userId: agent.id, type: "dnc", summary: "Blocked: this number was marked Do Not Call on another lead" })));
      }
    }

    await tx.insert(leadActivities).values({
      leadId: lead.id,
      userId: agent.id,
      type: "outcome",
      summary: disp.label,
      data: { callId, dispositionKey: disp.key, notes: notes || undefined, callbackAt: input.callbackAt?.toISOString() },
    });
    await recordEvent(tx, {
      userId: agent.id,
      sessionId: agent.sessionId,
      type: "disposition",
      summary: `${disp.label}: ${lead.company ?? lead.contactName ?? "lead"}`,
      meta: { leadId: lead.id, callId, disposition: disp.key },
    });
    await audit(
      {
        actorId: agent.id,
        action: "outcome_saved",
        module: "calls",
        entityType: "lead",
        entityId: lead.id,
        before: { status: lead.status, dispositionId: lead.lastDispositionId },
        after: { status, disposition: disp.key, callbackAt: input.callbackAt?.toISOString() ?? null, blockedOtherLeads: blocked || undefined },
      },
      tx,
    );
    return { status, blocked };
  });
}

export async function addLeadNote(agentId: string, leadId: string, note: string) {
  const text = note.trim().slice(0, 4000);
  if (!text) throw new ActionError("Write a note first.");
  const lead = await getWorkingLead(agentId, leadId);
  if (!lead) throw new ActionError("This lead is no longer in your list.");
  await db.insert(leadActivities).values({ leadId, userId: agentId, type: "note", summary: "Note", data: { notes: text } });
}

/** Chronological history for the lead panel. */
export async function leadTimeline(leadId: string, limit = 40) {
  return db
    .select({
      id: leadActivities.id,
      type: leadActivities.type,
      summary: leadActivities.summary,
      data: leadActivities.data,
      createdAt: leadActivities.createdAt,
      userName: schema.users.name,
    })
    .from(leadActivities)
    .leftJoin(schema.users, eq(schema.users.id, leadActivities.userId))
    .where(eq(leadActivities.leadId, leadId))
    .orderBy(desc(leadActivities.createdAt))
    .limit(limit);
}
