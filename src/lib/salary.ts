import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { ActionError } from "@/lib/actions";
import { attendance, summarizeAttendance } from "@/lib/attendance";
import { audit } from "@/lib/audit";
import { readSettings } from "@/lib/settings";

const { users, roles, employeeProfiles, salaryProfiles, salaryRecords } = schema;

export type SalaryRow = {
  userId: string;
  name: string;
  role: string;
  employeeCode: string | null;
  basicSalary: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  absenceDeduction: number;
  bonus: number;
  otherDeduction: number;
  finalSalary: number;
  note: string | null;
  finalizedAt: Date | null;
  finalizedBy: string | null;
};

/** First and last day of a YYYY-MM payroll month. */
export function monthRange(period: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new ActionError("Choose a payroll month.");
  const [y, m] = period.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { fromDay: `${period}-01`, toDay: `${period}-${String(last).padStart(2, "0")}` };
}

export const currentPeriod = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

/**
 * Basic salary + bonus - absence deduction = final payable salary.
 * The per-day rate uses the configured payroll working days, falling back to the
 * days the employee was actually scheduled that month.
 */
export function calculate(input: { basicSalary: number; absentDays: number; bonus: number; otherDeduction: number; payrollDays: number; scheduledDays: number }) {
  const days = input.payrollDays > 0 ? input.payrollDays : input.scheduledDays;
  const perDay = days > 0 ? input.basicSalary / days : 0;
  const absenceDeduction = Math.round(perDay * input.absentDays);
  const finalSalary = Math.max(0, Math.round(input.basicSalary + input.bonus - absenceDeduction - input.otherDeduction));
  return { absenceDeduction, finalSalary, perDay: Math.round(perDay) };
}

/** The salary sheet for one payroll month, recalculated from live attendance. */
export async function salarySheet(period: string): Promise<{ rows: SalaryRow[]; payrollDays: number; tz: string }> {
  const { fromDay, toDay } = monthRange(period);
  const settings = await readSettings();
  const tz = settings.businessTimezone;

  const staff = await db
    .select({
      id: users.id,
      name: users.name,
      role: roles.name,
      employeeCode: employeeProfiles.employeeCode,
      basicSalary: salaryProfiles.basicSalary,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .leftJoin(salaryProfiles, eq(salaryProfiles.userId, users.id))
    .where(eq(users.status, "active"))
    .orderBy(users.name);
  if (!staff.length) return { rows: [], payrollDays: settings.payrollWorkingDays, tz };

  const ids = staff.map((s) => s.id);
  const [days, saved, finalizers] = await Promise.all([
    attendance(tz, fromDay, toDay, ids),
    db.select().from(salaryRecords).where(and(eq(salaryRecords.period, period), inArray(salaryRecords.userId, ids))),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const names = new Map(finalizers.map((f) => [f.id, f.name]));
  const byUser = new Map(saved.map((r) => [r.userId, r]));

  const rows = staff.map((s) => {
    const summary = summarizeAttendance(days.filter((d) => d.userId === s.id));
    const record = byUser.get(s.id);
    const basicSalary = record?.basicSalary ?? s.basicSalary ?? 0;
    const bonus = record?.bonus ?? 0;
    const otherDeduction = record?.otherDeduction ?? 0;
    const { absenceDeduction, finalSalary } = calculate({
      basicSalary,
      absentDays: summary.absentDays,
      bonus,
      otherDeduction,
      payrollDays: settings.payrollWorkingDays,
      scheduledDays: summary.scheduledDays,
    });
    return {
      userId: s.id,
      name: s.name,
      role: s.role,
      employeeCode: s.employeeCode,
      basicSalary,
      workingDays: summary.scheduledDays,
      presentDays: summary.presentDays,
      absentDays: summary.absentDays,
      leaveDays: summary.leaveDays,
      absenceDeduction,
      bonus,
      otherDeduction,
      finalSalary,
      note: record?.note ?? null,
      finalizedAt: record?.finalizedAt ?? null,
      finalizedBy: record?.finalizedBy ? (names.get(record.finalizedBy) ?? null) : null,
    } satisfies SalaryRow;
  });
  return { rows, payrollDays: settings.payrollWorkingDays, tz };
}

/**
 * Saves one employee's salary for a month. Attendance is read again here, so the
 * stored figures always match the recorded absences at the moment of saving.
 */
export async function saveSalary(input: {
  userId: string;
  period: string;
  basicSalary: number;
  bonus: number;
  otherDeduction: number;
  note: string;
  finalize: boolean;
  actorId: string;
}) {
  const { fromDay, toDay } = monthRange(input.period);
  const settings = await readSettings();
  const [person] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, input.userId));
  if (!person) throw new ActionError("That employee no longer exists.");
  if (input.basicSalary < 0 || input.basicSalary > 100_000_000) throw new ActionError("Enter a basic salary between 0 and 100,000,000.");
  if (input.bonus < 0 || input.bonus > 100_000_000) throw new ActionError("Enter a bonus of 0 or more.");
  if (input.otherDeduction < 0 || input.otherDeduction > 100_000_000) throw new ActionError("Enter other deductions of 0 or more.");

  const summary = summarizeAttendance(await attendance(settings.businessTimezone, fromDay, toDay, [input.userId]));
  const { absenceDeduction, finalSalary } = calculate({
    basicSalary: input.basicSalary,
    absentDays: summary.absentDays,
    bonus: input.bonus,
    otherDeduction: input.otherDeduction,
    payrollDays: settings.payrollWorkingDays,
    scheduledDays: summary.scheduledDays,
  });

  const values = {
    userId: input.userId,
    period: input.period,
    basicSalary: input.basicSalary,
    workingDays: summary.scheduledDays,
    presentDays: summary.presentDays,
    absentDays: summary.absentDays,
    leaveDays: summary.leaveDays,
    absenceDeduction,
    bonus: input.bonus,
    otherDeduction: input.otherDeduction,
    finalSalary,
    note: input.note.slice(0, 500) || null,
    finalizedBy: input.finalize ? input.actorId : null,
    finalizedAt: input.finalize ? new Date() : null,
  };

  await db.transaction(async (tx) => {
    await tx
      .insert(salaryProfiles)
      .values({ userId: input.userId, basicSalary: input.basicSalary, updatedBy: input.actorId })
      .onConflictDoUpdate({ target: salaryProfiles.userId, set: { basicSalary: input.basicSalary, updatedBy: input.actorId, updatedAt: new Date() } });
    await tx
      .insert(salaryRecords)
      .values(values)
      .onConflictDoUpdate({ target: [salaryRecords.userId, salaryRecords.period], set: { ...values, updatedAt: new Date() } });
  });

  await audit({
    actorId: input.actorId,
    action: input.finalize ? "salary_finalized" : "salary_saved",
    module: "hr",
    entityType: "salary",
    entityId: `${input.userId}:${input.period}`,
    summary: `${input.finalize ? "Finalized" : "Saved"} ${person.name}'s salary for ${input.period}`,
    after: { basicSalary: input.basicSalary, absentDays: summary.absentDays, absenceDeduction, bonus: input.bonus, otherDeduction: input.otherDeduction, finalSalary },
  });

  return { absenceDeduction, finalSalary, absentDays: summary.absentDays, presentDays: summary.presentDays, workingDays: summary.scheduledDays };
}

/** Previous salary calculations for one employee, newest first. */
export async function salaryHistory(userId: string, limit = 24) {
  const finalizer = schema.users;
  return db
    .select({
      period: salaryRecords.period,
      basicSalary: salaryRecords.basicSalary,
      absentDays: salaryRecords.absentDays,
      absenceDeduction: salaryRecords.absenceDeduction,
      bonus: salaryRecords.bonus,
      otherDeduction: salaryRecords.otherDeduction,
      finalSalary: salaryRecords.finalSalary,
      finalizedAt: salaryRecords.finalizedAt,
      finalizedBy: finalizer.name,
      updatedAt: salaryRecords.updatedAt,
    })
    .from(salaryRecords)
    .leftJoin(finalizer, eq(finalizer.id, salaryRecords.finalizedBy))
    .where(eq(salaryRecords.userId, userId))
    .orderBy(desc(salaryRecords.period))
    .limit(limit);
}
