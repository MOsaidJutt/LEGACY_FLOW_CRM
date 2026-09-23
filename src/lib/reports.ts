import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { agentUsers, callTotals, emptyCalls, emptyTime, productivity, timeTotals } from "./metrics";
import { attendance, summarizeAttendance } from "./attendance";
import type { Period } from "./period";
import { formatTime } from "./time";
import type { Kind } from "./report-format";

export type ReportType = "performance" | "punctuality" | "sources";

export const REPORT_TYPES: { key: ReportType; label: string; description: string }[] = [
  { key: "performance", label: "Performance", description: "Calls, outcomes, time and punctuality per agent. Daily, weekly, 15-day, monthly or custom." },
  { key: "punctuality", label: "Punctuality", description: "Shift, login and logout, late minutes, early logout and breaks per agent per day." },
  { key: "sources", label: "Lead sources", description: "Results for each lead source or campaign." },
];

export type Column = { key: string; label: string; kind: Kind };
export type Cell = string | number | null;
export type ReportData = {
  type: ReportType;
  title: string;
  subtitle: string;
  fromDay: string;
  toDay: string;
  columns: Column[];
  rows: Record<string, Cell>[];
  totals: Record<string, Cell> | null;
  generatedAt: string;
};

export function periodKind(period: Period) {
  const n = period.days.length;
  if (n === 1) return "Daily";
  if (period.key === "month") return "Monthly";
  if (n === 7) return "Weekly";
  if (n === 15) return "15-Day";
  if (n >= 28 && n <= 31) return "Monthly";
  return "Custom";
}

export async function buildReport(type: ReportType, period: Period, tz: string, opts: { agentId?: string | null } = {}): Promise<ReportData> {
  const range = period.fromDay === period.toDay ? period.fromDay : `${period.fromDay} to ${period.toDay}`;
  const base = { type, fromDay: period.fromDay, toDay: period.toDay, generatedAt: new Date().toISOString() };
  let agents = await agentUsers();
  if (opts.agentId) agents = agents.filter((a) => a.id === opts.agentId);
  const ids = agents.map((a) => a.id);
  const scope = opts.agentId && agents[0] ? ` · ${agents[0].name}` : "";

  if (type === "performance") {
    const [calls, time, att, reviews] = await Promise.all([
      callTotals(period.start, period.end, ids),
      timeTotals(period.start, period.end, ids),
      attendance(tz, period.fromDay, period.toDay, ids),
      ids.length
        ? db
            .select()
            .from(schema.performanceReviews)
            .where(and(inArray(schema.performanceReviews.userId, ids), eq(schema.performanceReviews.periodStart, period.fromDay), eq(schema.performanceReviews.periodEnd, period.toDay)))
        : Promise.resolve([]),
    ]);
    const rows = agents.map((a) => {
      const c = calls.get(a.id) ?? emptyCalls();
      const t = time.get(a.id) ?? emptyTime();
      const s = summarizeAttendance(att.filter((r) => r.userId === a.id));
      const review = reviews.find((r) => r.userId === a.id);
      return {
        agent: a.name,
        calls: c.calls,
        answered: c.answered,
        noAnswer: c.noAnswer,
        callbacks: c.callbacks,
        qualified: c.qualified,
        email: c.email,
        notInterested: c.notInterested,
        dnc: c.dnc,
        talk: c.talkSeconds,
        screen: Math.round(t.screen),
        active: Math.round(t.active),
        idle: Math.round(t.idle),
        break: Math.round(t.break),
        productive: productivity(t),
        present: s.presentDays,
        lateDays: s.lateDays,
        lateMinutes: s.lateMinutes,
        earlyDays: s.earlyDays,
        score: review?.managementScore ?? null,
      } satisfies Record<string, Cell>;
    });
    const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const screen = sum("screen");
    return {
      ...base,
      title: `${periodKind(period)} performance report`,
      subtitle: `${range}${scope} · times in ${tz}`,
      columns: [
        { key: "agent", label: "Agent", kind: "text" },
        { key: "calls", label: "Calls", kind: "number" },
        { key: "answered", label: "Answered", kind: "number" },
        { key: "noAnswer", label: "No answer", kind: "number" },
        { key: "callbacks", label: "Callbacks", kind: "number" },
        { key: "qualified", label: "Qualified", kind: "number" },
        { key: "email", label: "Email", kind: "number" },
        { key: "notInterested", label: "Not int.", kind: "number" },
        { key: "dnc", label: "DNC", kind: "number" },
        { key: "talk", label: "Talk", kind: "duration" },
        { key: "screen", label: "Screen", kind: "duration" },
        { key: "active", label: "Active", kind: "duration" },
        { key: "idle", label: "Idle", kind: "duration" },
        { key: "break", label: "Break", kind: "duration" },
        { key: "productive", label: "Productive", kind: "percent" },
        { key: "present", label: "Days present", kind: "number" },
        { key: "lateDays", label: "Late days", kind: "number" },
        { key: "lateMinutes", label: "Late min", kind: "number" },
        { key: "earlyDays", label: "Left early", kind: "number" },
        { key: "score", label: "Mgmt score", kind: "number" },
      ],
      rows,
      totals: rows.length
        ? {
            agent: "Total",
            calls: sum("calls"),
            answered: sum("answered"),
            noAnswer: sum("noAnswer"),
            callbacks: sum("callbacks"),
            qualified: sum("qualified"),
            email: sum("email"),
            notInterested: sum("notInterested"),
            dnc: sum("dnc"),
            talk: sum("talk"),
            screen,
            active: sum("active"),
            idle: sum("idle"),
            break: sum("break"),
            productive: screen >= 60 ? Math.round((sum("active") / screen) * 100) : null,
            present: sum("present"),
            lateDays: sum("lateDays"),
            lateMinutes: sum("lateMinutes"),
            earlyDays: sum("earlyDays"),
            score: null,
          }
        : null,
    };
  }

  if (type === "punctuality") {
    const att = await attendance(tz, period.fromDay, period.toDay, ids);
    const nameOf = new Map(agents.map((a) => [a.id, a.name]));
    const rows = att
      .filter((r) => r.scheduled || r.firstLogin || r.leave || r.holiday)
      .sort((a, b) => (a.day === b.day ? (nameOf.get(a.userId) ?? "").localeCompare(nameOf.get(b.userId) ?? "") : a.day.localeCompare(b.day)))
      .map((r) => ({
        day: r.day,
        agent: nameOf.get(r.userId) ?? "",
        shift: r.holiday ? `Holiday: ${r.holiday}` : r.leave ? `Leave: ${r.leave}` : r.scheduled ? `${formatTime(r.shiftStart, tz)} to ${formatTime(r.shiftEnd, tz)}` : "Off",
        firstLogin: r.firstLogin ? formatTime(r.firstLogin, tz) : r.scheduled ? "Absent" : "",
        lastLogout: r.lastLogout ? formatTime(r.lastLogout, tz) : r.firstLogin ? "Still signed in" : "",
        late: r.lateMinutes ?? null,
        early: r.earlyMinutes ?? null,
        break: r.breakSeconds,
        recorded: r.screenSeconds,
        scheduled: r.scheduledMinutes * 60,
      }));
    return {
      ...base,
      title: "Punctuality report",
      subtitle: `${range}${scope} · times in ${tz}`,
      columns: [
        { key: "day", label: "Day", kind: "text" },
        { key: "agent", label: "Agent", kind: "text" },
        { key: "shift", label: "Shift", kind: "text" },
        { key: "firstLogin", label: "Login", kind: "text" },
        { key: "lastLogout", label: "Logout", kind: "text" },
        { key: "late", label: "Late min", kind: "number" },
        { key: "early", label: "Early min", kind: "number" },
        { key: "break", label: "Break", kind: "duration" },
        { key: "recorded", label: "Recorded", kind: "duration" },
        { key: "scheduled", label: "Scheduled", kind: "duration" },
      ],
      rows,
      totals: null,
    };
  }

  // lead sources
  const { leadSources, leads, calls, dispositions } = schema;
  const agentFilter = opts.agentId ? eq(calls.agentId, opts.agentId) : undefined;
  const [sources, outcomes, called] = await Promise.all([
    db
      .select({
        id: leadSources.id,
        name: leadSources.name,
        leads: sql<number>`count(${leads.id})::int`,
        inPool: sql<number>`(count(${leads.id}) filter (where ${leads.status} = 'available'))::int`,
      })
      .from(leadSources)
      .leftJoin(leads, eq(leads.sourceId, leadSources.id))
      .groupBy(leadSources.id, leadSources.name),
    db
      .select({ sourceId: leads.sourceId, key: dispositions.key, n: sql<number>`count(*)::int` })
      .from(calls)
      .innerJoin(leads, eq(leads.id, calls.leadId))
      .leftJoin(dispositions, eq(dispositions.id, calls.dispositionId))
      .where(and(gte(calls.startedAt, period.start), lt(calls.startedAt, period.end), agentFilter))
      .groupBy(leads.sourceId, dispositions.key),
    db
      .select({ sourceId: leads.sourceId, n: sql<number>`count(distinct ${calls.leadId})::int` })
      .from(calls)
      .innerJoin(leads, eq(leads.id, calls.leadId))
      .where(and(gte(calls.startedAt, period.start), lt(calls.startedAt, period.end), agentFilter))
      .groupBy(leads.sourceId),
  ]);
  const count = (sourceId: string, key?: string) =>
    outcomes.filter((o) => o.sourceId === sourceId && (key === undefined || o.key === key)).reduce((s, o) => s + o.n, 0);
  const rows = sources
    .map((s) => {
      const calls = count(s.id);
      return {
        source: s.name,
        leads: s.leads,
        inPool: s.inPool,
        calledLeads: called.find((c) => c.sourceId === s.id)?.n ?? 0,
        calls,
        answered: calls - count(s.id, "no_answer") - outcomes.filter((o) => o.sourceId === s.id && o.key === null).reduce((t, o) => t + o.n, 0),
        qualified: count(s.id, "qualified"),
        callbacks: count(s.id, "callback"),
        email: count(s.id, "email"),
        notInterested: count(s.id, "not_interested"),
        dnc: count(s.id, "dnc"),
        noAnswer: count(s.id, "no_answer"),
      };
    })
    .sort((a, b) => b.calls - a.calls || b.leads - a.leads);
  return {
    ...base,
    title: "Lead source report",
    subtitle: `${range}${scope} · outcomes from calls in this period`,
    columns: [
      { key: "source", label: "Source", kind: "text" },
      { key: "leads", label: "Leads", kind: "number" },
      { key: "inPool", label: "In pool", kind: "number" },
      { key: "calledLeads", label: "Leads called", kind: "number" },
      { key: "calls", label: "Calls", kind: "number" },
      { key: "answered", label: "Contacted", kind: "number" },
      { key: "qualified", label: "Qualified", kind: "number" },
      { key: "callbacks", label: "Callbacks", kind: "number" },
      { key: "email", label: "Email", kind: "number" },
      { key: "notInterested", label: "Not int.", kind: "number" },
      { key: "dnc", label: "DNC", kind: "number" },
      { key: "noAnswer", label: "No answer", kind: "number" },
    ],
    rows,
    totals: null,
  };
}
