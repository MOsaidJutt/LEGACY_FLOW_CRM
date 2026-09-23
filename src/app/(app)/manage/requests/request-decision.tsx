"use client";

import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { decideRequestAction } from "../actions";

export function RequestDecision({
  id,
  agent,
  qty,
  requestedAt,
  expiresAt,
  pool,
}: {
  id: string;
  agent: string;
  qty: number;
  requestedAt: string;
  expiresAt: string;
  pool: number;
}) {
  const [amount, setAmount] = useState(String(qty));
  const [note, setNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  const urgent = left <= 60;
  const n = Number(amount);

  function decide(decision: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      const r = await decideRequestAction({ requestId: id, decision, qty: decision === "approve" ? n : undefined, note: note || undefined });
      if (r?.error) setError(r.error);
    });
  }

  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5">
      <div className="min-w-44 flex-1">
        <p className="text-sm font-medium text-ink">
          {agent} <span className="font-normal text-ink-2">asked for</span> <span className="tabular-nums">{qty}</span> leads
        </p>
        <p className="mt-0.5 text-[13px] text-ink-3">
          {requestedAt} ·{" "}
          <span className={cn("tabular-nums", urgent ? "font-medium text-warning" : undefined)}>
            {left > 0 ? `auto-assigns in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` : "auto-assigning now"}
          </span>
        </p>
        {error ? (
          <p role="alert" className="mt-1 text-[13px] text-danger">
            {error}
          </p>
        ) : null}
      </div>

      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" aria-label="Reason for declining" className="w-56" autoFocus />
          <Button variant="danger" size="sm" pending={pending} onClick={() => decide("reject")}>
            Decline request
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRejecting(false)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[13px] text-ink-3">
            Leads
            <Input
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-8 w-20 tabular-nums"
              aria-label={`Number of leads to approve for ${agent}`}
            />
          </label>
          <Button variant="primary" size="sm" pending={pending} disabled={!Number.isInteger(n) || n < 1} onClick={() => decide("approve")}>
            {n === qty ? "Approve" : `Approve ${Number.isInteger(n) && n > 0 ? n : ""}`}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setRejecting(true)}>
            Decline
          </Button>
          {n > pool ? <span className="text-xs text-warning">Only {pool} in the pool</span> : null}
        </div>
      )}
    </li>
  );
}
