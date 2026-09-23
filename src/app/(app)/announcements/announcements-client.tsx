"use client";

import { useActionState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { acknowledgeAction, postAnnouncementAction } from "./actions";

export function AnnouncementForm({ groups }: { groups: { id: string; name: string }[] }) {
  const [state, action] = useActionState(postAnnouncementAction, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Title" htmlFor="an-title">
        <Input id="an-title" name="title" required maxLength={160} />
      </Field>
      <Field label="Message" htmlFor="an-body">
        <Textarea id="an-body" name="body" required rows={5} />
      </Field>
      <Field label="Send to" htmlFor="an-group">
        <Select id="an-group" name="groupId" defaultValue="">
          <option value="">Everyone</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-2">
        <Checkbox name="requiresAck" /> Ask everyone to acknowledge it
      </label>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="primary">Post announcement</SubmitButton>
      </div>
    </form>
  );
}

export function AckButton({ id }: { id: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button size="sm" variant="primary" pending={pending} onClick={() => startTransition(async () => void (await acknowledgeAction(id)))}>
      I have read this
    </Button>
  );
}
