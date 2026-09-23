"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { assignLeadsAction, releaseLeadsAction, setDncAction } from "../../actions";

export function LeadActions({
  leadId,
  status,
  assignedTo,
  agents,
  hasPhone,
  onDncList,
}: {
  leadId: string;
  status: string;
  assignedTo: string | null;
  agents: { id: string; name: string }[];
  hasPhone: boolean;
  onDncList: boolean;
}) {
  const router = useRouter();
  const [agentId, setAgentId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string } | null>) =>
    startTransition(async () => {
      const r = await fn();
      setResult(r);
      if (!r?.error) router.refresh();
    });

  const blocked = status === "dnc" || status === "closed";

  return (
    <div className="flex flex-col gap-4">
      {!blocked ? (
        <div className="flex flex-col gap-2">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="assign-agent">
            {assignedTo ? "Transfer to" : "Assign to"}
          </label>
          <div className="flex gap-2">
            <Select id="assign-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="flex-1">
              <option value="">Choose agent...</option>
              {agents
                .filter((a) => a.id !== assignedTo)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
            </Select>
            <Button variant="primary" disabled={!agentId} pending={pending} onClick={() => run(() => assignLeadsAction({ leadIds: [leadId], agentId }))}>
              {assignedTo ? "Transfer" : "Assign"}
            </Button>
          </div>
          {assignedTo ? (
            <Button disabled={pending} onClick={() => run(() => releaseLeadsAction({ leadIds: [leadId] }))}>
              Release to pool
            </Button>
          ) : null}
        </div>
      ) : null}

      {hasPhone ? (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <p className="text-[13px] font-medium text-ink-2">Do-not-call list</p>
          {onDncList ? (
            <>
              <p className="text-sm text-ink-3">This number is blocked from calling. Removing it makes this lead available in the pool again.</p>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason for removing (required)" aria-label="Reason for removing from the do-not-call list" />
              <Button disabled={pending || reason.trim().length < 3} onClick={() => run(() => setDncAction({ leadId, dnc: false, reason }))}>
                Remove from do-not-call list
              </Button>
            </>
          ) : (
            <>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Reason (optional)" aria-label="Reason for adding to the do-not-call list" />
              <Button variant="danger" disabled={pending} onClick={() => run(() => setDncAction({ leadId, dnc: true, reason }))}>
                Add number to do-not-call list
              </Button>
            </>
          )}
        </div>
      ) : null}
      <FormMessage state={result} />
    </div>
  );
}
