"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { deleteImportAction, importSummaryAction } from "../delete-actions";
import type { DeletionSummary } from "@/lib/leads/delete";

export function DeleteImport({ importId, fileName }: { importId: string; fileName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DeletionSummary | null>(null);
  const [withLeads, setWithLeads] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const load = () =>
    startTransition(async () => {
      setResult(null);
      setConfirmText("");
      setWithLeads(false);
      const r = await importSummaryAction(importId);
      if (r.error) return setResult({ error: r.error });
      setSummary(r.summary ?? null);
      setOpen(true);
    });

  const confirm = () =>
    startTransition(async () => {
      const r = await deleteImportAction({ importId, deleteLeads: withLeads });
      setResult(r);
      if (r?.ok) {
        setOpen(false);
        router.refresh();
      }
    });

  const risky = Boolean(summary && withLeads && (summary.assignedLeads > 0 || summary.calledLeads > 0));
  const canDelete = !risky || confirmText.trim().toUpperCase() === "DELETE";

  return (
    <>
      <Button size="sm" variant="ghost" onClick={load} pending={pending && !open} aria-label={`Delete ${fileName}`}>
        <Trash2 aria-hidden /> Delete
      </Button>
      {result?.error && !open ? <p className="mt-1 text-xs text-danger">{result.error}</p> : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete this import?"
        description="This cannot be undone."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} pending={pending} disabled={!canDelete}>
              {withLeads ? `Delete file and ${summary?.totalLeads.toLocaleString() ?? 0} leads` : "Delete file record"}
            </Button>
          </>
        }
      >
        {summary ? (
          <div className="flex flex-col gap-4 text-sm">
            <div>
              <p className="font-medium text-ink">{summary.label}</p>
              <p className="text-ink-3">
                Campaign: {summary.campaign ?? "none"}
                {summary.uploadedBy ? ` · uploaded by ${summary.uploadedBy}` : ""}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line px-4 py-3 sm:grid-cols-4">
              {[
                ["Leads from this file", summary.totalLeads],
                ["Assigned to agents", summary.assignedLeads],
                ["Already called", summary.calledLeads],
                ["Follow-ups", summary.followUpLeads],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className="tabular-nums">{Number(value).toLocaleString()}</dd>
                </div>
              ))}
            </dl>

            <label className="flex items-start gap-2.5">
              <Checkbox checked={withLeads} onChange={(e) => setWithLeads(e.target.checked)} className="mt-0.5" />
              <span>
                Also delete the {summary.totalLeads.toLocaleString()} lead{summary.totalLeads === 1 ? "" : "s"} that came from this file.
                <span className="block text-ink-3">Leave this unticked to remove only the file record and keep the leads.</span>
              </span>
            </label>

            {risky ? (
              <div className="flex gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-3">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                <div className="flex flex-col gap-2">
                  <p>
                    {summary.assignedLeads > 0 ? `${summary.assignedLeads.toLocaleString()} of these leads are assigned to agents right now. ` : ""}
                    {summary.calledLeads > 0 ? `${summary.calledLeads.toLocaleString()} have already been called; their call history will go too.` : ""}
                  </p>
                  <label className="flex flex-col gap-1">
                    <span className="text-ink-2">Type DELETE to confirm</span>
                    <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" className="w-40" />
                  </label>
                </div>
              </div>
            ) : null}

            <p className="text-ink-3">Other campaigns, settings, dispositions and lead fields are not affected. The deletion is recorded in the audit log.</p>
            <FormMessage state={result} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
