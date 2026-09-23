import type { Metadata } from "next";
import { and, desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { resolvePeriod } from "@/lib/period";
import { buildReport } from "@/lib/reports";
import { reviewBounds, REVIEW_PERIODS, type ReviewPeriod } from "@/lib/performance";
import { formatDateTime, isoDay } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScoreRow } from "./score-row";

export const metadata: Metadata = { title: "Performance review" };

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports.approve");
  const sp = await searchParams;
  const tz = (await getSettings()).businessTimezone;
  const type = (REVIEW_PERIODS.some((p) => p.key === sp.type) ? sp.type : "weekly") as ReviewPeriod;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : isoDay(tz);
  const { start, end } = reviewBounds(type, day);
  const report = await buildReport("performance", resolvePeriod(tz, { period: "custom", from: start, to: end }), tz);
  const { performanceReviews: PR, scoreChanges: SC, users } = schema;
  const changer = alias(users, "changer");
  const agentIds = (await db.select({ id: users.id, name: users.name }).from(users)).reduce((m, u) => m.set(u.name, u.id), new Map<string, string>());

  const reviews = await db.select().from(PR).where(and(eq(PR.periodType, type), eq(PR.periodStart, start)));
  const history = reviews.length
    ? await db
        .select({ id: SC.id, reviewId: SC.reviewId, oldScore: SC.oldScore, newScore: SC.newScore, reason: SC.reason, createdAt: SC.createdAt, by: changer.name })
        .from(SC)
        .leftJoin(changer, eq(changer.id, SC.changedBy))
        .where(inArray(SC.reviewId, reviews.map((r) => r.id)))
        .orderBy(desc(SC.createdAt))
    : [];
  const nameById = new Map([...agentIds.entries()].map(([n, id]) => [id, n]));

  return (
    <>
      <PageHeader
        title="Performance review"
        description="Review each agent's raw numbers first, then set and approve a Management Score. Every score change is kept with its reason."
      />
      <form action="/manage/performance" className="mb-5 flex flex-wrap items-end gap-2">
        <Select name="type" defaultValue={type} aria-label="Review period" className="w-36">
          {REVIEW_PERIODS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        <Input type="date" name="day" defaultValue={day} aria-label="Any day in the period" className="w-40" />
        <Button type="submit">Show period</Button>
        <p className="ml-2 text-sm text-ink-3">
          {start} to {end}
        </p>
      </form>

      <div className="flex flex-col gap-3">
        {report.rows.map((row) => {
          const userId = agentIds.get(String(row.agent)) ?? "";
          const review = reviews.find((r) => r.userId === userId);
          return (
            <ScoreRow
              key={userId}
              userId={userId}
              type={type}
              day={day}
              row={row}
              review={review ? { id: review.id, score: review.managementScore, comment: review.comment, status: review.status } : null}
            />
          );
        })}
      </div>

      {history.length ? (
        <Panel title="Score changes in this period" className="mt-5" flush>
          <ol className="divide-y divide-line">
            {history.map((h) => {
              const review = reviews.find((r) => r.id === h.reviewId);
              return (
                <li key={h.id} className="px-4 py-2.5 text-sm">
                  <span className="font-medium">{review ? nameById.get(review.userId) : ""}</span>{" "}
                  <span className="tabular-nums text-ink-2">
                    {h.oldScore ?? "none"} to {h.newScore ?? "none"}
                  </span>
                  <span className="text-ink-3">
                    {" "}
                    · {h.reason} · {h.by} · {formatDateTime(h.createdAt, tz)}
                  </span>
                </li>
              );
            })}
          </ol>
        </Panel>
      ) : null}
    </>
  );
}
