"use client";

import { useActionState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveDispositionAction } from "../config-actions";

type Disposition = {
  id: string;
  label: string;
  description: string | null;
  action: "release" | "retain" | "close" | "dnc";
  requiresCallback: boolean;
  tone: string;
  isSystem: boolean;
  active: boolean;
  sortOrder: number;
};

const ACTIONS = [
  { value: "release", label: "Stays in the working list, returns to pool at logout" },
  { value: "retain", label: "Kept by the agent as a follow-up" },
  { value: "close", label: "Closes the lead" },
  { value: "dnc", label: "Adds the number to the do-not-call list" },
];
const TONES = [
  { value: "neutral", label: "Gray" },
  { value: "info", label: "Blue" },
  { value: "success", label: "Green" },
  { value: "warning", label: "Amber" },
  { value: "danger", label: "Red" },
];

export function DispositionForm({ disposition: d }: { disposition?: Disposition }) {
  const [state, action] = useActionState(saveDispositionAction, null);
  const id = d?.id ?? "new";
  const locked = Boolean(d?.isSystem);

  const body = (
    <form action={action} className="grid items-end gap-3 md:grid-cols-[4.5rem_minmax(10rem,1fr)_minmax(12rem,1.4fr)_8rem_minmax(14rem,1.5fr)_auto]">
      {d ? <input type="hidden" name="id" value={d.id} /> : null}
      <Field label="Order" htmlFor={`${id}-order`}>
        <Input id={`${id}-order`} name="sortOrder" type="number" min={0} max={999} defaultValue={d?.sortOrder ?? 100} className="tabular-nums" />
      </Field>
      <Field label="Label" htmlFor={`${id}-label`}>
        <Input id={`${id}-label`} name="label" required defaultValue={d?.label} placeholder="e.g. Wrong number" />
      </Field>
      <Field label="Help text for agents" htmlFor={`${id}-desc`}>
        <Input id={`${id}-desc`} name="description" defaultValue={d?.description ?? ""} placeholder="Optional" />
      </Field>
      <Field label="Color" htmlFor={`${id}-tone`}>
        <Select id={`${id}-tone`} name="tone" defaultValue={d?.tone ?? "neutral"}>
          {TONES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="What happens to the lead" htmlFor={`${id}-action`}>
        <Select id={`${id}-action`} name="action" defaultValue={d?.action ?? "release"} disabled={locked}>
          {ACTIONS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton>{d ? "Save" : "Add outcome"}</SubmitButton>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:col-span-6">
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <Checkbox name="requiresCallback" defaultChecked={d?.requiresCallback} disabled={locked} />
          Requires a callback date and time
        </label>
        {d ? (
          <label className="flex items-center gap-2 text-sm text-ink-2">
            <Checkbox name="active" defaultChecked={d.active} disabled={locked} />
            Available to agents
          </label>
        ) : null}
        {locked ? <Badge>Required outcome</Badge> : null}
        <FormMessage state={state} />
      </div>
    </form>
  );

  return d ? <section className="rounded-lg border border-line bg-raised p-4">{body}</section> : body;
}
