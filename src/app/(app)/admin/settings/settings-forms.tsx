"use client";

import { useActionState, useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import type { BreakType } from "@/lib/settings-defaults";
import { saveBreaksAction, saveRulesAction, saveShiftAction } from "../config-actions";

type Rules = {
  businessTimezone: string;
  inactivityMinutes: number;
  autoAssignMinutes: number;
  leadPresets: string;
  maxLeadRequest: number;
  sessionIdleMinutes: number;
  sessionMaxHours: number;
};

export function RulesForm({ values: v, timezones }: { values: Rules; timezones: string[] }) {
  const [state, action] = useActionState(saveRulesAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Business time zone" htmlFor="tz" hint="Days, reports and callback times use this zone.">
        <Select id="tz" name="businessTimezone" defaultValue={v.businessTimezone}>
          {timezones.map((t) => (
            <option key={t} value={t}>
              {t.replace("_", " ")}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Idle after (minutes)" htmlFor="inact" hint="No keyboard or mouse activity for this long stops Active Time.">
        <Input id="inact" name="inactivityMinutes" type="number" min={1} max={60} defaultValue={v.inactivityMinutes} />
      </Field>
      <Field label="Auto-assign after (minutes)" htmlFor="auto" hint="Undecided lead requests are assigned automatically.">
        <Input id="auto" name="autoAssignMinutes" type="number" min={1} max={60} defaultValue={v.autoAssignMinutes} />
      </Field>
      <Field label="Preset request amounts" htmlFor="presets" hint="Comma-separated, e.g. 15, 30.">
        <Input id="presets" name="leadPresets" defaultValue={v.leadPresets} />
      </Field>
      <Field label="Largest request" htmlFor="maxreq" hint="Maximum leads per request.">
        <Input id="maxreq" name="maxLeadRequest" type="number" min={1} max={2000} defaultValue={v.maxLeadRequest} />
      </Field>
      <Field label="Sign out after inactivity (minutes)" htmlFor="idle" hint="With the app closed or no connection. Returns working leads.">
        <Input id="idle" name="sessionIdleMinutes" type="number" min={5} max={480} defaultValue={v.sessionIdleMinutes} />
      </Field>
      <Field label="Longest session (hours)" htmlFor="maxh" hint="Everyone signs in again after this.">
        <Input id="maxh" name="sessionMaxHours" type="number" min={1} max={24} defaultValue={v.sessionMaxHours} />
      </Field>
      <div className="flex flex-wrap items-end gap-3 sm:col-span-2 xl:col-span-4">
        <SubmitButton variant="primary">Save rules</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function BreaksForm({ breaks, categories }: { breaks: BreakType[]; categories: string[] }) {
  const [rows, setRows] = useState(breaks);
  const [cats, setCats] = useState(categories.join("\n"));
  const [state, setState] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-medium text-ink-2">Break types agents can choose</p>
        {rows.map((b, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input value={b.label} onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} aria-label="Break name" className="flex-1" />
            <Input
              type="number"
              min={1}
              max={240}
              value={b.maxMinutes}
              onChange={(e) => setRows((r) => r.map((x, j) => (j === i ? { ...x, maxMinutes: Number(e.target.value) } : x)))}
              aria-label="Allowed minutes"
              className="w-24 tabular-nums"
            />
            <span className="text-sm text-ink-3">min</span>
            <Button size="sm" variant="ghost" aria-label={`Remove ${b.label}`} onClick={() => setRows((r) => r.filter((_, j) => j !== i))}>
              <X aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" onClick={() => setRows((r) => [...r, { key: "", label: "", maxMinutes: 15 }])}>
            <Plus aria-hidden /> Add break type
          </Button>
        </div>
      </div>
      <Field label="HR document types" htmlFor="cats" hint="One per line. Used when HR uploads employee documents.">
        <Textarea id="cats" value={cats} onChange={(e) => setCats(e.target.value)} rows={7} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 lg:col-span-2">
        <Button variant="primary" pending={pending} onClick={() => startTransition(async () => setState(await saveBreaksAction(rows, cats.split("\n"))))}>
          Save breaks and document types
        </Button>
        <FormMessage state={state} />
      </div>
    </div>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function ShiftForm({ shift }: { shift?: { id: string; name: string; startTime: string; endTime: string; days: number[]; graceMinutes: number } }) {
  const [state, action] = useActionState(saveShiftAction, null);
  const id = shift?.id ?? "new";
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      {shift ? <input type="hidden" name="id" value={shift.id} /> : null}
      <Field label="Name" htmlFor={`${id}-n`}>
        <Input id={`${id}-n`} name="name" required defaultValue={shift?.name} className="w-52" placeholder="e.g. U.S. business hours" />
      </Field>
      <Field label="Starts" htmlFor={`${id}-s`}>
        <Input id={`${id}-s`} name="startTime" type="time" required defaultValue={shift?.startTime ?? "08:00"} className="w-32" />
      </Field>
      <Field label="Ends" htmlFor={`${id}-e`}>
        <Input id={`${id}-e`} name="endTime" type="time" required defaultValue={shift?.endTime ?? "17:00"} className="w-32" />
      </Field>
      <Field label="Grace (min)" htmlFor={`${id}-g`}>
        <Input id={`${id}-g`} name="graceMinutes" type="number" min={0} max={120} defaultValue={shift?.graceMinutes ?? 10} className="w-24" />
      </Field>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-[13px] font-medium text-ink-2">Days</legend>
        <div className="flex h-9 items-center gap-2.5">
          {DAYS.map((d, i) => (
            <label key={d} className="flex items-center gap-1 text-[13px] text-ink-2">
              <Checkbox name="days" value={i} defaultChecked={shift ? shift.days.includes(i) : i >= 1 && i <= 5} />
              {d}
            </label>
          ))}
        </div>
      </fieldset>
      <SubmitButton>{shift ? "Save" : "Add shift"}</SubmitButton>
      {state ? (
        <div className="w-full">
          <FormMessage state={state} />
        </div>
      ) : null}
    </form>
  );
}
