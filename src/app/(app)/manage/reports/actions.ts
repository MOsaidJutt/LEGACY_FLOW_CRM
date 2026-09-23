"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { resolvePeriod } from "@/lib/period";
import { buildReport, REPORT_TYPES, type ReportType } from "@/lib/reports";

/** RP-04: keep a finalized snapshot of a report so it stays exactly as generated. */
export async function saveReportAction(params: Record<string, string>): Promise<ActionState> {
  let id: string;
  try {
    const user = await authorize("reports.view");
    const settings = await getSettings();
    const type = (REPORT_TYPES.some((t) => t.key === params.type) ? params.type : "performance") as ReportType;
    const period = resolvePeriod(settings.businessTimezone, params);
    const agentId = /^[0-9a-f-]{36}$/i.test(params.agent ?? "") ? params.agent : null;
    const data = await buildReport(type, period, settings.businessTimezone, { agentId });
    const [row] = await db
      .insert(schema.reports)
      .values({ type, title: data.title, periodStart: period.fromDay, periodEnd: period.toDay, filters: { agentId }, data: data as unknown as Record<string, unknown>, generatedBy: user.id })
      .returning({ id: schema.reports.id });
    id = row.id;
    await audit({ actorId: user.id, action: "report_saved", module: "reports", entityType: "report", entityId: id, after: { type, from: period.fromDay, to: period.toDay } });
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/manage/reports");
  redirect(`/manage/reports/${id}`);
}

export async function approveReportAction(reportId: string): Promise<ActionState> {
  try {
    const user = await authorize("reports.approve");
    const [row] = await db
      .update(schema.reports)
      .set({ approvedBy: user.id, approvedAt: new Date() })
      .where(and(eq(schema.reports.id, reportId), isNull(schema.reports.approvedAt)))
      .returning({ id: schema.reports.id });
    if (!row) return { error: "This report is already approved." };
    await audit({ actorId: user.id, action: "report_approved", module: "reports", entityType: "report", entityId: reportId });
    revalidatePath(`/manage/reports/${reportId}`);
    return { ok: true, message: "Report approved." };
  } catch (error) {
    return failure(error);
  }
}
