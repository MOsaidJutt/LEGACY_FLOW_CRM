import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/* ------------------------------------------------------------------ calls */

export type CallTotals = {
  calls: number;
  answered: number;
  noAnswer: number;
  callbacks: number;
  notInterested: number;
  dnc: number;
  email: number;
  qualified: number;
  noOutcome: number;
  talkSeconds: number;
};

export const emptyCalls = (): CallTotals => ({
  calls: 0,
  answered: 0,
  noAnswer: 0,
  callbacks: 0,
  notInterested: 0,
  dnc: 0,
  email: 0,
  qualified: 0,
  noOutcome: 0,
  talkSeconds: 0,
});

const KEY_TO_FIELD: Record<string, keyof CallTotals> = {
  no_answer: "noAnswer",
  callback: "callbacks",
  not_interested: "notInterested",
  dnc: "dnc",
  email: "email",
  qualified: "qualified",
};

/** Per-agent call counts by outcome for [from, to). Custom outcomes count as answered. */
export async function callTotals(from: Date, to: Date, agentIds?: string[]) {
  const { calls, dispositions } = schema;
  const rows = await db
    .select({
      agentId: calls.agentId,
      key: dispositions.key,
      n: sql<number>`count(*)::int`,
      talk: sql<number>`coalesce(sum(${calls.durationSec}), 0)::int`,
    })
    .from(calls)
    .leftJoin(dispositions, eq(dispositions.id, calls.dispositionId))
    .where(and(gte(calls.startedAt, from), lt(calls.startedAt, to), agentIds?.length ? inArray(calls.agentId, agentIds) : undefined))
    .groupBy(calls.agentId, dispositions.key);

  const out = new Map<string, CallTotals>();
  for (const r of rows) {
    const t = out.get(r.agentId) ?? emptyCalls();
    t.calls += r.n;
    t.talkSeconds += r.talk;
    if (r.key === null) t.noOutcome += r.n;
    else {
      const field = KEY_TO_FIELD[r.key];
      if (field) t[field] += r.n;
      if (r.key !== "no_answer") t.answered += r.n;
    }
    out.set(r.agentId, t);
  }
  return out;
}

export function sumCalls(list: Iterable<CallTotals>) {
  const total = emptyCalls();
  for (const t of list) for (const k of Object.keys(total) as (keyof CallTotals)[]) total[k] += t[k];
  return total;
}

/* ------------------------------------------------------------------ time */

export type TimeTotals = { active: number; idle: number; break: number; screen: number };
export const emptyTime = (): TimeTotals => ({ active: 0, idle: 0, break: 0, screen: 0 });

/** Seconds of active / idle / break / total CRM screen time per user, clipped to [from, to). */
export async function timeTotals(from: Date, to: Date, userIds?: string[]) {
  const ps = schema.presenceSegments;
  const seconds = sql<number>`coalesce(sum(extract(epoch from (least(coalesce(${ps.endedAt}, now()), ${to.toISOString()}::timestamptz) - greatest(${ps.startedAt}, ${from.toISOString()}::timestamptz)))), 0)::float8`;
  const rows = await db
    .select({ userId: ps.userId, state: ps.state, seconds })
    .from(ps)
    .where(
      and(
        lt(ps.startedAt, to),
        sql`coalesce(${ps.endedAt}, now()) > ${from.toISOString()}::timestamptz`,
        userIds?.length ? inArray(ps.userId, userIds) : undefined,
      ),
    )
    .groupBy(ps.userId, ps.state);

  const out = new Map<string, TimeTotals>();
  for (const r of rows) {
    const t = out.get(r.userId) ?? emptyTime();
    const s = Math.max(0, Number(r.seconds));
    if (r.state === "active" || r.state === "idle" || r.state === "break") t[r.state] += s;
    t.screen += s;
    out.set(r.userId, t);
  }
  return out;
}

/** Productivity % = active time as a share of logged-in (screen) time. */
export function productivity(t: TimeTotals | undefined) {
  if (!t || t.screen < 60) return null;
  return Math.round((t.active / t.screen) * 100);
}

/* ------------------------------------------------------------------ attendance */

export type LoginSpan = { firstLogin: Date | null; lastLogout: Date | null; logins: number };

export async function loginSpans(from: Date, to: Date, userIds?: string[]) {
  const ev = schema.activityEvents;
  const rows = await db
    .select({
      userId: ev.userId,
      firstLogin: sql<string | null>`min(${ev.createdAt}) filter (where ${ev.type} = 'login')`,
      lastLogout: sql<string | null>`max(${ev.createdAt}) filter (where ${ev.type} in ('logout', 'session_end'))`,
      logins: sql<number>`(count(*) filter (where ${ev.type} = 'login'))::int`,
    })
    .from(ev)
    .where(and(gte(ev.createdAt, from), lt(ev.createdAt, to), inArray(ev.type, ["login", "logout", "session_end"]), userIds?.length ? inArray(ev.userId, userIds) : undefined))
    .groupBy(ev.userId);
  return new Map<string, LoginSpan>(
    rows.map((r) => [r.userId, { firstLogin: r.firstLogin ? new Date(r.firstLogin) : null, lastLogout: r.lastLogout ? new Date(r.lastLogout) : null, logins: r.logins }]),
  );
}

/* ------------------------------------------------------------------ people */

/** Active users whose role can work leads (the calling floor). */
export async function agentUsers() {
  const { users, roles } = schema;
  return db
    .select({ id: users.id, name: users.name, email: users.email, shiftId: users.shiftId })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.status, "active"), sql`${roles.permissions} @> '["leads.work"]'::jsonb`))
    .orderBy(users.name);
}

export type LiveState = "active" | "idle" | "break" | "offline";

/** Presence rows can lag if the browser vanished; treat silent users as offline. */
export function liveState(p: { state: LiveState; lastHeartbeatAt: Date | null } | undefined): LiveState {
  if (!p) return "offline";
  if (p.state !== "offline" && (!p.lastHeartbeatAt || Date.now() - p.lastHeartbeatAt.getTime() > 3 * 60_000)) return "offline";
  return p.state;
}
