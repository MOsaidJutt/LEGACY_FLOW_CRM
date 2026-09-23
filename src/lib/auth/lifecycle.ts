import "server-only";
import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import { db, schema } from "@/db";
import { returnAgentLeads } from "@/lib/leads/assignment";
import { goOffline } from "@/lib/monitoring/presence";
import { recordEvent } from "@/lib/monitoring/events";
import { readSettings } from "@/lib/settings";

export type EndReason = "logout" | "timeout" | "expired" | "revoked";

/**
 * Ends a session. When it was the user's last open session, their unprocessed
 * working leads return to the pool (LA-08) and their presence goes offline.
 */
export async function endSession(sessionId: string, reason: EndReason) {
  return db.transaction(async (tx) => {
    const now = new Date();
    const [ended] = await tx
      .update(schema.sessions)
      .set({ endedAt: now, endReason: reason })
      .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.endedAt)))
      .returning({ userId: schema.sessions.userId, lastSeenAt: schema.sessions.lastSeenAt });
    if (!ended) return { returned: 0 };

    const [stillSignedIn] = await tx
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(and(eq(schema.sessions.userId, ended.userId), isNull(schema.sessions.endedAt), gt(schema.sessions.expiresAt, now)))
      .limit(1);

    let returned = 0;
    if (!stillSignedIn) {
      returned = await returnAgentLeads(tx, ended.userId, reason === "logout" ? "returned_on_logout" : "returned_on_timeout");
      await goOffline(tx, ended.userId, reason === "logout" ? now : ended.lastSeenAt);
    }

    await recordEvent(tx, {
      userId: ended.userId,
      sessionId,
      type: reason === "logout" ? "logout" : "session_end",
      summary:
        reason === "logout"
          ? "Logged out"
          : reason === "timeout"
            ? "Session timed out"
            : reason === "expired"
              ? "Session reached its maximum length"
              : "Session ended by an admin",
      meta: { reason, returnedLeads: returned },
      source: reason === "logout" ? "web" : "system",
    });
    return { returned };
  });
}

/** Ends sessions that stopped heartbeating or reached their maximum age. Run by cron. */
export async function sweepSessions() {
  const settings = await readSettings();
  const now = new Date();
  const idleCutoff = new Date(now.getTime() - settings.sessionIdleMinutes * 60_000);
  const stale = await db
    .select({ id: schema.sessions.id, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .where(and(isNull(schema.sessions.endedAt), or(lt(schema.sessions.lastSeenAt, idleCutoff), lt(schema.sessions.expiresAt, now))));
  for (const s of stale) await endSession(s.id, s.expiresAt <= now ? "expired" : "timeout");
  return stale.length;
}
