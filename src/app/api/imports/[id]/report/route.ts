import ExcelJS from "exceljs";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { DECISION_LABELS, ISSUE_LABELS } from "@/lib/leads/import-labels";

/** LM-07: validation / error report with every flagged or rejected row and the reason. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in again.", { status: 401 });
  if (!user.permissions.includes("leads.import")) return new Response("Not allowed.", { status: 403 });

  const { id } = await ctx.params;
  const [imp] = await db.select().from(schema.imports).where(eq(schema.imports.id, id));
  if (!imp) return new Response("Not found.", { status: 404 });

  const rows = await db.select().from(schema.importRows).where(eq(schema.importRows.importId, id)).orderBy(asc(schema.importRows.rowNumber));
  const flagged = rows.filter((r) => r.issues.length > 0 || r.decision === "reject");

  const wb = new ExcelJS.Workbook();
  wb.creator = "Legacy Flow";
  const ws = wb.addWorksheet("Flagged rows");
  ws.columns = [
    { header: "Row", key: "row", width: 7 },
    { header: "Issues", key: "issues", width: 42 },
    { header: "Details", key: "details", width: 36 },
    { header: "Decision", key: "decision", width: 16 },
    ...imp.headers.map((h) => ({ header: h, key: `c:${h}`, width: Math.min(40, Math.max(12, h.length + 4)) })),
  ];
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of flagged) {
    ws.addRow({
      row: r.rowNumber,
      issues: r.issues.map((i) => ISSUE_LABELS[i]?.label ?? i).join(", ") || "Rejected",
      details: r.matchReason ?? "",
      decision: imp.status === "imported" || imp.status === "mapped" ? (DECISION_LABELS[r.decision] ?? r.decision) : "",
      ...Object.fromEntries(imp.headers.map((h) => [`c:${h}`, r.raw[h] ?? ""])),
    });
  }

  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "Measure", key: "k", width: 30 },
    { header: "Value", key: "v", width: 40 },
  ];
  summary.getRow(1).font = { bold: true };
  const s = imp.stats;
  summary.addRows([
    { k: "File", v: imp.fileName },
    { k: "Total rows", v: s.totalRows },
    { k: "Valid rows (no issues)", v: s.validRows },
    { k: "Duplicate / existing rows", v: s.duplicateRows },
    { k: "Rows with missing information", v: s.missingRows },
    { k: "Invalid phone format", v: s.invalidPhoneRows },
    { k: "Ready to import", v: s.readyRows },
    ...(s.importedRows !== undefined ? [{ k: "Imported", v: s.importedRows }, { k: "Updated existing", v: s.updatedRows ?? 0 }, { k: "Rejected", v: s.rejectedRows ?? 0 }] : []),
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  const safe = imp.fileName.replace(/\.[a-z]+$/i, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safe}-validation-report.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
