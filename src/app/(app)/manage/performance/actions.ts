"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { reviewBounds, REVIEW_PERIODS, type ReviewPeriod } from "@/lib/performance";
import { resolvePeriod } from "@/lib/period";
import { buildReport } from "@/lib/reports";

/**
 * MG-08 / RP-03: store the Management Score for an agent and period with the raw
 * metrics it was based on. Every change keeps the previous value and the reason.
 */
export async function saveScoreAction(input: { userId: string; type: ReviewPeriod; day: string; score: number | null; reason: string }): Promise<ActionState> {
  try {
    const user = await authorize("reports.approve");
    if (!REVIEW_PERIODS.some((p) => p.key === input.type)) return { error: "Choose a review period." };
    if (input.score !== null && (!Number.isInteger(input.score) || input.score < 0 || input.score > 100)) return { error: "Scores go from 0 to 100." };
    const reason = input.reason.trim().slice(0, 1000);
    const { start, end } = reviewBounds(input.type, input.day);
    const tz = (await getSettings()).businessTimezone;
    const report = await buildReport("performance", resolvePeriod(tz, { period: "custom", from: start, to: end }), tz, { agentId: input.userId });
    const metrics = Object.fromEntries(Object.entries(report.rows[0] ?? {}).filter(([, v]) => typeof v === "number")) as Record<string, number>;

    await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(schema.performanceReviews)
        .where(and(eq(schema.performanceReviews.userId, input.userId), eq(schema.performanceReviews.periodType, input.type), eq(schema.performanceReviews.periodStart, start)))
        .for("update");
      const changed = (existing?.managementScore ?? null) !== input.score;
      if (existing && changed && reason.length < 3) throw new Error("REASON");
      if (existing) {
        await tx
          .update(schema.performanceReviews)
          .set({ managementScore: input.score, comment: reason || existing.comment, metrics, ...(changed && existing.status === "approved" ? { status: "draft" as const, approvedBy: null, approvedAt: null } : {}) })
          .where(eq(schema.performanceReviews.id, existing.id));
        if (changed) await tx.insert(schema.scoreChanges).values({ reviewId: existing.id, oldScore: existing.managementScore, newScore: input.score, reason, changedBy: user.id });
      } else {
        const [row] = await tx
          .insert(schema.performanceReviews)
          .values({ userId: input.userId, periodType: input.type, periodStart: start, periodEnd: end, metrics, managementScore: input.score, comment: reason || null })
          .returning({ id: schema.performanceReviews.id });
        await tx.insert(schema.scoreChanges).values({ reviewId: row.id, oldScore: null, newScore: input.score, reason: reason || "Initial score", changedBy: user.id });
      }
      await audit({ actorId: user.id, action: "management_score_set", module: "reports", entityType: "user", entityId: input.userId, before: { score: existing?.managementScore ?? null }, after: { score: input.score, period: `${start}..${end}`, reason } }, tx);
    });
    revalidatePath("/manage/performance");
    return { ok: true, message: "Score saved." };
  } catch (error) {
    if (error instanceof Error && error.message === "REASON") return { error: "Give a reason for changing the score." };
    return failure(error);
  }
}

export async function approveReviewAction(reviewId: string): Promise<ActionState> {
  try {
    const user = await authorize("reports.approve");
    const [row] = await db
      .update(schema.performanceReviews)
      .set({ status: "approved", approvedBy: user.id, approvedAt: new Date() })
      .where(and(eq(schema.performanceReviews.id, reviewId), eq(schema.performanceReviews.status, "draft")))
      .returning({ userId: schema.performanceReviews.userId, score: schema.performanceReviews.managementScore });
    if (!row) return { error: "Already approved." };
    await audit({ actorId: user.id, action: "performance_approved", module: "reports", entityType: "performance_review", entityId: reviewId, after: { score: row.score } });
    revalidatePath("/manage/performance");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
