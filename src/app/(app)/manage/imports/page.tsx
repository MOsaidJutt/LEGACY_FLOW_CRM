import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { FileSpreadsheet, Upload } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { ButtonLink } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge, type Tone } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Imports" };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  uploaded: { label: "Mapping columns", tone: "warning" },
  mapped: { label: "In review", tone: "warning" },
  imported: { label: "Imported", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function ImportsPage() {
  await requirePermission("leads.import");
  const tz = (await getSettings()).businessTimezone;
  const { imports, users, leadSources } = schema;

  const rows = await db
    .select({
      id: imports.id,
      fileName: imports.fileName,
      status: imports.status,
      stats: imports.stats,
      createdAt: imports.createdAt,
      importedAt: imports.importedAt,
      uploader: users.name,
      source: leadSources.name,
    })
    .from(imports)
    .innerJoin(users, eq(users.id, imports.uploadedBy))
    .leftJoin(leadSources, eq(leadSources.id, imports.sourceId))
    .orderBy(desc(imports.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Imports"
        description="Every lead file uploaded, with its validation results. Open an import to finish reviewing it or download its report."
        actions={
          <ButtonLink href="/manage/imports/new" variant="primary">
            <Upload aria-hidden /> Import leads
          </ButtonLink>
        }
      />
      <section className="rounded-lg border border-line bg-raised">
        {rows.length === 0 ? (
          <EmptyState icon={FileSpreadsheet} title="No imports yet" action={<ButtonLink href="/manage/imports/new" variant="primary">Import your first file</ButtonLink>}>
            Upload an Excel or CSV file with any column layout. You map the columns, review duplicates and phone checks, then import.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>File</Th>
                <Th>Source</Th>
                <Th>Uploaded</Th>
                <Th className="text-right">Rows</Th>
                <Th className="text-right">Duplicates</Th>
                <Th className="text-right">Missing</Th>
                <Th className="text-right">Bad phone</Th>
                <Th className="text-right">Imported</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <Link href={`/manage/imports/${r.id}`} className="font-medium hover:underline">
                      {r.fileName}
                    </Link>
                  </Td>
                  <Td className="text-ink-2">{r.source}</Td>
                  <Td className="whitespace-nowrap text-ink-2">
                    {formatDateTime(r.createdAt, tz)} · {r.uploader}
                  </Td>
                  <Td className="text-right tabular-nums">{r.stats.totalRows}</Td>
                  <Td className="text-right tabular-nums">{r.status === "uploaded" ? "" : r.stats.duplicateRows}</Td>
                  <Td className="text-right tabular-nums">{r.status === "uploaded" ? "" : r.stats.missingRows}</Td>
                  <Td className="text-right tabular-nums">{r.status === "uploaded" ? "" : r.stats.invalidPhoneRows}</Td>
                  <Td className="text-right tabular-nums">{r.stats.importedRows ?? ""}</Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
