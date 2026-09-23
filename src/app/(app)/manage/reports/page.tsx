import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { resolvePeriod } from "@/lib/period";
import { agentUsers } from "@/lib/metrics";
import { buildReport, REPORT_TYPES, type ReportType } from "@/lib/reports";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PeriodPicker } from "@/components/period-picker";
import { ReportTable } from "@/components/report-table";
import { LiveReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePermission("reports.view");
  const sp = await searchParams;
  const tz = (await getSettings()).businessTimezone;
  const type = (REPORT_TYPES.some((t) => t.key === sp.type) ? sp.type : "performance") as ReportType;
  const period = resolvePeriod(tz, sp, "7d");
  const agentId = /^[0-9a-f-]{36}$/i.test(sp.agent ?? "") ? sp.agent! : "";
  const generator = alias(schema.users, "generator");
  const approver = alias(schema.users, "approver");

  const [data, agents, saved] = await Promise.all([
    buildReport(type, period, tz, { agentId: agentId || null }),
    agentUsers(),
    db
      .select({ r: schema.reports, by: generator.name, approvedBy: approver.name })
      .from(schema.reports)
      .leftJoin(generator, eq(generator.id, schema.reports.generatedBy))
      .leftJoin(approver, eq(approver.id, schema.reports.approvedBy))
      .orderBy(desc(schema.reports.createdAt))
      .limit(25),
  ]);
  const params: Record<string, string> = Object.fromEntries(
    Object.entries({ type, period: period.key, from: period.key === "custom" ? period.fromDay : "", to: period.key === "custom" ? period.toDay : "", agent: agentId }).filter(([, v]) => v),
  );
  const keep = Object.fromEntries(Object.entries({ type, agent: agentId }).filter(([, v]) => v)) as Record<string, string>;

  return (
    <>
      <PageHeader title="Reports" description="Generate a report for any period, export it to Excel or PDF, and save a finalized copy for approval." />
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-1 border-b border-line" role="tablist">
          {REPORT_TYPES.map((t) => (
            <Link
              key={t.key}
              role="tab"
              aria-selected={t.key === type}
              href={`/manage/reports?${new URLSearchParams({ ...params, type: t.key })}`}
              className={cn("-mb-px border-b-2 px-3 py-2 text-sm transition-colors", t.key === type ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink")}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <p className="-mt-2 text-sm text-ink-3">{REPORT_TYPES.find((t) => t.key === type)?.description}</p>

        <div className="flex flex-wrap items-center gap-3">
          <PeriodPicker basePath="/manage/reports" period={period} extra={keep} />
          <form action="/manage/reports" className="flex items-center gap-2">
            <input type="hidden" name="type" value={type} />
            <input type="hidden" name="period" value={period.key} />
            {period.key === "custom" ? (
              <>
                <input type="hidden" name="from" value={period.fromDay} />
                <input type="hidden" name="to" value={period.toDay} />
              </>
            ) : null}
            <Select name="agent" defaultValue={agentId} aria-label="Agent" className="h-8 w-44 text-[13px]">
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Button type="submit" size="sm">
              Apply
            </Button>
          </form>
        </div>

        <Panel title={data.title} description={data.subtitle} actions={<LiveReportActions params={params} />} flush>
          <ReportTable data={data} />
        </Panel>

        <Panel title="Saved reports" description="Finalized copies keep their numbers even if underlying data changes later." flush>
          {saved.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">Save a report above to keep a finalized copy here.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Report</Th>
                  <Th>Period</Th>
                  <Th>Generated</Th>
                  <Th>Approval</Th>
                </tr>
              </thead>
              <tbody>
                {saved.map(({ r, by, approvedBy }) => (
                  <Tr key={r.id}>
                    <Td>
                      <Link href={`/manage/reports/${r.id}`} className="font-medium hover:underline">
                        {r.title}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums text-ink-2">
                      {r.periodStart}
                      {r.periodEnd !== r.periodStart ? ` to ${r.periodEnd}` : ""}
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      {formatDateTime(r.createdAt, tz)}
                      {by ? ` · ${by}` : ""}
                    </Td>
                    <Td>{r.approvedAt ? <Badge tone="success">Approved by {approvedBy}</Badge> : <Badge tone="warning">Awaiting approval</Badge>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
