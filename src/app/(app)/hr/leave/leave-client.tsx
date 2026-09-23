"use client";

import { useActionState, useState, useTransition } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { addHolidayAction, decideLeaveAction, deleteHolidayAction, recordLeaveAction } from "../actions";

export function LeaveForm({ people, types }: { people: { id: string; name: string }[]; types: { id: string; name: string }[] }) {
  const [state, action] = useActionState(recordLeaveAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <Field label="Employee" htmlFor="lv-user">
        <Select id="lv-user" name="userId" required defaultValue="">
          <option value="" disabled>
            Choose...
          </option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Leave type" htmlFor="lv-type">
        <Select id="lv-type" name="leaveTypeId" required>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Status" htmlFor="lv-status">
        <Select id="lv-status" name="status" defaultValue="approved">
          <option value="approved">Approved</option>
          <option value="pending">Pending decision</option>
        </Select>
      </Field>
      <Field label="From" htmlFor="lv-start">
        <Input id="lv-start" name="startDate" type="date" required />
      </Field>
      <Field label="To" htmlFor="lv-end">
        <Input id="lv-end" name="endDate" type="date" required />
      </Field>
      <Field label="Reason" htmlFor="lv-reason">
        <Input id="lv-reason" name="reason" placeholder="Optional" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-3">
        <SubmitButton variant="primary">Save leave</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function LeaveDecision({ id, summary, reason }: { id: string; summary: string; reason: string | null }) {
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const decide = (d: "approved" | "rejected") => startTransition(async () => setError((await decideLeaveAction(id, d, comment))?.error ?? null));
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-56 flex-1 text-sm">
        <p className="font-medium">{summary}</p>
        {reason ? <p className="text-ink-3">{reason}</p> : null}
        {error ? <p className="text-danger">{error}</p> : null}
      </div>
      <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" aria-label="Comment" className="h-8 w-52" />
      <Button size="sm" variant="primary" pending={pending} onClick={() => decide("approved")}>
        Approve
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide("rejected")}>
        Decline
      </Button>
    </li>
  );
}

export function HolidayForm() {
  const [state, action] = useActionState(addHolidayAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Input name="date" type="date" required aria-label="Holiday date" className="w-40" />
        <Input name="name" required placeholder="e.g. Independence Day" aria-label="Holiday name" />
      </div>
      <div className="flex items-center gap-3">
        <SubmitButton size="sm">Add holiday</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function HolidayRow({ id, date, name }: { id: string; date: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-center gap-3 py-2 text-sm">
      <span className="w-24 tabular-nums text-ink-3">{date}</span>
      <span className="flex-1">{name}</span>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void (await deleteHolidayAction(id)))}
        aria-label={`Remove ${name}`}
        className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink disabled:opacity-50"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </li>
  );
}
