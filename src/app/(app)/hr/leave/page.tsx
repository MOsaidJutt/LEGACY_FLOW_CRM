import type { Metadata } from "next";
import { asc, desc, eq, gte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { isoDay } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge, type Tone } from "@/components/ui/badge";
import { HolidayForm, HolidayRow, LeaveDecision, LeaveForm } from "./leave-client";

export const metadata: Metadata = { title: "Leave" };
const TONE: Record<string, Tone> = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" };

export default async function LeavePage() {
  await requirePermission("hr.manage");
  const tz = (await getSettings()).businessTimezone;
  const { leaveRequests, leaveTypes, users, holidays } = schema;
  const decider = alias(users, "decider");
  const year = isoDay(tz).slice(0, 4);

  const [requests, types, people, hols] = await Promise.all([
    db
      .select({ l: leaveRequests, name: users.name, type: leaveTypes.name, decider: decider.name })
      .from(leaveRequests)
      .innerJoin(users, eq(users.id, leaveRequests.userId))
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .leftJoin(decider, eq(decider.id, leaveRequests.decidedBy))
      .orderBy(desc(leaveRequests.startDate))
      .limit(200),
    db.select().from(leaveTypes).where(eq(leaveTypes.active, true)).orderBy(asc(leaveTypes.name)),
    db.select({ id: users.id, name: users.name }).from(users).where(eq(users.status, "active")).orderBy(asc(users.name)),
    db.select().from(holidays).where(gte(holidays.date, `${year}-01-01`)).orderBy(asc(holidays.date)),
  ]);
  const pending = requests.filter((r) => r.l.status === "pending");

  return (
    <>
      <PageHeader title="Leave and holidays" description="Record leave, decide pending requests and keep the holiday calendar. Approved leave and holidays are excluded from punctuality." />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {pending.length ? (
            <Panel title="Waiting for a decision" flush>
              <ul className="divide-y divide-line">
                {pending.map((r) => (
                  <LeaveDecision
                    key={r.l.id}
                    id={r.l.id}
                    summary={`${r.name} · ${r.type} · ${r.l.startDate}${r.l.endDate !== r.l.startDate ? ` to ${r.l.endDate}` : ""}`}
                    reason={r.l.reason}
                  />
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel title="Record leave">
            <LeaveForm people={people} types={types.map((t) => ({ id: t.id, name: t.name }))} />
          </Panel>
          <Panel title="Leave history" flush>
            {requests.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-3">No leave recorded yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Employee</Th>
                    <Th>Type</Th>
                    <Th>Dates</Th>
                    <Th>Status</Th>
                    <Th>Decided by</Th>
                    <Th>Reason / comment</Th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <Tr key={r.l.id}>
                      <Td className="font-medium">{r.name}</Td>
                      <Td className="text-ink-2">{r.type}</Td>
                      <Td className="whitespace-nowrap tabular-nums">
                        {r.l.startDate}
                        {r.l.endDate !== r.l.startDate ? ` to ${r.l.endDate}` : ""}
                      </Td>
                      <Td>
                        <Badge tone={TONE[r.l.status]}>{r.l.status[0].toUpperCase() + r.l.status.slice(1)}</Badge>
                      </Td>
                      <Td className="text-ink-2">{r.decider}</Td>
                      <Td className="max-w-[24rem] truncate text-ink-3">{[r.l.reason, r.l.comment].filter(Boolean).join(" · ")}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
        <Panel title={`Holidays ${year}`} className="xl:sticky xl:top-6">
          <HolidayForm />
          <ul className="mt-4 flex flex-col divide-y divide-line border-t border-line">
            {hols.length === 0 ? <li className="py-4 text-sm text-ink-3">No holidays added for this year.</li> : null}
            {hols.map((h) => (
              <HolidayRow key={h.id} id={h.id} date={h.date} name={h.name} />
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
