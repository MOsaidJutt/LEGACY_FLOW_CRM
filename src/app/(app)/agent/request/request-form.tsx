"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Hourglass } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { cancelRequestAction, requestLeadsAction } from "../actions";

export function RequestForm({ presets, max }: { presets: number[]; max: number }) {
  const [qty, setQty] = useState<string>(String(presets[0] ?? 15));
  const [state, action] = useActionState(requestLeadsAction, null);

  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2" id="preset-label">
          Quick amounts
        </span>
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby="preset-label">
          {presets.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setQty(String(p))}
              aria-pressed={qty === String(p)}
              className={cn(
                "h-9 min-w-16 rounded-md border px-3 text-sm font-medium tabular-nums transition-colors",
                qty === String(p) ? "border-ink/60 bg-selected text-ink" : "border-line-strong/70 bg-raised text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
      <Field label="Number of leads" htmlFor="qty" hint={`Up to ${max} per request.`}>
        <Input id="qty" name="qty" type="number" inputMode="numeric" min={1} max={max} required value={qty} onChange={(e) => setQty(e.target.value)} className="w-32 tabular-nums" />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="primary">Request {qty || ""} leads</SubmitButton>
      </div>
    </form>
  );
}

export function PendingRequest({ id, qty, expiresAt }: { id: string; qty: number; createdAt: string; expiresAt: string }) {
  const router = useRouter();
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const left = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1000));
  useEffect(() => {
    if (left === 0) {
      const t = window.setTimeout(() => router.refresh(), 1500);
      return () => window.clearTimeout(t);
    }
  }, [left, router]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-md bg-warning-soft px-3.5 py-3">
        <Hourglass className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="text-sm">
          <p className="font-medium text-ink">Waiting for Management to approve {qty} leads</p>
          <p className="mt-0.5 text-ink-2" aria-live="polite">
            {left > 0 ? (
              <>
                Assigned automatically in{" "}
                <span className="font-medium tabular-nums text-ink">
                  {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
                </span>{" "}
                if nobody responds.
              </>
            ) : (
              "Assigning your leads now..."
            )}
          </p>
        </div>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div>
        <Button
          variant="ghost"
          pending={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await cancelRequestAction(id);
              setError(r?.error ?? null);
            })
          }
        >
          Cancel request
        </Button>
      </div>
    </div>
  );
}
