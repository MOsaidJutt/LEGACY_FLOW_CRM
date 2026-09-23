import { dateSpan, isoDay, wallParts, zonedToUtc } from "./time";

export const PERIODS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "15d", label: "Last 15 days" },
  { key: "month", label: "This month" },
  { key: "30d", label: "Last 30 days" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"] | "custom";

export type Period = { key: PeriodKey; label: string; fromDay: string; toDay: string; start: Date; end: Date; days: string[] };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function shiftDay(tz: string, day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  return isoDay(tz, zonedToUtc(tz, y, m, d + delta, 12));
}

export function listDays(tz: string, fromDay: string, toDay: string, max = 92) {
  const out: string[] = [];
  let d = fromDay;
  while (d <= toDay && out.length < max) {
    out.push(d);
    d = shiftDay(tz, d, 1);
  }
  return out;
}

/** Resolves ?period=7d or ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD in the business time zone. */
export function resolvePeriod(tz: string, params: { period?: string; from?: string; to?: string }, fallback: PeriodKey = "today"): Period {
  const today = isoDay(tz);
  let key = (params.period ?? fallback) as PeriodKey;
  let fromDay = today;
  let toDay = today;

  if (key === "custom" && params.from && params.to && DAY.test(params.from) && DAY.test(params.to)) {
    fromDay = params.from <= params.to ? params.from : params.to;
    toDay = params.from <= params.to ? params.to : params.from;
    if (toDay > today) toDay = today;
    const earliest = shiftDay(tz, toDay, -91);
    if (fromDay < earliest) fromDay = earliest;
  } else {
    if (!PERIODS.some((p) => p.key === key)) key = fallback;
    if (key === "yesterday") fromDay = toDay = shiftDay(tz, today, -1);
    else if (key === "7d") fromDay = shiftDay(tz, today, -6);
    else if (key === "15d") fromDay = shiftDay(tz, today, -14);
    else if (key === "30d") fromDay = shiftDay(tz, today, -29);
    else if (key === "month") {
      const w = wallParts(tz, new Date());
      fromDay = `${w.year}-${String(w.month).padStart(2, "0")}-01`;
    }
  }
  const { start, end } = dateSpan(tz, fromDay, toDay);
  const label =
    key === "custom"
      ? fromDay === toDay
        ? fromDay
        : `${fromDay} to ${toDay}`
      : (PERIODS.find((p) => p.key === key)?.label ?? "Today");
  return { key, label, fromDay, toDay, start, end, days: listDays(tz, fromDay, toDay) };
}
