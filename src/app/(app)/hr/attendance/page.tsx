import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { attendance, summarizeAttendance } from "@/lib/attendance";
import { resolvePeriod } from "@/lib/period";
import { formatDuration, formatTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PeriodPicker } from "@/components/period-picker";

export const metadata: Metadata = { title: "Attendance" };

export default async function AttendancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await requirePermission("hr.attendance");
  const sp = await searchParams;
  const tz = (await getSettings()).businessTimezone;
  const period = resolvePeriod(tz, sp, "7d");
  const people = await db
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(and(eq(schema.users.status, "active")))
    .orderBy(asc(schema.users.name));
  const rows = await attendance(tz, period.fromDay, period.toDay, people.map((p) => p.id));
  const single = period.fromDay === period.toDay;
  const profileBase = viewer.permissions.includes("monitor.view") ? "/manage/agents/" : viewer.permissions.includes("hr.manage") ? "/hr/employees/" : null;

  return (
    <>
      <PageHeader title="Attendance" description={`Punctuality and recorded time for ${period.label.toLowerCase()}. Late minutes count after the shift's grace period.`} />
      <div className="mb-4">
        <PeriodPicker basePath="/hr/attendance" period={period} />
      </div>
      <section className="rounded-lg border border-line bg-raised">
        <Table>
          <thead>
            <tr>
              <Th>Employee</Th>
              {single ? (
                <>
                  <Th>Shift</Th>
                  <Th>First login</Th>
                  <Th>Last logout</Th>
                  <Th className="text-right">Late</Th>
                  <Th className="text-right">Left early</Th>
                </>
              ) : (
                <>
                  <Th className="text-right">Present</Th>
                  <Th className="text-right">Absent</Th>
                  <Th className="text-right">Late days</Th>
                  <Th className="text-right">Late minutes</Th>
                  <Th className="text-right">Left early</Th>
                  <Th className="text-right">Leave</Th>
                </>
              )}
              <Th className="text-right">Break</Th>
              <Th className="text-right">Recorded</Th>
              <Th className="text-right">Scheduled</Th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const mine = rows.filter((r) => r.userId === p.id);
              const s = summarizeAttendance(mine);
              const d = mine[0];
              const name = profileBase ? (
                <Link href={`${profileBase}${p.id}${profileBase.startsWith("/manage") ? "?tab=attendance" : ""}`} className="font-medium hover:underline">
                  {p.name}
                </Link>
              ) : (
                <span className="font-medium">{p.name}</span>
              );
              return (
                <Tr key={p.id}>
                  <Td>{name}</Td>
                  {single && d ? (
                    <>
                      <Td className="text-ink-2">{d.holiday ? <Badge>Holiday</Badge> : d.leave ? <Badge tone="info">{d.leave}</Badge> : d.scheduled ? `${formatTime(d.shiftStart, tz)} to ${formatTime(d.shiftEnd, tz)}` : <span className="text-ink-3">Off</span>}</Td>
                      <Td className="tabular-nums">{d.firstLogin ? formatTime(d.firstLogin, tz) : d.scheduled ? <Badge tone="warning">Absent</Badge> : ""}</Td>
                      <Td className="tabular-nums">{d.lastLogout ? formatTime(d.lastLogout, tz) : d.firstLogin ? <span className="text-ink-3">Signed in</span> : ""}</Td>
                      <Td className={cn("text-right tabular-nums", (d.lateMinutes ?? 0) > 0 && "text-warning")}>{d.lateMinutes ? `${d.lateMinutes} min` : ""}</Td>
                      <Td className={cn("text-right tabular-nums", (d.earlyMinutes ?? 0) > 0 && "text-warning")}>{d.earlyMinutes ? `${d.earlyMinutes} min` : ""}</Td>
                    </>
                  ) : (
                    <>
                      <Td className="text-right tabular-nums">
                        {s.presentDays}
                        {s.scheduledDays ? <span className="text-ink-3"> / {s.scheduledDays}</span> : null}
                      </Td>
                      <Td className={cn("text-right tabular-nums", s.absentDays > 0 && "text-warning")}>{s.absentDays || ""}</Td>
                      <Td className={cn("text-right tabular-nums", s.lateDays > 0 && "text-warning")}>{s.lateDays || ""}</Td>
                      <Td className="text-right tabular-nums">{s.lateMinutes || ""}</Td>
                      <Td className="text-right tabular-nums">{s.earlyDays || ""}</Td>
                      <Td className="text-right tabular-nums">{s.leaveDays || ""}</Td>
                    </>
                  )}
                  <Td className="text-right tabular-nums">{s.breakSeconds ? formatDuration(s.breakSeconds) : ""}</Td>
                  <Td className="text-right tabular-nums">{s.screenSeconds ? formatDuration(s.screenSeconds) : ""}</Td>
                  <Td className="text-right tabular-nums">{s.scheduledMinutes ? formatDuration(s.scheduledMinutes * 60) : ""}</Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </section>
    </>
  );
}
