"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { deleteSourceAction } from "../delete-actions";

type Source = { id: string; name: string; leads: number; assigned: number };

export function LeadSources({ sources }: { sources: Source[] }) {
  const router = useRouter();
  const [target, setTarget] = useState<Source | null>(null);
  const [withLeads, setWithLeads] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const open = (source: Source) => {
    setTarget(source);
    setWithLeads(false);
    setConfirmText("");
    setResult(null);
  };

  const confirm = () =>
    startTransition(async () => {
      if (!target) return;
      const r = await deleteSourceAction({ sourceId: target.id, deleteLeads: withLeads });
      setResult(r);
      if (r?.ok) {
        setTarget(null);
        router.refresh();
      }
    });

  const needsTyping = Boolean(target && withLeads && target.leads > 0);
  const canDelete = !needsTyping || confirmText.trim().toUpperCase() === "DELETE";

  return (
    <>
      {result?.ok ? <FormMessage state={result} /> : null}
      <Table>
        <thead>
          <tr>
            <Th>Source</Th>
            <Th className="text-right">Leads</Th>
            <Th className="text-right">With agents</Th>
            <Th className="text-right">Remove</Th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <Tr key={s.id}>
              <Td className="font-medium">
                {s.name} {s.leads === 0 ? <Badge>Empty</Badge> : null}
              </Td>
              <Td className="text-right tabular-nums">{s.leads.toLocaleString()}</Td>
              <Td className="text-right tabular-nums">{s.assigned.toLocaleString()}</Td>
              <Td className="text-right">
                <Button size="sm" variant="ghost" onClick={() => open(s)} aria-label={`Delete the source ${s.name}`}>
                  <Trash2 aria-hidden /> Delete
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>

      <Dialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title="Remove this source?"
        description={target?.name}
        footer={
          <>
            <Button onClick={() => setTarget(null)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} pending={pending} disabled={!canDelete}>
              {withLeads ? `Delete source and ${target?.leads.toLocaleString() ?? 0} leads` : "Remove from the list"}
            </Button>
          </>
        }
      >
        {target ? (
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-ink-2">
              {target.leads === 0
                ? "This source has no leads, so removing it only takes it out of the dropdown."
                : `This source holds ${target.leads.toLocaleString()} lead${target.leads === 1 ? "" : "s"}${
                    target.assigned > 0 ? `, ${target.assigned.toLocaleString()} of them with agents right now` : ""
                  }.`}
            </p>

            {target.leads > 0 ? (
              <>
                <label className="flex items-start gap-2.5">
                  <Checkbox checked={withLeads} onChange={(e) => setWithLeads(e.target.checked)} className="mt-0.5" />
                  <span>
                    Delete the leads as well.
                    <span className="block text-ink-3">
                      Leave this unticked to keep every lead and only drop the label, so the name disappears from the dropdown while the leads stay in the CRM.
                    </span>
                  </span>
                </label>

                {needsTyping ? (
                  <div className="flex gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-3">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                    <div className="flex flex-col gap-2">
                      <p>This deletes the leads and their call history. It cannot be undone.</p>
                      <label className="flex flex-col gap-1">
                        <span className="text-ink-2">Type DELETE to confirm</span>
                        <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" className="w-40" />
                      </label>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <p className="text-ink-3">Other campaigns, users and settings are not affected, and the change is recorded in the audit log.</p>
            <FormMessage state={result} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
