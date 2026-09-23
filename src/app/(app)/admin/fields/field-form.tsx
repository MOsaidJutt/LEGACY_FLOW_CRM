"use client";

import { useActionState } from "react";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveFieldAction } from "../config-actions";

type Field = { id: string; key: string; label: string; type: string; isCore: boolean; active: boolean };
const TYPES = ["text", "phone", "email", "url", "number", "date"];

export function FieldForm({ field: f }: { field?: Field }) {
  const [state, action] = useActionState(saveFieldAction, null);
  return (
    <form action={action} className={f ? "flex flex-wrap items-center gap-3 px-4 py-2.5" : "flex flex-wrap items-center gap-3"}>
      {f ? <input type="hidden" name="id" value={f.id} /> : null}
      <Input name="label" required defaultValue={f?.label} placeholder="Field label, e.g. Employees" aria-label="Field label" className="w-64" />
      <Select name="type" defaultValue={f?.type ?? "text"} aria-label="Field type" className="w-32" disabled={f?.isCore}>
        {TYPES.map((t) => (
          <option key={t} value={t}>
            {t[0].toUpperCase() + t.slice(1)}
          </option>
        ))}
      </Select>
      {f?.isCore ? <input type="hidden" name="type" value={f.type} /> : null}
      {f ? <code className="text-xs text-ink-3">{f.key}</code> : null}
      {f && !f.isCore ? (
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <Checkbox name="active" defaultChecked={f.active} /> Active
        </label>
      ) : null}
      <SubmitButton size="sm" className="ml-auto">
        {f ? "Save" : "Add field"}
      </SubmitButton>
      {state ? (
        <div className="w-full">
          <FormMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}
