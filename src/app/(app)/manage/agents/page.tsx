import type { Metadata } from "next";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { agentUsers, callTotals, emptyCalls, emptyTime, liveState, productivity, timeTotals } from "@/lib/metrics";
import { attendance, summarizeAttendance } from "@/lib/attendance";
import { resolvePeriod } from "@/lib/period";
import { formatDuration } from "@/lib/time";
import { PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { PresenceBadge } from "@/components/presence-badge";
import { PeriodPicker } from "@/components/period-picker";

export const metadata: Metadata = { title: "Agents" };

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("monitor.view");
  const sp = await searchParams;
  const tz = (await getSettings()).businessTimezone;
  const period = resolvePeriod(tz, sp);
  const agents = await agentUsers();
  const ids = agents.map((a) => a.id);

  const [calls, time, att, presenceRows] = await Promise.all([
    callTotals(period.start, period.end, ids),
    timeTotals(period.start, period.end, ids),
    attendance(tz, period.fromDay, period.toDay, ids),
    ids.length ? db.select().from(schema.presence).where(inArray(schema.presence.userId, ids)) : Promise.resolve([]),
  ]);
  const presence = new Map(presenceRows.map((p) => [p.userId, p]));

  return (
    <>
      <PageHeader title="Agents" description={`Performance and time for ${period.label.toLowerCase()}. Open an agent for their activity log, calls and attendance.`} />
      <div className="mb-4">
        <PeriodPicker basePath="/manage/agents" period={period} />
      </div>
      <section className="rounded-lg border border-line bg-raised">
        <Table>
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Now</Th>
              <Th className="text-right">Calls</Th>
              <Th className="text-right">Answered</Th>
              <Th className="text-right">Callbacks</Th>
              <Th className="text-right">Qualified</Th>
              <Th className="text-right">Not int.</Th>
              <Th className="text-right">DNC</Th>
              <Th className="text-right">Talk</Th>
              <Th className="text-right">Screen</Th>
              <Th className="text-right">Active</Th>
              <Th className="text-right">Idle</Th>
              <Th className="text-right">Break</Th>
              <Th className="text-right">Productive</Th>
              <Th className="text-right">Late days</Th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const c = calls.get(a.id) ?? emptyCalls();
              const t = time.get(a.id) ?? emptyTime();
              const s = summarizeAttendance(att.filter((r) => r.userId === a.id));
              const prod = productivity(t);
              const params = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
              return (
                <Tr key={a.id}>
                  <Td>
                    <Link href={`/manage/agents/${a.id}${params ? `?${params}` : ""}`} className="font-medium hover:underline">
                      {a.name}
                    </Link>
                  </Td>
                  <Td>
                    <PresenceBadge state={liveState(presence.get(a.id))} />
                  </Td>
                  <Td className="text-right tabular-nums">{c.calls}</Td>
                  <Td className="text-right tabular-nums">{c.answered}</Td>
                  <Td className="text-right tabular-nums">{c.callbacks}</Td>
                  <Td className="text-right tabular-nums">{c.qualified}</Td>
                  <Td className="text-right tabular-nums">{c.notInterested}</Td>
                  <Td className="text-right tabular-nums">{c.dnc}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(c.talkSeconds)}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(t.screen)}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(t.active)}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(t.idle)}</Td>
                  <Td className="text-right tabular-nums">{formatDuration(t.break)}</Td>
                  <Td className="text-right tabular-nums">{prod === null ? "" : `${prod}%`}</Td>
                  <Td className="text-right tabular-nums">{s.lateDays || ""}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </section>
    </>
  );
}
