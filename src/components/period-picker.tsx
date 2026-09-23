import Link from "next/link";
import { PERIODS, type Period } from "@/lib/period";
import { cn } from "@/lib/cn";

/** Period links plus a custom date range, as a plain GET form (works without JavaScript). */
export function PeriodPicker({ basePath, period, extra = {} }: { basePath: string; period: Period; extra?: Record<string, string> }) {
  const href = (key: string) => `${basePath}?${new URLSearchParams({ ...extra, period: key })}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1 rounded-lg border border-line bg-raised p-1">
        {PERIODS.map((p) => (
          <Link
            key={p.key}
            href={href(p.key)}
            aria-current={period.key === p.key ? "true" : undefined}
            className={cn("rounded-md px-2.5 py-1 text-[13px] transition-colors", period.key === p.key ? "bg-selected font-medium text-ink" : "text-ink-3 hover:bg-hover hover:text-ink")}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form action={basePath} className="flex items-center gap-1.5 text-[13px] text-ink-3">
        {Object.entries(extra).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <input type="hidden" name="period" value="custom" />
        <input type="date" name="from" defaultValue={period.fromDay} aria-label="From date" className="h-8 rounded-md border border-line-strong/70 bg-raised px-2 text-[13px] text-ink" />
        to
        <input type="date" name="to" defaultValue={period.toDay} aria-label="To date" className="h-8 rounded-md border border-line-strong/70 bg-raised px-2 text-[13px] text-ink" />
        <button type="submit" className="h-8 rounded-md border border-line-strong/70 bg-raised px-2.5 text-ink hover:bg-hover">
          Apply
        </button>
      </form>
    </div>
  );
}
