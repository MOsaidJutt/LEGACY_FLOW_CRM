import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { Inbox } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { poolCount, processExpiredRequests } from "@/lib/leads/assignment";
import { agentUsers, callTotals, emptyCalls, emptyTime, liveState, loginSpans, productivity, sumCalls, timeTotals } from "@/lib/metrics";
import { dayRange, formatDate, formatDuration, formatTime, relativeTime, tzShortName } from "@/lib/time";
import { PageHeader, Panel, StatRow, Notice } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { PresenceBadge } from "@/components/presence-badge";
import { AutoRefresh } from "@/components/auto-refresh";

export const metadata: Metadata = { title: "Overview" };

export default async function ManageOverview() {
  const user = await requirePermission("monitor.view", "leads.manage");
  await processExpiredRequests();
  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const { start, end } = dayRange(tz);
  const { leads, presence, leadRequests, activityEvents, users, leadSources, dispositions } = schema;
  const canMonitor = user.permissions.includes("monitor.view");

  const agents = await agentUsers();
  const ids = agents.map((a) => a.id);
  const [statusRows, pool, [pending], calls, time, spans, presenceRows, feed, sources] = await Promise.all([
    db.select({ status: leads.status, n: sql<number>`count(*)::int` }).from(leads).groupBy(leads.status),
    poolCount(),
    db.select({ n: sql<number>`count(*)::int` }).from(leadRequests).where(eq(leadRequests.status, "pending")),
    callTotals(start, end, ids),
    canMonitor ? timeTotals(start, end, ids) : Promise.resolve(new Map()),
    loginSpans(start, end, ids),
    ids.length ? db.select().from(presence).where(inArray(presence.userId, ids)) : Promise.resolve([]),
    canMonitor
      ? db
          .select({ id: activityEvents.id, type: activityEvents.type, summary: activityEvents.summary, createdAt: activityEvents.createdAt, name: users.name, userId: users.id })
          .from(activityEvents)
          .innerJoin(users, eq(users.id, activityEvents.userId))
          .where(inArray(activityEvents.userId, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]))
          .orderBy(desc(activityEvents.createdAt))
          .limit(14)
      : Promise.resolve([]),
    db
      .select({
        id: leadSources.id,
        name: leadSources.name,
        total: sql<number>`count(${leads.id})::int`,
        available: sql<number>`(count(${leads.id}) filter (where ${leads.status} = 'available'))::int`,
        called: sql<number>`(count(${leads.id}) filter (where ${leads.callCount} > 0))::int`,
        qualified: sql<number>`(count(${leads.id}) filter (where ${dispositions.key} = 'qualified'))::int`,
      })
      .from(leadSources)
      .leftJoin(leads, eq(leads.sourceId, leadSources.id))
      .leftJoin(dispositions, eq(dispositions.id, leads.lastDispositionId))
      .groupBy(leadSources.id, leadSources.name)
      .orderBy(desc(sql`count(${leads.id})`))
      .limit(8),
  ]);

  const byStatus = (s: string) => statusRows.find((r) => r.status === s)?.n ?? 0;
  const totalLeads = statusRows.reduce((sum, r) => sum + r.n, 0);
  const floor = sumCalls(calls.values());
  const presenceBy = new Map(presenceRows.map((p) => [p.userId, p]));
  const now = new Date();
  const online = agents.filter((a) => liveState(presenceBy.get(a.id)) !== "offline").length;

  return (
    <>
      <AutoRefresh everyMs={30_000} />
      <PageHeader title="Operations" description={`${formatDate(now, tz, true)} · ${tzShortName(tz)} · ${online} of ${agents.length} agents online`} />

      <div className="flex flex-col gap-5">
        {pending.n > 0 ? (
          <Notice tone="warning" className="flex items-center gap-2">
            <Inbox className="size-4 text-warning" aria-hidden />
            <span>
              {pending.n} lead {pending.n === 1 ? "request is" : "requests are"} waiting.{" "}
              <Link href="/manage/requests" className="font-medium underline underline-offset-4">
                Review requests
              </Link>
            </span>
          </Notice>
        ) : null}

        <StatRow
          items={[
            { label: "Leads in CRM", value: totalLeads.toLocaleString(), href: "/manage/leads" },
            { label: "Callable in pool", value: pool.toLocaleString(), hint: `${byStatus("available") - pool} without a usable number`, href: "/manage/leads?status=available" },
            { label: "Assigned", value: byStatus("assigned").toLocaleString(), href: "/manage/leads?status=assigned" },
            { label: "Follow-ups", value: byStatus("follow_up").toLocaleString(), href: "/manage/leads?status=follow_up" },
            { label: "Closed", value: byStatus("closed").toLocaleString(), href: "/manage/leads?status=closed" },
            { label: "Do not call", value: byStatus("dnc").toLocaleString(), href: "/manage/leads?status=dnc" },
          ]}
        />

        <StatRow
          items={[
            { label: "Calls today", value: floor.calls },
            { label: "Answered", value: floor.answered },
            { label: "No answer", value: floor.noAnswer },
            { label: "Callbacks set", value: floor.callbacks },
            { label: "Qualified", value: floor.qualified },
            { label: "Talk time", value: formatDuration(floor.talkSeconds) },
          ]}
        />

        <Panel title="Agents today" description="Live status and today's numbers. Open an agent for their full history." flush>
          <Table>
            <thead>
              <tr>
                <Th>Agent</Th>
                <Th>Status</Th>
                <Th>First login</Th>
                <Th className="text-right">Calls</Th>
                <Th className="text-right">Answered</Th>
                <Th className="text-right">Callbacks</Th>
                <Th className="text-right">Qualified</Th>
                <Th className="text-right">Talk</Th>
                {canMonitor ? (
                  <>
                    <Th className="text-right">Active</Th>
                    <Th className="text-right">Idle</Th>
                    <Th className="text-right">Break</Th>
                    <Th className="text-right">Productive</Th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const c = calls.get(a.id) ?? emptyCalls();
                const t = time.get(a.id) ?? emptyTime();
                const p = presenceBy.get(a.id);
                const state = liveState(p);
                const prod = productivity(t);
                return (
                  <Tr key={a.id}>
                    <Td>
                      <Link href={`/manage/agents/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                    </Td>
                    <Td>
                      <PresenceBadge state={state} detail={state !== "offline" && p ? relativeTime(p.since, now).replace(" ago", "") : undefined} />
                    </Td>
                    <Td className="tabular-nums text-ink-2">{spans.get(a.id)?.firstLogin ? formatTime(spans.get(a.id)!.firstLogin, tz) : ""}</Td>
                    <Td className="text-right tabular-nums">{c.calls}</Td>
                    <Td className="text-right tabular-nums">{c.answered}</Td>
                    <Td className="text-right tabular-nums">{c.callbacks}</Td>
                    <Td className="text-right tabular-nums">{c.qualified}</Td>
                    <Td className="text-right tabular-nums">{formatDuration(c.talkSeconds)}</Td>
                    {canMonitor ? (
                      <>
                        <Td className="text-right tabular-nums">{formatDuration(t.active)}</Td>
                        <Td className="text-right tabular-nums">{formatDuration(t.idle)}</Td>
                        <Td className="text-right tabular-nums">{formatDuration(t.break)}</Td>
                        <Td className="text-right tabular-nums">{prod === null ? "" : `${prod}%`}</Td>
                      </>
                    ) : null}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
          {agents.length === 0 ? <p className="px-4 py-8 text-center text-sm text-ink-3">No agent accounts yet. An admin can add them under Users.</p> : null}
        </Panel>

        <div className="grid gap-5 xl:grid-cols-2">
          <Panel title="Lead sources" description="How each list is performing." flush>
            {sources.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-3">Sources appear after the first import.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Source</Th>
                    <Th className="text-right">Leads</Th>
                    <Th className="text-right">In pool</Th>
                    <Th className="text-right">Called</Th>
                    <Th className="text-right">Qualified</Th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <Tr key={s.id}>
                      <Td className="max-w-[16rem] truncate font-medium">{s.name}</Td>
                      <Td className="text-right tabular-nums">{s.total}</Td>
                      <Td className="text-right tabular-nums">{s.available}</Td>
                      <Td className="text-right tabular-nums">{s.called}</Td>
                      <Td className="text-right tabular-nums">{s.qualified}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          {canMonitor ? (
            <Panel title="Latest activity" flush>
              {feed.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-3">Logins, calls, outcomes and breaks appear here as they happen.</p>
              ) : (
                <ol className="divide-y divide-line">
                  {feed.map((e) => (
                    <li key={e.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                      <span className="w-16 shrink-0 tabular-nums text-ink-3">{formatTime(e.createdAt, tz)}</span>
                      <Link href={`/manage/agents/${e.userId}`} className="shrink-0 font-medium hover:underline">
                        {e.name}
                      </Link>
                      <span className="min-w-0 truncate text-ink-2">{e.summary ?? e.type}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
