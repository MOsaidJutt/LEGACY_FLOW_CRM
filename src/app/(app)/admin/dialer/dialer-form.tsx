"use client";

import { useActionState, useState } from "react";
import { cn } from "@/lib/cn";
import { Field, Input } from "@/components/ui/input";
import { Panel } from "@/components/ui/layout";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveDialerAction } from "../config-actions";

type Settings = { mode: "clipboard" | "url" | "vcdialer"; urlTemplate: string; apiBaseUrl: string; accountId: string; hasApiKey: boolean; extensions: Record<string, string> };

const MODES = [
  { value: "clipboard", title: "Copy the number", body: "Clicking Call copies the number; the agent pastes it into VC Dialer. Works with any dialer, no setup." },
  { value: "url", title: "Click-to-call link", body: "Opens a dialer URL with the number filled in (for dialers or softphones that accept a link). The number is also copied." },
  { value: "vcdialer", title: "VC Dialer API", body: "The CRM asks VC Dialer to place the call for the agent's extension and receives call results. Needs API access from VC Dialer." },
] as const;

export function DialerForm({ settings, agents, webhookUrl }: { settings: Settings; agents: { id: string; name: string }[]; webhookUrl: string }) {
  const [mode, setMode] = useState(settings.mode);
  const [state, action] = useActionState(saveDialerAction, null);

  return (
    <form action={action} className="flex flex-col gap-5">
      <Panel title="Call method">
        <div className="grid gap-3 lg:grid-cols-3" role="radiogroup">
          {MODES.map((m) => (
            <label
              key={m.value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-md border p-3.5 transition-colors",
                mode === m.value ? "border-ink/60 bg-selected" : "border-line hover:border-line-strong",
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className="accent-accent" />
                {m.title}
              </span>
              <span className="text-[13px] text-ink-3">{m.body}</span>
            </label>
          ))}
        </div>
      </Panel>

      <Panel title="Click-to-call link" description="Placeholders: {phone} (10 digits), {e164} (+1...), {extension} (agent's extension), {lead} (lead id).">
        <Field label="URL template" htmlFor="urlTemplate">
          <Input id="urlTemplate" name="urlTemplate" defaultValue={settings.urlTemplate} placeholder="e.g. https://dialer.example.com/call?to={phone}&ext={extension}" className="font-mono text-[13px]" />
        </Field>
      </Panel>

      <Panel title="VC Dialer API" description="Fill these in when the client shares VC Dialer API documentation and credentials.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="API address" htmlFor="apiBaseUrl">
            <Input id="apiBaseUrl" name="apiBaseUrl" defaultValue={settings.apiBaseUrl} placeholder="https://api.vcdialer.example" />
          </Field>
          <Field label="API key" htmlFor="apiKey" hint={settings.hasApiKey ? "A key is saved. Leave empty to keep it." : "Kept on the server and never shown in the browser again."}>
            <Input id="apiKey" name="apiKey" type="password" autoComplete="new-password" placeholder={settings.hasApiKey ? "••••••••••••" : ""} />
          </Field>
          <Field label="Account ID" htmlFor="accountId">
            <Input id="accountId" name="accountId" defaultValue={settings.accountId} />
          </Field>
        </div>
        <div className="mt-4 rounded-md bg-hover/60 px-3.5 py-3 text-[13px] text-ink-2">
          <p className="font-medium text-ink">Call results webhook</p>
          <p className="mt-1">
            Give VC Dialer this address so call duration and recordings flow back into the CRM:{" "}
            <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink">{webhookUrl}</code>
          </p>
        </div>
      </Panel>

      <Panel title="Agent extensions" description="The VC Dialer extension or agent ID for each agent, used by the link {extension} placeholder and the API.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((a) => (
            <Field key={a.id} label={a.name} htmlFor={`ext-${a.id}`}>
              <Input id={`ext-${a.id}`} name={`ext:${a.id}`} defaultValue={settings.extensions[a.id] ?? ""} placeholder="e.g. 1042" />
            </Field>
          ))}
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="primary">Save dialer settings</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
