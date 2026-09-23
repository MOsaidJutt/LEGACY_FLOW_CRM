import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { Download } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { ISSUE_LABELS, NAME_PARTS } from "@/lib/leads/import-labels";
import { PageHeader, Panel, StatRow, Notice } from "@/components/ui/layout";
import { ButtonLink } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { MappingForm } from "./mapping-form";
import { BulkDecisions, CommitBar, RowDecision } from "./review-controls";

export const metadata: Metadata = { title: "Import" };

const FILTERS = [
  { key: "all", label: "All rows" },
  { key: "review", label: "Needs decision" },
  { key: "duplicate_existing", label: "Existing matches" },
  { key: "duplicate_in_file", label: "Duplicates in file" },
  { key: "missing", label: "Missing info" },
  { key: "invalid_phone", label: "Invalid phone" },
  { key: "import", label: "Will import" },
  { key: "reject", label: "Rejected" },
] as const;
const PAGE = 50;

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePermission("leads.import");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { imports, importRows, leadSources, users, leadFields } = schema;

  const [imp] = await db
    .select({ imp: imports, source: leadSources.name, uploader: users.name })
    .from(imports)
    .leftJoin(leadSources, eq(leadSources.id, imports.sourceId))
    .innerJoin(users, eq(users.id, imports.uploadedBy))
    .where(eq(imports.id, id));
  if (!imp) notFound();
  const tz = (await getSettings()).businessTimezone;
  const { imp: record } = imp;
  const meta = `${imp.source ?? "No source"} · uploaded ${formatDateTime(record.createdAt, tz)} by ${imp.uploader}`;

  /* ---------------- step 2: mapping */
  if (record.status === "uploaded") {
    const [samples, fields] = await Promise.all([
      db.select({ raw: importRows.raw }).from(importRows).where(eq(importRows.importId, id)).orderBy(asc(importRows.rowNumber)).limit(4),
      db.select().from(leadFields).where(eq(leadFields.active, true)).orderBy(asc(leadFields.sortOrder), asc(leadFields.label)),
    ]);
    const options = [
      ...fields.filter((f) => f.isCore).map((f) => ({ value: f.key, label: f.label, group: "CRM fields" })),
      ...Object.entries(NAME_PARTS).map(([value, label]) => ({ value, label, group: "CRM fields" })),
      ...fields.filter((f) => !f.isCore).map((f) => ({ value: f.key, label: f.label, group: "Custom fields" })),
    ];
    return (
      <>
        <PageHeader title={record.fileName} back={{ href: "/manage/imports", label: "Imports" }} description={`Step 2 of 3: match columns. ${meta}`} />
        <MappingForm
          importId={id}
          rows={record.stats.totalRows}
          columns={record.headers.map((h) => ({ header: h, samples: samples.map((s) => s.raw[h]).filter(Boolean).slice(0, 3), value: record.mapping[h] ?? "" }))}
          options={options}
        />
      </>
    );
  }

  /* ---------------- step 3: review / done */
  const filter = FILTERS.some((f) => f.key === sp.filter) ? (sp.filter as (typeof FILTERS)[number]["key"]) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const has = (issue: string) => sql`${importRows.issues} @> ${JSON.stringify([issue])}::jsonb`;
  const conditions: Record<string, SQL | undefined> = {
    all: undefined,
    review: eq(importRows.decision, "review"),
    duplicate_existing: has("duplicate_existing"),
    duplicate_in_file: has("duplicate_in_file"),
    missing: sql`exists (select 1 from jsonb_array_elements_text(${importRows.issues}) i where i like 'missing_%')`,
    invalid_phone: has("invalid_phone"),
    import: sql`${importRows.decision} in ('import', 'keep_both', 'update')`,
    reject: eq(importRows.decision, "reject"),
  };
  const where = and(eq(importRows.importId, id), conditions[filter]);

  const [rows, [{ total }], decisions] = await Promise.all([
    db.select().from(importRows).where(where).orderBy(asc(importRows.rowNumber)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(importRows).where(where),
    db
      .select({ decision: importRows.decision, existing: sql<boolean>`${importRows.issues} @> '["duplicate_existing"]'::jsonb`, n: sql<number>`count(*)::int` })
      .from(importRows)
      .where(eq(importRows.importId, id))
      .groupBy(importRows.decision, sql`2`),
  ]);
  const count = (pred: (d: (typeof decisions)[number]) => boolean) => decisions.filter(pred).reduce((s, d) => s + d.n, 0);
  const willInsert = count((d) => d.decision === "import" || d.decision === "keep_both");
  const willUpdate = count((d) => d.decision === "update");
  const needsReview = count((d) => d.decision === "review");
  const existingMatches = count((d) => d.existing);
  const s = record.stats;
  const done = record.status === "imported";
  const closed = done || record.status === "cancelled";
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const link = (params: Record<string, string | number>) => `/manage/imports/${id}?${new URLSearchParams({ filter, page: "1", ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) })}`;
  const show = (r: (typeof rows)[number], key: string) => r.values[key] ?? "";

  return (
    <>
      <PageHeader
        title={record.fileName}
        back={{ href: "/manage/imports", label: "Imports" }}
        description={done ? `Imported ${formatDateTime(record.importedAt, tz)}. ${meta}` : record.status === "cancelled" ? `Cancelled. ${meta}` : `Step 3 of 3: review and import. ${meta}`}
        actions={
          <ButtonLink href={`/api/imports/${id}/report`} prefetch={false}>
            <Download aria-hidden /> Validation report
          </ButtonLink>
        }
      />

      <div className="flex flex-col gap-5">
        <StatRow
          items={[
            { label: "Total rows", value: s.totalRows.toLocaleString(), href: link({ filter: "all" }) },
            { label: "No issues", value: s.validRows.toLocaleString() },
            { label: "Duplicate / existing", value: s.duplicateRows.toLocaleString(), href: link({ filter: "duplicate_existing" }) },
            { label: "Missing info", value: s.missingRows.toLocaleString(), href: link({ filter: "missing" }) },
            { label: "Invalid phone", value: s.invalidPhoneRows.toLocaleString(), href: link({ filter: "invalid_phone" }) },
            done
              ? { label: "Imported / updated", value: `${s.importedRows ?? 0} / ${s.updatedRows ?? 0}` }
              : { label: "Ready to import", value: (willInsert + willUpdate).toLocaleString(), href: link({ filter: "import" }) },
          ]}
        />

        {done ? (
          <Notice tone="success">
            {s.importedRows} new leads were added to the pool{s.updatedRows ? `, ${s.updatedRows} existing leads were updated` : ""} and {s.rejectedRows ?? 0} rows were rejected.{" "}
            <Link href={`/manage/leads?import=${id}`} className="font-medium underline underline-offset-4">
              View the imported leads
            </Link>
          </Notice>
        ) : null}

        {!closed && existingMatches > 0 ? <BulkDecisions importId={id} count={existingMatches} /> : null}

        <Panel flush>
          <div className="flex gap-1 overflow-x-auto border-b border-line px-2" role="tablist">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={link({ filter: f.key })}
                role="tab"
                aria-selected={f.key === filter}
                className={cn(
                  "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] transition-colors",
                  f.key === filter ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
                )}
              >
                {f.label}
                {f.key === "review" && needsReview ? <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-[11px] tabular-nums text-warning">{needsReview}</span> : null}
              </Link>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-3">No rows in this view.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th className="w-14 text-right">Row</Th>
                  <Th>Company</Th>
                  <Th>Contact</Th>
                  <Th>Phone</Th>
                  <Th>Email</Th>
                  <Th>Checks</Th>
                  <Th className="w-44">Decision</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td className="text-right tabular-nums text-ink-3">{r.rowNumber}</Td>
                    <Td className="max-w-[16rem] truncate font-medium">{show(r, "company")}</Td>
                    <Td className="max-w-[12rem] truncate">{show(r, "contact_name")}</Td>
                    <Td className="whitespace-nowrap font-mono text-[13px]">{show(r, "phone")}</Td>
                    <Td className="max-w-[14rem] truncate text-ink-2">{show(r, "email")}</Td>
                    <Td>
                      <div className="flex max-w-[22rem] flex-wrap gap-1">
                        {r.issues.length === 0 ? <span className="text-xs text-ink-3">OK</span> : null}
                        {r.issues.map((i) => (
                          <Badge key={i} tone={ISSUE_LABELS[i]?.tone ?? "neutral"}>
                            {ISSUE_LABELS[i]?.label ?? i}
                          </Badge>
                        ))}
                      </div>
                      {r.matchReason ? <p className="mt-1 text-xs text-ink-3">{r.matchReason}</p> : null}
                    </Td>
                    <Td>
                      <RowDecision importId={id} rowId={r.id} decision={r.decision} existing={r.issues.includes("duplicate_existing")} disabled={closed} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {pages > 1 ? (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[13px] text-ink-3">
              <span className="tabular-nums">
                Rows {(page - 1) * PAGE + 1} to {Math.min(page * PAGE, total)} of {total}
              </span>
              <span className="flex gap-3">
                {page > 1 ? (
                  <Link href={link({ page: page - 1 })} className="text-ink hover:underline">
                    Previous
                  </Link>
                ) : null}
                {page < pages ? (
                  <Link href={link({ page: page + 1 })} className="text-ink hover:underline">
                    Next
                  </Link>
                ) : null}
              </span>
            </div>
          ) : null}
        </Panel>

        {!closed ? <CommitBar importId={id} insert={willInsert} update={willUpdate} review={needsReview} /> : null}
      </div>
    </>
  );
}
