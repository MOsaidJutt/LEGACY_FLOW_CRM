"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Database } from "lucide-react";
import { Badge, toneOf } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/layout";
import { LEAD_STATUS } from "@/lib/leads/status";
import { cn } from "@/lib/cn";
import { assignLeadsAction, releaseLeadsAction } from "../actions";

type Row = {
  id: string;
  company: string | null;
  contactName: string | null;
  phone: string | null;
  validPhone: boolean;
  location: string;
  source: string | null;
  status: string;
  assignee: string | null;
  outcome: string | null;
  outcomeTone: string | null;
  lastCalled: string | null;
};

export function LeadsTable({ rows, agents }: { rows: Row[]; agents: { id: string; name: string }[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [agentId, setAgentId] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function run(action: () => Promise<{ ok?: boolean; error?: string; message?: string } | null>) {
    startTransition(async () => {
      const r = await action();
      setResult(r);
      if (!r?.error) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-raised">
        <EmptyState icon={Database} title="No leads match these filters">
          Clear the filters, or import a lead file to add leads.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
          selected.size ? "border-line-strong bg-selected" : "border-line bg-raised",
        )}
      >
        <span className="mr-2 text-sm tabular-nums text-ink-2">{selected.size ? `${selected.size} selected` : "Select leads to act on them"}</span>
        <Select value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent to assign to" className="h-8 w-48 text-[13px]" disabled={!selected.size}>
          <option value="">Choose agent...</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Button size="sm" variant="primary" disabled={!selected.size || !agentId} pending={pending} onClick={() => run(() => assignLeadsAction({ leadIds: [...selected], agentId }))}>
          Assign
        </Button>
        <Button size="sm" disabled={!selected.size} pending={pending} onClick={() => run(() => releaseLeadsAction({ leadIds: [...selected] }))}>
          Release to pool
        </Button>
        <div className="ml-auto min-w-0">
          <FormMessage state={result} />
        </div>
      </div>

      <section className="rounded-lg border border-line bg-raised">
        <Table>
          <thead>
            <tr>
              <Th className="w-10">
                <Checkbox
                  checked={all}
                  aria-label="Select all leads on this page"
                  onChange={() => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </Th>
              <Th>Company</Th>
              <Th>Contact</Th>
              <Th>Phone</Th>
              <Th>Location</Th>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th>Agent</Th>
              <Th>Last outcome</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className={selected.has(r.id) ? "bg-selected/60" : undefined}>
                <Td>
                  <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.company ?? r.contactName ?? "lead"}`} />
                </Td>
                <Td className="max-w-[16rem] truncate">
                  <Link href={`/manage/leads/${r.id}`} className="font-medium hover:underline">
                    {r.company || r.contactName || "Unnamed lead"}
                  </Link>
                </Td>
                <Td className="max-w-[12rem] truncate text-ink-2">{r.contactName}</Td>
                <Td className={cn("whitespace-nowrap font-mono text-[13px]", !r.validPhone && "text-warning")} title={r.validPhone ? undefined : "Not a valid U.S. number"}>
                  {r.phone || <span className="font-sans text-ink-3">None</span>}
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{r.location}</Td>
                <Td className="max-w-[12rem] truncate text-ink-2">{r.source}</Td>
                <Td>
                  <Badge tone={LEAD_STATUS[r.status]?.tone}>{LEAD_STATUS[r.status]?.label ?? r.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-ink-2">{r.assignee}</Td>
                <Td className="whitespace-nowrap">
                  {r.outcome ? <Badge tone={toneOf(r.outcomeTone)}>{r.outcome}</Badge> : null}
                  {r.lastCalled ? <span className="ml-2 text-xs text-ink-3">{r.lastCalled}</span> : null}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
