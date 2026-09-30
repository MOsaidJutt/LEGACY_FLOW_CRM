import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { currentPeriod, salarySheet } from "@/lib/salary";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Table, Th } from "@/components/ui/table";
import { SalaryRow } from "./salary-row";

export const metadata: Metadata = { title: "Salary" };

export default async function SalaryPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("salary.manage");
  const tz = (await getSettings()).businessTimezone;
  const sp = await searchParams;
  const asked = typeof sp.period === "string" ? sp.period : "";
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) ? asked : currentPeriod(tz);
  const { rows, payrollDays } = await salarySheet(period);

  const totals = rows.reduce(
    (t, r) => ({ basic: t.basic + r.basicSalary, deduction: t.deduction + r.absenceDeduction, bonus: t.bonus + r.bonus, payable: t.payable + r.finalSalary }),
    { basic: 0, deduction: 0, bonus: 0, payable: 0 },
  );
  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${period}-01T00:00:00Z`));

  return (
    <>
      <PageHeader
        title="Salary"
        description={`Basic salary plus bonus, less a deduction for recorded absent days. Absences come from attendance, so the figures update as attendance changes. The per-day rate uses ${payrollDays} working days a month.`}
        actions={
          <form className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-[13px] text-ink-2">
              Payroll month
              <input
                type="month"
                name="period"
                defaultValue={period}
                className="h-9 rounded-md border border-line-strong/70 bg-raised px-2.5 text-sm text-ink tabular-nums"
                aria-label="Payroll month"
              />
            </label>
            <button type="submit" className="h-9 rounded-md border border-line-strong/70 px-3 text-sm hover:bg-hover">
              Show month
            </button>
          </form>
        }
      />

      <Panel
        title={`${monthLabel}: ${rows.length} employee${rows.length === 1 ? "" : "s"}`}
        description={`Total payable PKR ${totals.payable.toLocaleString()} · basic ${totals.basic.toLocaleString()} · bonuses ${totals.bonus.toLocaleString()} · deductions ${totals.deduction.toLocaleString()}`}
        flush
      >
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-3">No active employees.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Employee</Th>
                <Th>Basic salary</Th>
                <Th className="text-right">Working days</Th>
                <Th className="text-right">Present</Th>
                <Th className="text-right">Absent</Th>
                <Th className="text-right">Absence deduction</Th>
                <Th>Bonus</Th>
                <Th>Other deductions</Th>
                <Th className="text-right">Final payable</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <SalaryRow
                  key={r.userId}
                  period={period}
                  payrollDays={payrollDays}
                  row={{
                    userId: r.userId,
                    name: r.name,
                    role: r.role,
                    employeeCode: r.employeeCode,
                    basicSalary: r.basicSalary,
                    workingDays: r.workingDays,
                    presentDays: r.presentDays,
                    absentDays: r.absentDays,
                    leaveDays: r.leaveDays,
                    absenceDeduction: r.absenceDeduction,
                    bonus: r.bonus,
                    otherDeduction: r.otherDeduction,
                    finalSalary: r.finalSalary,
                    note: r.note,
                    finalized: r.finalizedAt ? formatDateTime(r.finalizedAt, tz) : null,
                    finalizedBy: r.finalizedBy,
                  }}
                />
              ))}
            </tbody>
          </Table>
        )}
      </Panel>
    </>
  );
}
