"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Td, Tr } from "@/components/ui/table";
import { salaryHistoryAction, saveSalaryAction } from "./actions";

export type Row = {
  userId: string;
  name: string;
  role: string;
  employeeCode: string | null;
  basicSalary: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  leaveDays: number;
  absenceDeduction: number;
  bonus: number;
  otherDeduction: number;
  finalSalary: number;
  note: string | null;
  finalized: string | null;
  finalizedBy: string | null;
};

type HistoryRow = {
  period: string;
  basicSalary: number;
  absentDays: number;
  absenceDeduction: number;
  bonus: number;
  otherDeduction: number;
  finalSalary: number;
  finalizedAt: string | Date | null;
  finalizedBy: string | null;
};

const money = (n: number) => n.toLocaleString();

export function SalaryRow({ row, period, payrollDays }: { row: Row; period: string; payrollDays: number }) {
  const router = useRouter();
  const [basic, setBasic] = useState(row.basicSalary);
  const [bonus, setBonus] = useState(row.bonus);
  const [other, setOther] = useState(row.otherDeduction);
  const note = row.note ?? "";
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // the same formula the server applies, so the figures move as Management types
  const days = payrollDays > 0 ? payrollDays : row.workingDays;
  const deduction = days > 0 ? Math.round((basic / days) * row.absentDays) : 0;
  const payable = Math.max(0, Math.round(basic + bonus - deduction - other));
  const dirty = basic !== row.basicSalary || bonus !== row.bonus || other !== row.otherDeduction;

  const save = (finalize: boolean) =>
    startTransition(async () => {
      const r = await saveSalaryAction({ userId: row.userId, period, basicSalary: basic, bonus, otherDeduction: other, note, finalize });
      setResult(r);
      if (r?.ok) router.refresh();
    });

  const showHistory = () =>
    startTransition(async () => {
      setOpen(true);
      const r = await salaryHistoryAction(row.userId);
      setHistory(("rows" in r ? r.rows : []) as HistoryRow[]);
    });

  return (
    <>
      <Tr>
        <Td>
          <span className="font-medium">{row.name}</span>
          <span className="block text-xs text-ink-3">
            {row.role}
            {row.employeeCode ? ` · ${row.employeeCode}` : ""}
          </span>
        </Td>
        <Td>
          <Input
            type="number"
            min={0}
            step={500}
            value={basic}
            onChange={(e) => setBasic(Math.max(0, Number(e.target.value)))}
            aria-label={`Basic salary for ${row.name}`}
            className="w-28 tabular-nums"
          />
        </Td>
        <Td className="text-right tabular-nums">{row.workingDays}</Td>
        <Td className="text-right tabular-nums">{row.presentDays}</Td>
        <Td className="text-right tabular-nums">
          {row.absentDays > 0 ? <span className="text-warning">{row.absentDays}</span> : 0}
          {row.leaveDays > 0 ? <span className="block text-xs text-ink-3">{row.leaveDays} on leave</span> : null}
        </Td>
        <Td className="text-right tabular-nums text-danger">{deduction > 0 ? `-${money(deduction)}` : "0"}</Td>
        <Td>
          <Input
            type="number"
            min={0}
            step={500}
            value={bonus}
            onChange={(e) => setBonus(Math.max(0, Number(e.target.value)))}
            aria-label={`Bonus for ${row.name}`}
            className="w-24 tabular-nums"
          />
        </Td>
        <Td>
          <Input
            type="number"
            min={0}
            step={500}
            value={other}
            onChange={(e) => setOther(Math.max(0, Number(e.target.value)))}
            aria-label={`Other deductions for ${row.name}`}
            className="w-24 tabular-nums"
          />
        </Td>
        <Td className="text-right font-semibold tabular-nums">{money(payable)}</Td>
        <Td>
          <div className="flex items-center justify-end gap-1.5">
            {row.finalized && !dirty ? <Badge tone="success">Finalized</Badge> : null}
            <Button size="sm" onClick={() => save(false)} pending={pending} disabled={!dirty && Boolean(row.finalized)}>
              Save
            </Button>
            <Button size="sm" variant="primary" onClick={() => save(true)} pending={pending}>
              Finalize
            </Button>
            <Button size="sm" variant="ghost" onClick={showHistory} aria-label={`Salary history for ${row.name}`}>
              <History aria-hidden />
            </Button>
          </div>
          {result?.message || result?.error ? (
            <p className={`mt-1 text-right text-xs ${result.error ? "text-danger" : "text-ink-3"}`}>{result.error ?? result.message}</p>
          ) : row.finalized ? (
            <p className="mt-1 text-right text-xs text-ink-3">
              {row.finalized}
              {row.finalizedBy ? ` · ${row.finalizedBy}` : ""}
            </p>
          ) : null}
        </Td>
      </Tr>

      <Dialog open={open} onClose={() => setOpen(false)} title={`Salary history: ${row.name}`} className="w-[min(94vw,44rem)]">
        {history === null ? (
          <p className="text-sm text-ink-3">Loading...</p>
        ) : history.length === 0 ? (
          <p className="text-sm text-ink-3">No salary has been calculated for this employee yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-ink-3">
              <tr>
                <th className="py-1.5 font-medium">Month</th>
                <th className="py-1.5 text-right font-medium">Basic</th>
                <th className="py-1.5 text-right font-medium">Absent</th>
                <th className="py-1.5 text-right font-medium">Deduction</th>
                <th className="py-1.5 text-right font-medium">Bonus</th>
                <th className="py-1.5 text-right font-medium">Payable</th>
                <th className="py-1.5 font-medium">Finalized</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {history.map((h) => (
                <tr key={h.period}>
                  <td className="py-1.5 tabular-nums">{h.period}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(h.basicSalary)}</td>
                  <td className="py-1.5 text-right tabular-nums">{h.absentDays}</td>
                  <td className="py-1.5 text-right tabular-nums text-danger">{h.absenceDeduction ? `-${money(h.absenceDeduction)}` : "0"}</td>
                  <td className="py-1.5 text-right tabular-nums">{money(h.bonus)}</td>
                  <td className="py-1.5 text-right font-medium tabular-nums">{money(h.finalSalary)}</td>
                  <td className="py-1.5 text-ink-3">{h.finalizedAt ? (h.finalizedBy ?? "yes") : "draft"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Dialog>
    </>
  );
}
