export type ReviewPeriod = "weekly" | "15day" | "monthly";

export const REVIEW_PERIODS: { key: ReviewPeriod; label: string }[] = [
  { key: "weekly", label: "Weekly" },
  { key: "15day", label: "15-day" },
  { key: "monthly", label: "Monthly" },
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Calendar bounds: weeks run Monday to Sunday, 15-day periods are 1-15 and 16-end of month. */
export function reviewBounds(type: ReviewPeriod, day: string) {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (type === "weekly") {
    const offset = (date.getUTCDay() + 6) % 7;
    const start = new Date(Date.UTC(y, m - 1, d - offset));
    const end = new Date(Date.UTC(y, m - 1, d - offset + 6));
    return { start: iso(start), end: iso(end) };
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (type === "15day") {
    return d <= 15 ? { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m - 1, 15))) } : { start: iso(new Date(Date.UTC(y, m - 1, 16))), end: iso(new Date(Date.UTC(y, m - 1, last))) };
  }
  return { start: iso(new Date(Date.UTC(y, m - 1, 1))), end: iso(new Date(Date.UTC(y, m - 1, last))) };
}
