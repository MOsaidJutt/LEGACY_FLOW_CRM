import type { ReportData } from "@/lib/reports";
import { formatCell } from "@/lib/report-format";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export function ReportTable({ data }: { data: ReportData }) {
  if (data.rows.length === 0) return <p className="px-4 py-10 text-center text-sm text-ink-3">No data for this period.</p>;
  return (
    <Table>
      <thead>
        <tr>
          {data.columns.map((c) => (
            <Th key={c.key} className={c.kind === "text" ? undefined : "text-right"}>
              {c.label}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.rows.map((row, i) => (
          <Tr key={i}>
            {data.columns.map((c, j) => (
              <Td key={c.key} className={c.kind === "text" ? (j === 0 ? "whitespace-nowrap font-medium" : "whitespace-nowrap text-ink-2") : "text-right tabular-nums"}>
                {formatCell(c.kind, row[c.key])}
              </Td>
            ))}
          </Tr>
        ))}
        {data.totals ? (
          <tr className="border-t-2 border-line-strong font-semibold">
            {data.columns.map((c) => (
              <Td key={c.key} className={c.kind === "text" ? undefined : "text-right tabular-nums"}>
                {formatCell(c.kind, data.totals![c.key])}
              </Td>
            ))}
          </tr>
        ) : null}
      </tbody>
    </Table>
  );
}
