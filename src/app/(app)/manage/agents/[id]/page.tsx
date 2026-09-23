import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { callTotals, emptyCalls, emptyTime, liveState, productivity, timeTotals } from "@/lib/metrics";
import { attendance, summarizeAttendance } from "@/lib/attendance";
import { resolvePeriod } from "@/lib/period";
import { formatDateTime, formatDuration, formatTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader, Panel, StatRow } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge, toneOf } from "@/components/ui/badge";
import { PresenceBadge } from "@/components/presence-badge";
import { PeriodPicker } from "@/components/period-picker";

export const metadata: Metadata = { title: "Agent" };

const TABS = [
  { key: "summary", label: "Summary" },
  { key: "activity", label: "Activity log" },
  { key: "calls", label: "Calls" },
  { key: "attendance", label: "Attendance" },
] as const;

export default async function AgentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requirePermission("monitor.view");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { users, roles, presence, leads, callbacks, activityEvents, calls, dispositions } = schema;
  const [agent] = await db.select({ id: users.id, name: users.name, email: users.email, role: roles.name, status: users.status }).from(users).innerJoin(roles, eq(roles.id, users.roleId)).where(eq(users.id, id));
  if (!agent) notFound();

  const tz = (await getSettings()).businessTimezone;
  const period = resolvePeriod(tz, sp);
  const tab = TABS.some((t) => t.key === sp.tab) ? sp.tab! : "summary";
  const keep = Object.fromEntries(Object.entries({ period: sp.period, from: sp.from, to: sp.to }).filter(([, v]) => v)) as Record<string, string>;
  const tabHref = (t: string) => `/manage/agents/${id}?${new URLSearchParams({ ...keep, tab: t })}`;
  const inRange = (col: typeof activityEvents.createdAt | typeof calls.startedAt) => and(gte(col, period.start), lt(col, period.end));

  const [c, t, att, [p], [list], [cbs]] = await Promise.all([
    callTotals(period.start, period.end, [id]).then((m) => m.get(id) ?? emptyCalls()),
    timeTotals(period.start, period.end, [id]).then((m) => m.get(id) ?? emptyTime()),
    attendance(tz, period.fromDay, period.toDay, [id]),
    db.select().from(presence).where(eq(presence.userId, id)),
    db
      .select({ working: sql<number>`(count(*) filter (where ${leads.status} = 'assigned'))::int`, followUps: sql<number>`(count(*) filter (where ${leads.status} = 'follow_up'))::int` })
      .from(leads)
      .where(and(eq(leads.assignedTo, id), inArray(leads.status, ["assigned", "follow_up"]))),
    db
      .select({ pending: sql<number>`count(*)::int`, overdue: sql<number>`(count(*) filter (where ${callbacks.dueAt} < now()))::int` })
      .from(callbacks)
      .where(and(eq(callbacks.agentId, id), eq(callbacks.status, "pending"))),
  ]);
  const s = summarizeAttendance(att);
  const prod = productivity(t);
  const canListen = viewer.permissions.includes("calls.recordings");

  let body: React.ReactNode = null;
  if (tab === "activity") {
    const events = await db.select().from(activityEvents).where(and(eq(activityEvents.userId, id), inRange(activityEvents.createdAt))).orderBy(desc(activityEvents.createdAt)).limit(300);
    body = (
      <Panel title="Activity log" description="Logins, lead requests, calls, outcomes, breaks and idle periods, newest first." flush>
        {events.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-3">No activity in this period.</p>
        ) : (
          <ol className="divide-y divide-line">
            {events.map((e) => (
              <li key={e.id} className="flex gap-4 px-4 py-2 text-sm">
                <span className="w-32 shrink-0 tabular-nums text-ink-3">{formatDateTime(e.createdAt, tz)}</span>
                <span className="w-24 shrink-0 text-xs text-ink-3">{e.type.replace(/_/g, " ")}</span>
                <span className="min-w-0 text-ink">{e.summary}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    );
  } else if (tab === "calls") {
    const rows = await db
      .select({ id: calls.id, startedAt: calls.startedAt, duration: calls.durationSec, notes: calls.notes, recordingUrl: calls.recordingUrl, method: calls.method, leadId: leads.id, company: leads.company, contact: leads.contactName, outcome: dispositions.label, tone: dispositions.tone })
      .from(calls)
      .innerJoin(leads, eq(leads.id, calls.leadId))
      .leftJoin(dispositions, eq(dispositions.id, calls.dispositionId))
      .where(and(eq(calls.agentId, id), inRange(calls.startedAt)))
      .orderBy(desc(calls.startedAt))
      .limit(300);
    body = (
      <Panel title="Calls" flush>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-3">No calls in this period.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Lead</Th>
                <Th>Outcome</Th>
                <Th className="text-right">Duration</Th>
                <Th>Notes</Th>
                {canListen ? <Th>Recording</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap tabular-nums">{formatDateTime(r.startedAt, tz)}</Td>
                  <Td>
                    <Link href={`/manage/leads/${r.leadId}`} className="font-medium hover:underline">
                      {r.company || r.contact}
                    </Link>
                  </Td>
                  <Td>{r.outcome ? <Badge tone={toneOf(r.tone)}>{r.outcome}</Badge> : <span className="text-ink-3">No outcome</span>}</Td>
                  <Td className="text-right tabular-nums">{r.duration != null ? formatDuration(r.duration) : ""}</Td>
                  <Td className="max-w-[28rem] truncate text-ink-2">{r.notes}</Td>
                  {canListen ? <Td>{r.recordingUrl ? <audio controls preload="none" src={r.recordingUrl} className="h-8 w-56" /> : <span className="text-xs text-ink-3">Not available</span>}</Td> : null}
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    );
  } else if (tab === "attendance") {
    body = (
      <Panel title="Attendance and punctuality" flush>
        <Table>
          <thead>
            <tr>
              <Th>Day</Th>
              <Th>Shift</Th>
              <Th>First login</Th>
              <Th>Last logout</Th>
              <Th className="text-right">Late</Th>
              <Th className="text-right">Left early</Th>
              <Th className="text-right">Break</Th>
              <Th className="text-right">Recorded</Th>
              <Th className="text-right">Scheduled</Th>
            </tr>
          </thead>
          <tbody>
            {[...att].reverse().map((r) => (
              <Tr key={r.day}>
                <Td className="whitespace-nowrap tabular-nums">{r.day}</Td>
                <Td className="text-ink-2">{r.holiday ? <Badge>Holiday: {r.holiday}</Badge> : r.leave ? <Badge tone="info">{r.leave}</Badge> : r.scheduled ? `${formatTime(r.shiftStart, tz)} to ${formatTime(r.shiftEnd, tz)}` : <span className="text-ink-3">Off</span>}</Td>
                <Td className="tabular-nums">{r.firstLogin ? formatTime(r.firstLogin, tz) : r.scheduled ? <Badge tone="warning">Absent</Badge> : ""}</Td>
                <Td className="tabular-nums">{r.lastLogout ? formatTime(r.lastLogout, tz) : r.firstLogin ? <span className="text-ink-3">Still signed in</span> : ""}</Td>
                <Td className={cn("text-right tabular-nums", (r.lateMinutes ?? 0) > 0 && "text-warning")}>{r.lateMinutes ? `${r.lateMinutes} min` : ""}</Td>
                <Td className={cn("text-right tabular-nums", (r.earlyMinutes ?? 0) > 0 && "text-warning")}>{r.earlyMinutes ? `${r.earlyMinutes} min` : ""}</Td>
                <Td className="text-right tabular-nums">{r.breakSeconds ? formatDuration(r.breakSeconds) : ""}</Td>
                <Td className="text-right tabular-nums">{r.screenSeconds ? formatDuration(r.screenSeconds) : ""}</Td>
                <Td className="text-right tabular-nums">{r.scheduledMinutes ? formatDuration(r.scheduledMinutes * 60) : ""}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    );
  } else {
    body = (
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Calls and outcomes">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ["Calls", c.calls],
              ["Answered", c.answered],
              ["No answer", c.noAnswer],
              ["Callbacks set", c.callbacks],
              ["Qualified", c.qualified],
              ["Email", c.email],
              ["Not interested", c.notInterested],
              ["Do not call", c.dnc],
              ["Talk time", formatDuration(c.talkSeconds)],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Time">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            {[
              ["CRM screen time", formatDuration(t.screen)],
              ["Active", formatDuration(t.active)],
              ["Idle", formatDuration(t.idle)],
              ["Break", formatDuration(t.break)],
              ["Productive", prod === null ? "n/a" : `${prod}%`],
              ["Days present", `${s.presentDays} of ${s.scheduledDays || period.days.length}`],
              ["Late days", s.lateDays ? `${s.lateDays} (${s.lateMinutes} min)` : "0"],
              ["Left early", s.earlyDays],
              ["Leave days", s.leaveDays],
            ].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-xs text-ink-3">{k}</dt>
                <dd className="mt-0.5 text-lg font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={agent.name}
        back={{ href: "/manage/agents", label: "Agents" }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <PresenceBadge state={liveState(p)} />
            <span>
              {agent.role} · {agent.email}
            </span>
          </span>
        }
      />
      <div className="flex flex-col gap-5">
        <StatRow
          items={[
            { label: "Working leads now", value: list.working, href: `/manage/leads?agent=${id}&status=assigned` },
            { label: "Follow-ups now", value: list.followUps, href: `/manage/leads?agent=${id}&status=follow_up` },
            { label: "Pending callbacks", value: cbs.pending, hint: cbs.overdue ? `${cbs.overdue} overdue` : undefined },
            { label: `Calls (${period.label.toLowerCase()})`, value: c.calls },
            { label: "Productive", value: prod === null ? "n/a" : `${prod}%` },
          ]}
        />
        <PeriodPicker basePath={`/manage/agents/${id}`} period={period} extra={{ tab }} />
        <div className="flex gap-1 border-b border-line" role="tablist">
          {TABS.map((x) => (
            <Link
              key={x.key}
              href={tabHref(x.key)}
              role="tab"
              aria-selected={x.key === tab}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm transition-colors", x.key === tab ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}
            >
              {x.label}
            </Link>
          ))}
        </div>
        {body}
      </div>
    </>
  );
}
