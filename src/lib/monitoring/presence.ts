import "server-only";
import { and, eq, isNull, lt, ne } from "drizzle-orm";
import { db, schema, type DB, type Tx } from "@/db";
import { readSettings } from "@/lib/settings";
import { recordEvent } from "./events";

type State = (typeof schema.presenceState.enumValues)[number];

const maxDate = (...dates: Array<Date | null | undefined>) =>
  dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);

/** Closes the open segment at `at` and opens one for `to` (offline has no segment). */
async function transition(tx: DB | Tx, userId: string, to: State, at: Date, breakType: string | null) {
  await tx
    .update(schema.presenceSegments)
    .set({ endedAt: at })
    .where(and(eq(schema.presenceSegments.userId, userId), isNull(schema.presenceSegments.endedAt)));
  if (to !== "offline") {
    await tx.insert(schema.presenceSegments).values({ userId, state: to, breakType, startedAt: at });
  }
}

export type Heartbeat = {
  userId: string;
  sessionId: string | null;
  source: "web" | "desktop";
  /** last keyboard / mouse activity reported by the client */
  lastActivityAt: Date;
  /** foreground application reported by the desktop agent */
  app?: string | null;
};

/**
 * Applies a heartbeat. Active time stops once no qualifying activity has been seen
 * for the inactivity threshold (5 minutes by default) and idle time starts at that
 * moment; activity from either the browser or the desktop agent counts.
 */
export async function recordHeartbeat(input: Heartbeat) {
  const settings = await readSettings();
  const threshold = settings.inactivityMinutes * 60_000;
  const now = new Date();
  const activity = new Date(Math.min(input.lastActivityAt.getTime(), now.getTime()));

  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.presence).where(eq(schema.presence.userId, input.userId)).for("update");
    const current: State = p?.state ?? "offline";

    const lastWeb = input.source === "web" ? maxDate(p?.lastWebActivityAt, activity) : (p?.lastWebActivityAt ?? null);
    const lastDesktop =
      input.source === "desktop" ? maxDate(p?.lastDesktopActivityAt, activity) : (p?.lastDesktopActivityAt ?? null);
    const last = maxDate(lastWeb, lastDesktop) ?? activity;

    let desired: State;
    if (input.source === "desktop" && current === "offline") desired = "offline"; // not signed in to the CRM
    else if (p?.breakType) desired = "break";
    else desired = now.getTime() - last.getTime() < threshold ? "active" : "idle";

    let since = p?.since ?? now;
    if (desired !== current) {
      let at = now;
      if (current === "active" && desired === "idle") at = new Date(last.getTime() + threshold);
      else if (current === "idle" && desired === "active") at = last;
      if (at < since) at = since;
      if (at > now) at = now;
      await transition(tx, input.userId, desired, at, p?.breakType ?? null);
      if (current === "active" && desired === "idle") {
        await recordEvent(tx, { userId: input.userId, sessionId: input.sessionId, type: "idle_start", summary: "Became idle", source: "system" });
      } else if (current === "idle" && desired === "active") {
        await recordEvent(tx, { userId: input.userId, sessionId: input.sessionId, type: "idle_end", summary: "Active again", source: input.source });
      }
      since = at;
    }

    const values = {
      state: desired,
      since,
      lastHeartbeatAt: input.source === "web" ? now : (p?.lastHeartbeatAt ?? null),
      lastWebActivityAt: lastWeb,
      lastDesktopActivityAt: lastDesktop,
      desktopApp: input.source === "desktop" ? (input.app ?? null) : (p?.desktopApp ?? null),
      sessionId: input.sessionId ?? p?.sessionId ?? null,
    };
    if (p) await tx.update(schema.presence).set(values).where(eq(schema.presence.userId, input.userId));
    else await tx.insert(schema.presence).values({ userId: input.userId, breakType: null, ...values });

    return { state: desired, since, breakType: p?.breakType ?? null };
  });
}

/** Start (breakType) or end (null) a break. */
export async function setBreak(userId: string, sessionId: string | null, breakType: string | null) {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(schema.presence).where(eq(schema.presence.userId, userId)).for("update");
    if (breakType) {
      if (p?.state === "break") return;
      await transition(tx, userId, "break", now, breakType);
      const values = { state: "break" as const, since: now, breakType, lastHeartbeatAt: now, sessionId };
      if (p) await tx.update(schema.presence).set(values).where(eq(schema.presence.userId, userId));
      else await tx.insert(schema.presence).values({ userId, ...values });
      await recordEvent(tx, { userId, sessionId, type: "break_start", summary: `Started ${breakType} break`, meta: { breakType } });
    } else {
      if (p?.state !== "break") return;
      await transition(tx, userId, "active", now, null);
      await tx
        .update(schema.presence)
        .set({ state: "active", since: now, breakType: null, lastWebActivityAt: now, lastHeartbeatAt: now })
        .where(eq(schema.presence.userId, userId));
      await recordEvent(tx, { userId, sessionId, type: "break_end", summary: "Ended break", meta: { breakType: p.breakType } });
    }
  });
}

export async function goOffline(tx: DB | Tx, userId: string, at: Date) {
  const [p] = await tx.select().from(schema.presence).where(eq(schema.presence.userId, userId)).for("update");
  if (!p || p.state === "offline") return;
  const when = at < p.since ? p.since : at;
  await transition(tx, userId, "offline", when, null);
  await tx.update(schema.presence).set({ state: "offline", since: when, breakType: null }).where(eq(schema.presence.userId, userId));
}

/** Users whose browser stopped heartbeating (tab closed, network lost) go offline. Run by cron. */
export async function sweepPresence() {
  const cutoff = new Date(Date.now() - 3 * 60_000);
  const stale = await db
    .select({ userId: schema.presence.userId, lastHeartbeatAt: schema.presence.lastHeartbeatAt })
    .from(schema.presence)
    .where(and(ne(schema.presence.state, "offline"), lt(schema.presence.lastHeartbeatAt, cutoff)));
  for (const s of stale) {
    await db.transaction((tx) => goOffline(tx, s.userId, new Date((s.lastHeartbeatAt ?? cutoff).getTime() + 30_000)));
  }
  return stale.length;
}
