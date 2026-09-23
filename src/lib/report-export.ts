import "server-only";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportData } from "./reports";
import { formatCell } from "./report-format";

export function reportFileName(r: ReportData, ext: "xlsx" | "pdf") {
  const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug}_${r.fromDay}${r.toDay !== r.fromDay ? `_to_${r.toDay}` : ""}.${ext}`;
}

/** Excel: numbers stay numeric; durations are exported in minutes so they can be summed. */
export async function reportToXlsx(r: ReportData, company: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Legacy Flow";
  const ws = wb.addWorksheet(r.title.slice(0, 31));
  ws.addRow([`${company} · ${r.title}`]).font = { bold: true, size: 13 };
  ws.addRow([r.subtitle]).font = { color: { argb: "FF666666" } };
  ws.addRow([`Generated ${new Date(r.generatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC`]).font = { color: { argb: "FF666666" } };
  ws.addRow([]);
  const header = ws.addRow(r.columns.map((c) => (c.kind === "duration" ? `${c.label} (min)` : c.kind === "percent" ? `${c.label} %` : c.label)));
  header.font = { bold: true };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3E5E8" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FF8C9098" } } };
  });
  const value = (kind: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return null;
    if (kind === "duration") return Math.round((Number(v) / 60) * 10) / 10;
    if (kind === "number" || kind === "percent") return Number(v);
    return String(v);
  };
  for (const row of r.rows) ws.addRow(r.columns.map((c) => value(c.kind, row[c.key])));
  if (r.totals) {
    const t = ws.addRow(r.columns.map((c) => value(c.kind, r.totals![c.key])));
    t.font = { bold: true };
    t.eachCell((cell) => (cell.border = { top: { style: "thin", color: { argb: "FF8C9098" } } }));
  }
  ws.views = [{ state: "frozen", ySplit: 5 }];
  r.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.kind === "text" ? Math.max(14, Math.min(34, Math.max(c.label.length, ...r.rows.map((row) => String(row[c.key] ?? "").length)) + 2)) : Math.max(9, c.label.length + 4);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** PDF: landscape A4 table with repeated header, zebra rows and page numbers. */
export async function reportToPdf(r: ReportData, company: string) {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 32, bufferPages: true, info: { Title: r.title, Author: "Legacy Flow" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = doc.page.height - doc.page.margins.bottom - 18;
  const weights = r.columns.map((c) => (c.kind === "text" ? (c.key === "agent" || c.key === "source" || c.key === "shift" ? 2.4 : 1.4) : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => (w / total) * width);
  const rowH = 17;
  const fontSize = r.columns.length > 14 ? 6.8 : 8;

  doc.font("Helvetica-Bold").fontSize(15).fillColor("#111214").text(r.title, left, doc.page.margins.top);
  doc.font("Helvetica").fontSize(9).fillColor("#5B6068").text(`${company} · ${r.subtitle}`);
  doc.text(`Generated ${new Date(r.generatedAt).toISOString().replace("T", " ").slice(0, 16)} UTC by Legacy Flow`);
  let y = doc.y + 12;

  const drawRow = (cells: string[], opts: { header?: boolean; fill?: string; bold?: boolean }) => {
    if (opts.fill) doc.rect(left, y, width, rowH).fill(opts.fill);
    let x = left;
    const font = opts.header || opts.bold ? "Helvetica-Bold" : "Helvetica";
    doc.font(font).fillColor(opts.header ? "#111214" : "#1F2124");
    cells.forEach((text, i) => {
      const right = r.columns[i].kind !== "text";
      const room = widths[i] - 8;
      // shrink a label to fit its column instead of breaking it mid-word
      let size = fontSize;
      doc.fontSize(size);
      while (opts.header && size > 5 && doc.widthOfString(text) > room) doc.fontSize((size -= 0.3));
      doc.text(text, x + 4, y + 5, { width: room, align: right ? "right" : "left", lineBreak: false, ellipsis: true });
      x += widths[i];
    });
    doc.fontSize(fontSize);
    y += rowH;
  };
  const header = () => {
    drawRow(r.columns.map((c) => c.label), { header: true, fill: "#E3E5E8" });
  };

  header();
  r.rows.forEach((row, i) => {
    if (y + rowH > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    drawRow(r.columns.map((c) => formatCell(c.kind, row[c.key])), { fill: i % 2 ? "#F4F5F7" : undefined });
  });
  if (r.totals) {
    if (y + rowH > bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
    doc.moveTo(left, y).lineTo(left + width, y).strokeColor("#8C9098").lineWidth(0.6).stroke();
    drawRow(r.columns.map((c) => formatCell(c.kind, r.totals![c.key])), { bold: true });
  }
  if (r.rows.length === 0) doc.font("Helvetica").fontSize(9).fillColor("#5B6068").text("No data for this period.", left, y + 6);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    // writing inside the bottom margin would otherwise make pdfkit start a new page
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7.5).fillColor("#8C9098").text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - margin + 10, { width, align: "right", lineBreak: false });
    doc.page.margins.bottom = margin;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}
