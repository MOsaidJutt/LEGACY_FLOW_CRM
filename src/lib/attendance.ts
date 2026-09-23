import "server-only";
import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { listDays } from "./period";
import { dateSpan, zonedToUtc } from "./time";

export type AttendanceDay = {
  userId: string;
  day: string;
  scheduled: boolean;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  firstLogin: Date | null;
  lastLogout: Date | null;
  lateMinutes: number | null;
  earlyMinutes: number | null;
  scheduledMinutes: number;
  screenSeconds: number;
  activeSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
  leave: string | null;
  holiday: string | null;
};

const toMinutes = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Per user, per business day: shift, first login, last logout, late / early minutes,
 * scheduled vs. recorded time, breaks, leave and holidays (MG-07, HR-04).
 */
export async function attendance(tz: string, fromDay: string, toDay: string, userIds: string[]): Promise<AttendanceDay[]> {
  if (!userIds.length) return [];
  const { start, end } = dateSpan(tz, fromDay, toDay);
  const days = listDays(tz, fromDay, toDay);
  const { activityEvents: ev, presenceSegments: ps, users, shifts, leaveRequests, leaveTypes, holidays } = schema;

  const [events, segments, people, leaves, hols] = await Promise.all([
    db
      .select({ userId: ev.userId, type: ev.type, at: ev.createdAt })
      .from(ev)
      .where(and(inArray(ev.userId, userIds), gte(ev.createdAt, start), lt(ev.createdAt, end), inArray(ev.type, ["login", "logout", "session_end"]))),
    db
      .select({ userId: ps.userId, state: ps.state, startedAt: ps.startedAt, endedAt: ps.endedAt })
      .from(ps)
      .where(and(inArray(ps.userId, userIds), lt(ps.startedAt, end), sql`coalesce(${ps.endedAt}, now()) > ${start.toISOString()}::timestamptz`)),
    db
      .select({ id: users.id, startTime: shifts.startTime, endTime: shifts.endTime, days: shifts.days, grace: shifts.graceMinutes })
      .from(users)
      .leftJoin(shifts, eq(shifts.id, users.shiftId))
      .where(inArray(users.id, userIds)),
    db
      .select({ userId: leaveRequests.userId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, type: leaveTypes.name })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(and(inArray(leaveRequests.userId, userIds), eq(leaveRequests.status, "approved"), lte(leaveRequests.startDate, toDay), gte(leaveRequests.endDate, fromDay))),
    db.select().from(holidays).where(and(gte(holidays.date, fromDay), lte(holidays.date, toDay))),
  ]);

  const now = Date.now();
  const rows: AttendanceDay[] = [];
  for (const person of people) {
    for (const day of days) {
      const [y, m, d] = day.split("-").map(Number);
      const dayStart = zonedToUtc(tz, y, m, d);
      const dayEnd = zonedToUtc(tz, y, m, d + 1);
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      const holiday = hols.find((h) => h.date === day)?.name ?? null;
      const leave = leaves.find((l) => l.userId === person.id && l.startDate <= day && l.endDate >= day)?.type ?? null;

      let shiftStart: Date | null = null;
      let shiftEnd: Date | null = null;
      let scheduledMinutes = 0;
      const scheduled = Boolean(person.startTime && person.endTime && person.days?.includes(weekday) && !holiday && !leave);
      if (person.startTime && person.endTime && scheduled) {
        const s = toMinutes(person.startTime);
        let e = toMinutes(person.endTime);
        if (e <= s) e += 24 * 60; // overnight shift
        shiftStart = zonedToUtc(tz, y, m, d, Math.floor(s / 60), s % 60);
        shiftEnd = zonedToUtc(tz, y, m, d, Math.floor(e / 60), e % 60);
        scheduledMinutes = e - s;
      }

      const mine = events.filter((e) => e.userId === person.id && e.at >= dayStart && e.at < dayEnd);
      const logins = mine.filter((e) => e.type === "login").map((e) => e.at.getTime());
      const logouts = mine.filter((e) => e.type !== "login").map((e) => e.at.getTime());
      const firstLogin = logins.length ? new Date(Math.min(...logins)) : null;
      const lastLogoutMs = logouts.length ? Math.max(...logouts) : null;
      const stillIn = logins.length > 0 && (lastLogoutMs === null || Math.max(...logins) > lastLogoutMs);
      const lastLogout = stillIn || lastLogoutMs === null ? null : new Date(lastLogoutMs);

      let lateMinutes: number | null = null;
      let earlyMinutes: number | null = null;
      if (shiftStart && shiftEnd) {
        const grace = person.grace ?? 0;
        lateMinutes = firstLogin ? Math.max(0, Math.round((firstLogin.getTime() - shiftStart.getTime()) / 60_000) - grace) : null;
        earlyMinutes = lastLogout && lastLogout < shiftEnd ? Math.round((shiftEnd.getTime() - lastLogout.getTime()) / 60_000) : lastLogout ? 0 : null;
      }

      let active = 0;
      let idle = 0;
      let brk = 0;
      for (const s of segments) {
        if (s.userId !== person.id) continue;
        const a = Math.max(s.startedAt.getTime(), dayStart.getTime());
        const b = Math.min(s.endedAt?.getTime() ?? now, dayEnd.getTime());
        if (b <= a) continue;
        const secs = (b - a) / 1000;
        if (s.state === "active") active += secs;
        else if (s.state === "idle") idle += secs;
        else if (s.state === "break") brk += secs;
      }

      rows.push({
        userId: person.id,
        day,
        scheduled,
        shiftStart,
        shiftEnd,
        firstLogin,
        lastLogout,
        lateMinutes,
        earlyMinutes,
        scheduledMinutes,
        screenSeconds: Math.round(active + idle + brk),
        activeSeconds: Math.round(active),
        idleSeconds: Math.round(idle),
        breakSeconds: Math.round(brk),
        leave,
        holiday,
      });
    }
  }
  return rows;
}

/** Totals across days for one user. */
export function summarizeAttendance(rows: AttendanceDay[]) {
  return rows.reduce(
    (t, r) => {
      if (r.scheduled) t.scheduledDays++;
      if (r.firstLogin) t.presentDays++;
      if (r.scheduled && !r.firstLogin && !r.leave && r.day !== null) t.absentDays++;
      if ((r.lateMinutes ?? 0) > 0) {
        t.lateDays++;
        t.lateMinutes += r.lateMinutes!;
      }
      if ((r.earlyMinutes ?? 0) > 0) t.earlyDays++;
      if (r.leave) t.leaveDays++;
      t.scheduledMinutes += r.scheduledMinutes;
      t.screenSeconds += r.screenSeconds;
      t.breakSeconds += r.breakSeconds;
      return t;
    },
    { scheduledDays: 0, presentDays: 0, absentDays: 0, lateDays: 0, lateMinutes: 0, earlyDays: 0, leaveDays: 0, scheduledMinutes: 0, screenSeconds: 0, breakSeconds: 0 },
  );
}
