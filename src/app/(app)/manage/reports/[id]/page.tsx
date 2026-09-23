import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import type { ReportData } from "@/lib/reports";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Badge } from "@/components/ui/badge";
import { ReportTable } from "@/components/report-table";
import { SavedReportActions } from "../report-actions";

export const metadata: Metadata = { title: "Saved report" };

export default async function SavedReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("reports.view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const generator = alias(schema.users, "generator");
  const approver = alias(schema.users, "approver");
  const [row] = await db
    .select({ r: schema.reports, by: generator.name, approvedBy: approver.name })
    .from(schema.reports)
    .leftJoin(generator, eq(generator.id, schema.reports.generatedBy))
    .leftJoin(approver, eq(approver.id, schema.reports.approvedBy))
    .where(eq(schema.reports.id, id));
  if (!row) notFound();
  const tz = (await getSettings()).businessTimezone;
  const data = row.r.data as unknown as ReportData;

  return (
    <>
      <PageHeader
        title={row.r.title}
        back={{ href: "/manage/reports", label: "Reports" }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            {row.r.approvedAt ? <Badge tone="success">Approved by {row.approvedBy} on {formatDateTime(row.r.approvedAt, tz)}</Badge> : <Badge tone="warning">Awaiting approval</Badge>}
            <span>
              Saved {formatDateTime(row.r.createdAt, tz)}
              {row.by ? ` by ${row.by}` : ""}
            </span>
          </span>
        }
        actions={<SavedReportActions id={id} canApprove={user.permissions.includes("reports.approve")} approved={Boolean(row.r.approvedAt)} />}
      />
      <Panel title={data.title} description={data.subtitle} flush>
        <ReportTable data={data} />
      </Panel>
    </>
  );
}
