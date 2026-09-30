"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { sendFollowUpEmailAction } from "./email-actions";

export function FollowUpEmail({
  leadId,
  leadName,
  email,
  assignedAgent,
  configured,
}: {
  leadId: string;
  leadName: string;
  email: string | null;
  assignedAgent: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(`Following up, ${leadName}`);
  const [body, setBody] = useState("");
  const [result, setResult] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () =>
    startTransition(async () => {
      const r = await sendFollowUpEmailAction({ leadId, subject, body });
      setResult(r);
      if (r?.ok) {
        setOpen(false);
        setBody("");
        router.refresh();
      }
    });

  if (!email) {
    return <p className="text-sm text-ink-3">This lead has no email address, so a follow-up email cannot be sent.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <Button onClick={() => { setResult(null); setOpen(true); }} disabled={!configured}>
        <Mail aria-hidden /> Send follow-up email
      </Button>
      {!configured ? (
        <p className="text-sm text-ink-3">Sending is switched off until an admin adds the outgoing mail server in Admin, Email.</p>
      ) : (
        <p className="text-sm text-ink-3">
          Goes to {email}
          {assignedAgent ? `, and ${assignedAgent} is notified.` : ". No agent holds this lead yet."}
        </p>
      )}
      {result?.error && !open ? <FormMessage state={result} /> : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Send follow-up email"
        description={`To ${email}${assignedAgent ? ` · ${assignedAgent} will be notified` : ""}`}
        className="w-[min(94vw,40rem)]"
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={send} pending={pending} disabled={subject.trim().length < 2 || body.trim().length < 2}>
              Send email
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Field label="Subject" htmlFor="email-subject">
            <Input id="email-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Message" htmlFor="email-body">
            <Textarea id="email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} placeholder="Write the follow-up message." maxLength={10000} />
          </Field>
          <p className="text-sm text-ink-3">
            The email is recorded against this lead with the date, subject, recipient and who sent it. If it fails to send, the lead is not marked as contacted.
          </p>
          <FormMessage state={result} />
        </div>
      </Dialog>
    </div>
  );
}
