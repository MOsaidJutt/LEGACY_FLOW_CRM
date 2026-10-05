"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { sendFollowUpEmailAction } from "@/app/(app)/lead-email-actions";

/**
 * Send a follow-up email to a lead. Used by Management on the lead record and by
 * agents in the calling workspace. When the lead has no address, one can be typed
 * and it is saved to the lead.
 */
export function FollowUpEmail({
  leadId,
  leadName,
  email,
  assignedAgent,
  configured,
  lastSent,
  compact,
}: {
  leadId: string;
  leadName: string;
  email: string | null;
  assignedAgent?: string | null;
  configured: boolean;
  lastSent?: string | null;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState(email ?? "");
  const [subject, setSubject] = useState(`Following up, ${leadName}`);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const validTo = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to.trim());

  const send = () =>
    startTransition(async () => {
      const r = await sendFollowUpEmailAction({ leadId, subject, body, to: to.trim() });
      setResult(r);
      if (r?.ok) {
        setOpen(false);
        setBody("");
        router.refresh();
      }
    });

  const button = (
    <Button
      variant={compact ? "ghost" : "primary"}
      size={compact ? "md" : undefined}
      onClick={() => {
        setResult(null);
        setOpen(true);
      }}
      disabled={!configured}
      title={configured ? "Send a follow-up email to this lead" : "Email sending is not set up yet"}
    >
      <Mail aria-hidden /> Send email
    </Button>
  );

  return (
    <div className={compact ? "contents" : "flex flex-col gap-2"}>
      {button}
      {!compact ? (
        <>
          {lastSent ? <Badge tone="success">Email sent {lastSent}</Badge> : null}
          {!configured ? (
            <p className="text-sm text-ink-3">Sending is switched off until an admin adds the outgoing mail server in Admin, Email.</p>
          ) : (
            <p className="text-sm text-ink-3">
              {email ? `Goes to ${email}` : "No address on this lead yet; you can type one when sending."}
              {assignedAgent ? ` · ${assignedAgent} is notified.` : ""}
            </p>
          )}
          {result?.error && !open ? <FormMessage state={result} /> : null}
        </>
      ) : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Send follow-up email"
        description={leadName}
        className="w-[min(94vw,40rem)]"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={send} pending={pending} disabled={!validTo || subject.trim().length < 2 || body.trim().length < 2}>
              <Mail aria-hidden /> Send email
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="To" htmlFor="email-to" hint={email ? "Correct it if needed; the lead is updated." : "This lead has no address yet. What you enter is saved to the lead."}>
            <Input id="email-to" type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.com" maxLength={200} />
          </Field>
          <Field label="Subject" htmlFor="email-subject">
            <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Message" htmlFor="email-body">
            <Textarea id="email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} placeholder="Write the follow-up message." maxLength={10000} />
          </Field>
          <p className="text-sm text-ink-3">
            The email is recorded on this lead with the date, subject, recipient and sender, and Management can see every email in one place. If sending fails, the
            lead is not marked as contacted.
          </p>
          <FormMessage state={result} />
        </div>
      </Dialog>
    </div>
  );
}
