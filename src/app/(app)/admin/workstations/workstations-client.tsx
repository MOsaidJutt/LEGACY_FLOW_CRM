"use client";

import { useActionState, useState, useTransition } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { createDeviceAction, revokeDeviceAction, type DeviceState } from "./actions";

export function NewDeviceForm({ agents, appUrl }: { agents: { id: string; name: string }[]; appUrl: string }) {
  const [state, action] = useActionState<DeviceState, FormData>(createDeviceAction, null);
  const [copied, setCopied] = useState(false);
  const command = state?.token ? `powershell -ExecutionPolicy Bypass -File .\\Install-LegacyFlowAgent.ps1 -Url "${appUrl}" -Token "${state.token}"` : "";

  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4">
        <Field label="Agent" htmlFor="dev-user">
          <Select id="dev-user" name="userId" required defaultValue="">
            <option value="" disabled>
              Choose...
            </option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Computer name" htmlFor="dev-name">
          <Input id="dev-name" name="name" required placeholder="e.g. Desk 4" />
        </Field>
        <div>
          <SubmitButton variant="primary">Create install token</SubmitButton>
        </div>
        {state?.error ? <FormMessage state={state} /> : null}
      </form>

      {state?.token ? (
        <div className="flex flex-col gap-2 rounded-md border border-line bg-hover/50 p-3.5 text-[13px]">
          <p className="font-medium text-ink">Install on {state.name}</p>
          <ol className="list-decimal space-y-1 pl-4 text-ink-2">
            <li>
              Download{" "}
              <a href="/desktop-agent/LegacyFlowAgent.ps1" download className="underline underline-offset-4">
                LegacyFlowAgent.ps1
              </a>{" "}
              and{" "}
              <a href="/desktop-agent/Install-LegacyFlowAgent.ps1" download className="underline underline-offset-4">
                Install-LegacyFlowAgent.ps1
              </a>{" "}
              into one folder on the computer.
            </li>
            <li>Open PowerShell as administrator in that folder and run:</li>
          </ol>
          <code className="block break-all rounded bg-raised px-2 py-1.5 font-mono text-[12px] text-ink">{command}</code>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                await navigator.clipboard.writeText(command).catch(() => {});
                setCopied(true);
              }}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? "Copied" : "Copy command"}
            </Button>
            <span className="text-ink-3">The token is shown only once.</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function RevokeButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      pending={pending}
      onClick={() => {
        if (window.confirm(`Stop accepting reports from ${name}?`)) startTransition(async () => void (await revokeDeviceAction(id)));
      }}
    >
      Revoke
    </Button>
  );
}
