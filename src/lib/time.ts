/**
 * Time-zone helpers. Everything is stored in UTC; "today", report periods and
 * callback times are expressed in the business time zone from settings.
 */

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(tz: string) {
  let f = partFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partFormatters.set(tz, f);
  }
  return f;
}

export function wallParts(tz: string, date: Date) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(tz).formatToParts(date)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour === 24 ? 0 : out.hour, minute: out.minute, second: out.second };
}

function offsetMs(tz: string, date: Date) {
  const w = wallParts(tz, date);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(date.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in `tz` (day/month overflow is allowed). */
export function zonedToUtc(tz: string, year: number, month: number, day: number, hour = 0, minute = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMs(tz, new Date(guess));
  return new Date(guess - offsetMs(tz, new Date(first)));
}

/** [start, end) of the business day containing `ref`, shifted by `offsetDays`. */
export function dayRange(tz: string, ref = new Date(), offsetDays = 0) {
  const w = wallParts(tz, ref);
  return {
    start: zonedToUtc(tz, w.year, w.month, w.day + offsetDays),
    end: zonedToUtc(tz, w.year, w.month, w.day + offsetDays + 1),
  };
}

/** "YYYY-MM-DD" in the business time zone. */
export function isoDay(tz: string, date = new Date()) {
  const w = wallParts(tz, date);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** Range for "YYYY-MM-DD" .. "YYYY-MM-DD" inclusive, in the business time zone. */
export function dateSpan(tz: string, from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return { start: zonedToUtc(tz, fy, fm, fd), end: zonedToUtc(tz, ty, tm, td + 1) };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Parses an <input type="datetime-local"> value as wall time in `tz`. */
export function parseWallInput(tz: string, value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return zonedToUtc(tz, +m[1], +m[2], +m[3], +m[4], +m[5]);
}

export function toWallInput(tz: string, date: Date) {
  const w = wallParts(tz, date);
  return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`;
}

export function tzShortName(tz: string, date = new Date()) {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? tz;
}

export function formatDateTime(date: Date | string | null | undefined, tz: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));
}

export function formatTime(date: Date | string | null | undefined, tz: string) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(date));
}

export function formatDate(date: Date | string | null | undefined, tz: string, withWeekday = false) {
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: withWeekday ? "long" : undefined,
    month: "short",
    day: "numeric",
    year: withWeekday ? undefined : "numeric",
  }).format(new Date(date));
}

export function relativeTime(date: Date | string, now = new Date()) {
  const diff = new Date(date).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  if (min < 1) return diff >= 0 ? "now" : "just now";
  const label = min < 60 ? `${min} min` : min < 60 * 24 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

/** 3725 -> "1h 02m", 252 -> "4m 12s", 0 -> "0m" */
export function formatDuration(seconds: number | null | undefined) {
  const s = Math.max(0, Math.round(seconds ?? 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0 && s < 600) return `${m}m ${pad(s % 60)}s`;
  if (m > 0) return `${m}m`;
  return s > 0 ? `${s}s` : "0m";
}
