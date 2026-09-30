"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveEmailAction, testEmailAction } from "../config-actions";

type EmailSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

export function EmailForm({ email, hasPassword }: { email: EmailSettings; hasPassword: boolean }) {
  const [state, action] = useActionState(saveEmailAction, null);
  const [test, setTest] = useState<{ error?: string; message?: string } | null>(null);
  const [testing, startTest] = useTransition();

  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Mail server" htmlFor="host" hint="e.g. smtp.gmail.com, smtp.office365.com. Leave empty to switch sending off.">
          <Input id="host" name="host" defaultValue={email.host} placeholder="smtp.example.com" autoComplete="off" />
        </Field>
        <Field label="Port" htmlFor="port" hint="587 for STARTTLS, 465 for SSL.">
          <Input id="port" name="port" type="number" min={1} max={65535} defaultValue={email.port} className="tabular-nums" />
        </Field>
        <Field label="Username" htmlFor="user" hint="Usually the full email address.">
          <Input id="user" name="user" defaultValue={email.user} autoComplete="off" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Password" htmlFor="password" hint={hasPassword ? "A password is saved. Leave empty to keep it." : "Kept on the server and never shown again."}>
          <Input id="password" name="password" type="password" autoComplete="new-password" placeholder={hasPassword ? "••••••••••••" : ""} />
        </Field>
        <Field label="Send from" htmlFor="fromEmail" hint="The address leads see.">
          <Input id="fromEmail" name="fromEmail" type="email" defaultValue={email.fromEmail} placeholder="leads@yourdomain.com" />
        </Field>
        <Field label="Sender name" htmlFor="fromName">
          <Input id="fromName" name="fromName" defaultValue={email.fromName} placeholder="Lone Star Legacy" />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Reply-to" htmlFor="replyTo" hint="Optional. Where replies from leads should go.">
          <Input id="replyTo" name="replyTo" type="email" defaultValue={email.replyTo} placeholder="sales@yourdomain.com" />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink-2">
          <Checkbox name="secure" defaultChecked={email.secure} />
          Use SSL on connect (port 465)
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <SubmitButton>Save email settings</SubmitButton>
        <Button
          type="button"
          pending={testing}
          onClick={() =>
            startTest(async () => {
              setTest(await testEmailAction());
            })
          }
        >
          Test the connection
        </Button>
        <FormMessage state={test ?? state} />
      </div>
    </form>
  );
}
