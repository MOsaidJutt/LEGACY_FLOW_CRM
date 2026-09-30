"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, DatabaseBackup } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { deleteLeadDatabaseAction, sourceSummaryAction } from "../delete-actions";
import type { DeletionSummary } from "@/lib/leads/delete";

type Database = { id: string; name: string; leads: number; assigned: number };

export function DeleteLeadDatabase({ databases }: { databases: Database[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const [summary, setSummary] = useState<DeletionSummary | null>(null);
  const [removeSource, setRemoveSource] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const choose = (id: string) => {
    setSourceId(id);
    setSummary(null);
    setConfirmText("");
    setResult(null);
    if (!id) return;
    startTransition(async () => {
      const r = await sourceSummaryAction(id);
      if (r.error) return setResult({ error: r.error });
      setSummary(r.summary ?? null);
    });
  };

  const confirm = () =>
    startTransition(async () => {
      const r = await deleteLeadDatabaseAction({ sourceId, removeSource });
      setResult(r);
      if (r?.ok) {
        setOpen(false);
        setSourceId("");
        setSummary(null);
        router.refresh();
      }
    });

  const canDelete = Boolean(summary) && confirmText.trim().toUpperCase() === "DELETE";

  return (
    <>
      <Button onClick={() => { setResult(null); setOpen(true); }}>
        <DatabaseBackup aria-hidden /> Delete imported data
      </Button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete an imported lead database"
        description="Removes every lead in one campaign, so a new database can be imported cleanly."
        className="w-[min(94vw,36rem)]"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} pending={pending} disabled={!canDelete}>
              Delete {summary ? `${summary.totalLeads.toLocaleString()} leads` : "data"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 text-sm">
          <Field label="Imported database (campaign)" htmlFor="delete-source">
            <Select id="delete-source" value={sourceId} onChange={(e) => choose(e.target.value)}>
              <option value="">Choose a database...</option>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.leads.toLocaleString()} leads)
                </option>
              ))}
            </Select>
          </Field>

          {summary ? (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-line px-4 py-3 sm:grid-cols-4">
                {[
                  ["Leads", summary.totalLeads],
                  ["Assigned", summary.assignedLeads],
                  ["Called", summary.calledLeads],
                  ["Follow-ups", summary.followUpLeads],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs text-ink-3">{label}</dt>
                    <dd className="tabular-nums">{Number(value).toLocaleString()}</dd>
                  </div>
                ))}
              </dl>

              {summary.assignedLeads > 0 || summary.calledLeads > 0 ? (
                <p className="flex gap-2.5 rounded-md border border-warning/40 bg-warning-soft px-3.5 py-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  <span>
                    {summary.assignedLeads > 0 ? `${summary.assignedLeads.toLocaleString()} leads are with agents right now. ` : ""}
                    {summary.calledLeads > 0 ? `${summary.calledLeads.toLocaleString()} have call history, which is deleted with them. ` : ""}
                    Agents lose these leads from their call lists immediately.
                  </span>
                </p>
              ) : null}

              <label className="flex items-start gap-2.5">
                <Checkbox checked={removeSource} onChange={(e) => setRemoveSource(e.target.checked)} className="mt-0.5" />
                <span>
                  Also remove the campaign name &quot;{summary.label}&quot; from the source list.
                  <span className="block text-ink-3">Untick to keep the campaign so reports still refer to it.</span>
                </span>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-ink-2">Type DELETE to confirm</span>
                <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} aria-label="Type DELETE to confirm" className="w-40" />
              </label>

              <p className="text-ink-3">
                Only this campaign is affected. Other campaigns, users, settings, dispositions and lead fields stay as they are, and the deletion is recorded in
                the audit log.
              </p>
            </>
          ) : null}
          <FormMessage state={result} />
        </div>
      </Dialog>
    </>
  );
}
