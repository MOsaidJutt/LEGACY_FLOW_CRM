"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { DECISION_LABELS } from "@/lib/leads/import-labels";
import { cancelImportAction, commitImportAction, reopenMappingAction, setBulkDecisionAction, setRowDecisionAction } from "../actions";

export function RowDecision({ importId, rowId, decision, existing, disabled }: { importId: string; rowId: string; decision: string; existing: boolean; disabled: boolean }) {
  const [value, setValue] = useState(decision);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const choices = existing ? ["review", "reject", "keep_both", "update"] : ["import", "reject"];

  if (disabled) return <span className="text-sm text-ink-2">{DECISION_LABELS[decision] ?? decision}</span>;
  return (
    <div>
      <Select
        value={value}
        disabled={pending}
        aria-label="Decision for this row"
        aria-invalid={value === "review" || undefined}
        className="h-8 text-[13px]"
        onChange={(e) => {
          const next = e.target.value;
          const prev = value;
          setValue(next);
          startTransition(async () => {
            const r = await setRowDecisionAction(importId, rowId, next);
            if (r?.error) {
              setValue(prev);
              setError(r.error);
            } else setError(null);
          });
        }}
      >
        {choices.map((c) => (
          <option key={c} value={c}>
            {DECISION_LABELS[c]}
          </option>
        ))}
      </Select>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function BulkDecisions({ importId, count }: { importId: string; count: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const apply = (decision: string) =>
    startTransition(async () => {
      const r = await setBulkDecisionAction(importId, "duplicate_existing", decision);
      setError(r?.error ?? null);
    });

  return (
    <section className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-info/30 bg-info-soft px-4 py-3">
      <p className="min-w-60 flex-1 text-sm">
        <span className="font-medium">
          {count === 1 ? "1 row matches a lead" : `${count} rows match leads`} already in the CRM.
        </span>{" "}
        <span className="text-ink-2">{count === 1 ? "Decide here for it, or in the table below." : "Choose for all of them at once, or decide row by row below."}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" pending={pending} onClick={() => apply("reject")}>
          Reject all
        </Button>
        <Button size="sm" pending={pending} onClick={() => apply("update")}>
          Update existing leads
        </Button>
        <Button size="sm" pending={pending} onClick={() => apply("keep_both")}>
          Keep both
        </Button>
      </div>
      {error ? <p className="w-full text-sm text-danger">{error}</p> : null}
    </section>
  );
}

export function CommitBar({ importId, insert, update, review }: { importId: string; insert: number; update: number; review: number }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string } | null>(null);

  return (
    <section className="sticky bottom-0 z-[var(--z-sticky)] -mx-1 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised px-4 py-3 shadow-pop">
      <p className="min-w-56 flex-1 text-sm">
        {review > 0 ? (
          <span className="text-warning">
            {review} {review === 1 ? "row needs" : "rows need"} a decision before you can import.
          </span>
        ) : (
          <>
            <span className="font-medium tabular-nums">{insert.toLocaleString()}</span> new leads will be added
            {update ? (
              <>
                {" "}
                and <span className="font-medium tabular-nums">{update.toLocaleString()}</span> existing leads updated
              </>
            ) : null}
            .
          </>
        )}
      </p>
      <Button variant="ghost" disabled={pending} onClick={() => startTransition(async () => setState(await reopenMappingAction(importId)))}>
        Change mapping
      </Button>
      <Button variant="ghost" disabled={pending} onClick={() => startTransition(async () => setState(await cancelImportAction(importId)))}>
        Cancel import
      </Button>
      <Button
        variant="primary"
        pending={pending}
        disabled={review > 0 || insert + update === 0}
        onClick={() => startTransition(async () => setState(await commitImportAction(importId)))}
      >
        Import {(insert + update).toLocaleString()} leads
      </Button>
      {state?.error ? (
        <div className="w-full">
          <FormMessage state={state} />
        </div>
      ) : null}
    </section>
  );
}
