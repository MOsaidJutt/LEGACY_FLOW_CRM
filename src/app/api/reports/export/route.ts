import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { readSettings } from "@/lib/settings";
import { resolvePeriod } from "@/lib/period";
import { buildReport, REPORT_TYPES, type ReportData, type ReportType } from "@/lib/reports";
import { reportFileName, reportToPdf, reportToXlsx } from "@/lib/report-export";

/** RP-01: Excel / PDF export of a live report or a saved snapshot (?saved=<id>). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in again.", { status: 401 });
  if (!user.permissions.includes("reports.view")) return new Response("Not allowed.", { status: 403 });

  const url = new URL(request.url);
  const p = Object.fromEntries(url.searchParams.entries());
  const format = p.format === "pdf" ? "pdf" : "xlsx";
  const settings = await readSettings();

  let data: ReportData;
  if (p.saved) {
    if (!/^[0-9a-f-]{36}$/i.test(p.saved)) return new Response("Not found.", { status: 404 });
    const [row] = await db.select().from(schema.reports).where(eq(schema.reports.id, p.saved));
    if (!row) return new Response("Not found.", { status: 404 });
    data = row.data as unknown as ReportData;
  } else {
    const type = (REPORT_TYPES.some((t) => t.key === p.type) ? p.type : "performance") as ReportType;
    const period = resolvePeriod(settings.businessTimezone, p);
    data = await buildReport(type, period, settings.businessTimezone, { agentId: /^[0-9a-f-]{36}$/i.test(p.agent ?? "") ? p.agent : null });
  }

  const body = format === "pdf" ? await reportToPdf(data, settings.companyName) : await reportToXlsx(data, settings.companyName);
  await audit({ actorId: user.id, action: "report_exported", module: "reports", entityType: "report", entityId: p.saved ?? data.type, after: { format, from: data.fromDay, to: data.toDay } });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${reportFileName(data, format)}"`,
      "Cache-Control": "no-store",
    },
  });
}
