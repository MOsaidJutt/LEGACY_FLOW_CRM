import "server-only";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, notInArray, sql } from "drizzle-orm";
import { db, schema, type DB, type Tx } from "@/db";
import { audit } from "@/lib/audit";
import { notify, usersWithPermission } from "@/lib/notify";
import { recordEvent } from "@/lib/monitoring/events";
import { readSettings } from "@/lib/settings";
import { ActionError } from "@/lib/actions";

const { leads, leadAssignments, leadActivities, leadRequests, sessions } = schema;

type Conn = DB | Tx;

async function history(
  tx: Conn,
  leadIds: string[],
  entry: { userId: string | null; action: (typeof schema.assignmentAction.enumValues)[number]; actorId: string | null; requestId?: string | null; note?: string },
  summary: string,
) {
  if (!leadIds.length) return;
  await tx.insert(leadAssignments).values(
    leadIds.map((leadId) => ({ leadId, userId: entry.userId, action: entry.action, actorId: entry.actorId, requestId: entry.requestId ?? null, note: entry.note ?? null })),
  );
  await tx.insert(leadActivities).values(leadIds.map((leadId) => ({ leadId, userId: entry.actorId ?? entry.userId, type: entry.action, summary })));
}

/**
 * Locks up to `qty` available leads to an agent. Uses SKIP LOCKED so two
 * simultaneous assignments can never hand the same lead to two agents.
 * Never-called leads go first, then the ones called longest ago.
 */
export async function assignFromPool(tx: Conn, opts: { agentId: string; qty: number; actorId: string | null; requestId?: string | null }) {
  if (opts.qty <= 0) return 0;
  const picked = await tx
    .select({ id: leads.id })
    .from(leads)
    .where(
      and(
        eq(leads.status, "available"),
        // only callable leads: a valid U.S. number that is not on the do-not-call list
        isNotNull(leads.phoneE164),
        sql`not exists (select 1 from ${schema.dncNumbers} d where d.phone_e164 = ${leads.phoneE164})`,
      ),
    )
    .orderBy(sql`${leads.lastCalledAt} asc nulls first`, asc(leads.createdAt))
    .limit(opts.qty)
    .for("update", { skipLocked: true });
  if (!picked.length) return 0;

  const now = new Date();
  const assigned = await tx
    .update(leads)
    .set({ status: "assigned", assignedTo: opts.agentId, assignedAt: now })
    .where(and(inArray(leads.id, picked.map((p) => p.id)), eq(leads.status, "available")))
    .returning({ id: leads.id });

  await history(
    tx,
    assigned.map((a) => a.id),
    { userId: opts.agentId, action: "assigned", actorId: opts.actorId, requestId: opts.requestId },
    opts.requestId ? "Assigned from a lead request" : "Assigned by Management",
  );
  return assigned.length;
}

/** Returns an agent's unprocessed working leads to the pool (logout / session timeout). */
export async function returnAgentLeads(tx: Conn, agentId: string, action: "returned_on_logout" | "returned_on_timeout") {
  const returned = await tx
    .update(leads)
    .set({ status: "available", assignedTo: null, assignedAt: null })
    .where(and(eq(leads.assignedTo, agentId), eq(leads.status, "assigned")))
    .returning({ id: leads.id });
  await history(
    tx,
    returned.map((r) => r.id),
    { userId: agentId, action, actorId: null },
    action === "returned_on_logout" ? "Returned to the pool when the agent logged out" : "Returned to the pool when the agent's session timed out",
  );
  // a request the agent can no longer receive is cancelled
  await tx
    .update(leadRequests)
    .set({ status: "cancelled", decidedAt: new Date(), note: "Agent signed out before the request was decided" })
    .where(and(eq(leadRequests.agentId, agentId), eq(leadRequests.status, "pending")));
  return returned.length;
}

/* ------------------------------------------------------------------ requests */

export async function createLeadRequest(agentId: string, sessionId: string, qty: number) {
  const settings = await readSettings();
  if (!Number.isInteger(qty) || qty < 1) throw new ActionError("Enter how many leads you need.");
  if (qty > settings.maxLeadRequest) throw new ActionError(`You can request at most ${settings.maxLeadRequest} leads at a time.`);

  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select({ id: leadRequests.id })
      .from(leadRequests)
      .where(and(eq(leadRequests.agentId, agentId), eq(leadRequests.status, "pending")))
      .limit(1);
    if (pending) throw new ActionError("You already have a request waiting for approval.");

    const [agent] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, agentId));
    const expiresAt = new Date(Date.now() + settings.autoAssignMinutes * 60_000);
    const [request] = await tx.insert(leadRequests).values({ agentId, requestedQty: qty, expiresAt }).returning();

    await notify(tx, await usersWithPermission(tx, "leads.requests.decide"), {
      type: "lead_request",
      title: `${agent?.name ?? "An agent"} requested ${qty} leads`,
      body: `Approve, adjust or reject within ${settings.autoAssignMinutes} minutes, otherwise they are assigned automatically.`,
      link: "/manage/requests",
    });
    await recordEvent(tx, { userId: agentId, sessionId, type: "lead_request", summary: `Requested ${qty} leads`, meta: { requestId: request.id, qty } });
    await audit({ actorId: agentId, action: "request_created", module: "requests", entityType: "lead_request", entityId: request.id, after: { qty } }, tx);
    return request;
  });
}

export async function cancelLeadRequest(agentId: string, requestId: string) {
  const [row] = await db
    .update(leadRequests)
    .set({ status: "cancelled", decidedAt: new Date(), note: "Cancelled by the agent" })
    .where(and(eq(leadRequests.id, requestId), eq(leadRequests.agentId, agentId), eq(leadRequests.status, "pending")))
    .returning({ id: leadRequests.id });
  if (!row) throw new ActionError("This request has already been decided.");
}

async function agentIsSignedIn(tx: Conn, agentId: string) {
  const [s] = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.userId, agentId), isNull(sessions.endedAt), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return Boolean(s);
}

function shortfallNote(requested: number, assigned: number) {
  return assigned < requested ? `Only ${assigned} of ${requested} leads were available in the pool.` : null;
}

export async function decideLeadRequest(opts: { requestId: string; actorId: string; decision: "approve" | "reject"; qty?: number; note?: string }) {
  const settings = await readSettings();
  return db.transaction(async (tx) => {
    const [req] = await tx.select().from(leadRequests).where(eq(leadRequests.id, opts.requestId)).for("update");
    if (!req) throw new ActionError("That request no longer exists.");
    if (req.status !== "pending") throw new ActionError("This request was already decided (it may have been auto-assigned).");

    const now = new Date();
    if (opts.decision === "reject") {
      await tx.update(leadRequests).set({ status: "rejected", decidedAt: now, decidedBy: opts.actorId, note: opts.note || null }).where(eq(leadRequests.id, req.id));
      await notify(tx, [req.agentId], {
        type: "lead_request_rejected",
        title: "Your lead request was declined",
        body: opts.note || "Speak to Management if you need more leads.",
        link: "/agent/request",
      });
      await audit({ actorId: opts.actorId, action: "request_rejected", module: "requests", entityType: "lead_request", entityId: req.id, summary: opts.note }, tx);
      return { assigned: 0 };
    }

    const qty = opts.qty ?? req.requestedQty;
    if (!Number.isInteger(qty) || qty < 1 || qty > settings.maxLeadRequest) throw new ActionError(`Approve between 1 and ${settings.maxLeadRequest} leads.`);
    const assigned = await assignFromPool(tx, { agentId: req.agentId, qty, actorId: opts.actorId, requestId: req.id });
    const note = [opts.note, shortfallNote(qty, assigned)].filter(Boolean).join(" ") || null;
    await tx
      .update(leadRequests)
      .set({ status: "approved", approvedQty: qty, assignedQty: assigned, decidedAt: now, decidedBy: opts.actorId, note })
      .where(eq(leadRequests.id, req.id));
    await notify(tx, [req.agentId], {
      type: "lead_request_approved",
      title: qty === req.requestedQty ? `${assigned} leads assigned to you` : `Request adjusted: ${assigned} leads assigned`,
      body: note ?? undefined,
      link: "/agent/calls",
    });
    await audit(
      { actorId: opts.actorId, action: "request_approved", module: "requests", entityType: "lead_request", entityId: req.id, before: { qty: req.requestedQty }, after: { qty, assigned } },
      tx,
    );
    return { assigned };
  });
}

/** Auto-approves requests nobody decided within the window. Safe to call from many places at once. */
export async function processExpiredRequests() {
  let processed = 0;
  for (let i = 0; i < 50; i++) {
    const handled = await db.transaction(async (tx) => {
      const [req] = await tx
        .select()
        .from(leadRequests)
        .where(and(eq(leadRequests.status, "pending"), lte(leadRequests.expiresAt, new Date())))
        .orderBy(asc(leadRequests.createdAt))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!req) return false;

      if (!(await agentIsSignedIn(tx, req.agentId))) {
        await tx.update(leadRequests).set({ status: "cancelled", decidedAt: new Date(), note: "Agent was signed out when the request expired" }).where(eq(leadRequests.id, req.id));
        return true;
      }
      const assigned = await assignFromPool(tx, { agentId: req.agentId, qty: req.requestedQty, actorId: null, requestId: req.id });
      const note = shortfallNote(req.requestedQty, assigned);
      await tx
        .update(leadRequests)
        .set({ status: "auto_approved", approvedQty: req.requestedQty, assignedQty: assigned, decidedAt: new Date(), note })
        .where(eq(leadRequests.id, req.id));
      await notify(tx, [req.agentId], {
        type: "lead_request_auto",
        title: `${assigned} leads assigned to you automatically`,
        body: note ?? "Management did not respond within the approval window.",
        link: "/agent/calls",
      });
      await audit({ actorId: null, action: "request_auto_approved", module: "requests", entityType: "lead_request", entityId: req.id, after: { assigned } }, tx);
      return true;
    });
    if (!handled) break;
    processed++;
  }
  return processed;
}

/* ------------------------------------------------------------------ manual management */

/** Assign or transfer specific leads to an agent. Closed and do-not-call leads are skipped. */
export async function assignSpecificLeads(opts: { leadIds: string[]; agentId: string; actorId: string }) {
  if (!opts.leadIds.length) throw new ActionError("Select at least one lead.");
  return db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: leads.id, status: leads.status, assignedTo: leads.assignedTo })
      .from(leads)
      .where(and(inArray(leads.id, opts.leadIds), notInArray(leads.status, ["closed", "dnc"])))
      .for("update");
    const movable = rows.filter((r) => r.assignedTo !== opts.agentId);
    if (!movable.length) return { moved: 0, skipped: opts.leadIds.length };

    const now = new Date();
    const fromPool = movable.filter((r) => r.status === "available").map((r) => r.id);
    const transfers = movable.filter((r) => r.status !== "available").map((r) => r.id);
    if (fromPool.length) {
      await tx.update(leads).set({ status: "assigned", assignedTo: opts.agentId, assignedAt: now }).where(inArray(leads.id, fromPool));
      await history(tx, fromPool, { userId: opts.agentId, action: "assigned", actorId: opts.actorId }, "Assigned by Management");
    }
    if (transfers.length) {
      await tx.update(leads).set({ assignedTo: opts.agentId, assignedAt: now }).where(inArray(leads.id, transfers));
      await history(tx, transfers, { userId: opts.agentId, action: "transferred", actorId: opts.actorId }, "Transferred to another agent by Management");
    }
    await notify(tx, [opts.agentId], { type: "leads_assigned", title: `${movable.length} leads assigned to you by Management`, link: "/agent/calls" });
    await audit({ actorId: opts.actorId, action: "leads_assigned", module: "leads", entityType: "lead", after: { agentId: opts.agentId, count: movable.length, leadIds: movable.map((m) => m.id) } }, tx);
    return { moved: movable.length, skipped: opts.leadIds.length - movable.length };
  });
}

/** Release leads back to the central pool. */
export async function releaseLeads(opts: { leadIds: string[]; actorId: string }) {
  if (!opts.leadIds.length) throw new ActionError("Select at least one lead.");
  return db.transaction(async (tx) => {
    const released = await tx
      .update(leads)
      .set({ status: "available", assignedTo: null, assignedAt: null })
      .where(and(inArray(leads.id, opts.leadIds), inArray(leads.status, ["assigned", "follow_up"])))
      .returning({ id: leads.id });
    await history(tx, released.map((r) => r.id), { userId: null, action: "released", actorId: opts.actorId }, "Released to the pool by Management");
    await audit({ actorId: opts.actorId, action: "leads_released", module: "leads", entityType: "lead", after: { count: released.length, leadIds: released.map((r) => r.id) } }, tx);
    return { released: released.length };
  });
}

/**
 * CL-08: authorized users can add a number to, or remove it from, the do-not-call list.
 * Every lead with that number is blocked or released accordingly.
 */
export async function setLeadDnc(opts: { leadId: string; dnc: boolean; reason: string; actorId: string }) {
  return db.transaction(async (tx) => {
    const [lead] = await tx.select().from(leads).where(eq(leads.id, opts.leadId)).for("update");
    if (!lead?.phoneE164) throw new ActionError("This lead has no valid phone number.");
    const phone = lead.phoneE164;

    if (opts.dnc) {
      await tx.insert(schema.dncNumbers).values({ phoneE164: phone, leadId: lead.id, addedBy: opts.actorId, reason: opts.reason || "Added by Management" }).onConflictDoNothing();
      const blocked = await tx
        .update(leads)
        .set({ status: "dnc", assignedTo: null, assignedAt: null })
        .where(and(eq(leads.phoneE164, phone), inArray(leads.status, ["available", "assigned", "follow_up"])))
        .returning({ id: leads.id });
      await tx.insert(leadActivities).values(
        (blocked.length ? blocked : [{ id: lead.id }]).map((b) => ({ leadId: b.id, userId: opts.actorId, type: "dnc", summary: "Added to the do-not-call list", data: { notes: opts.reason || undefined } })),
      );
      await audit({ actorId: opts.actorId, action: "dnc_added", module: "leads", entityType: "phone", entityId: phone, after: { reason: opts.reason, leads: blocked.length } }, tx);
      return { affected: blocked.length };
    }

    if (!opts.reason) throw new ActionError("Give a reason for removing the number from the do-not-call list.");
    await tx.delete(schema.dncNumbers).where(eq(schema.dncNumbers.phoneE164, phone));
    const released = await tx
      .update(leads)
      .set({ status: "available", assignedTo: null, assignedAt: null })
      .where(and(eq(leads.phoneE164, phone), eq(leads.status, "dnc")))
      .returning({ id: leads.id });
    if (released.length) {
      await tx.insert(leadActivities).values(released.map((r) => ({ leadId: r.id, userId: opts.actorId, type: "dnc_removed", summary: "Removed from the do-not-call list", data: { notes: opts.reason } })));
    }
    await audit({ actorId: opts.actorId, action: "dnc_removed", module: "leads", entityType: "phone", entityId: phone, before: { dnc: true }, after: { reason: opts.reason, leads: released.length } }, tx);
    return { affected: released.length };
  });
}

/** Leads that can be handed out right now (available, callable, not on the DNC list). */
export async function poolCount(tx: Conn = db) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.status, "available"),
        isNotNull(leads.phoneE164),
        sql`not exists (select 1 from ${schema.dncNumbers} d where d.phone_e164 = ${leads.phoneE164})`,
      ),
    );
  return row?.n ?? 0;
}
