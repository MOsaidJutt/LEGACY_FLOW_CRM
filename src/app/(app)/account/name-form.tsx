"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { updateOwnName } from "@/lib/auth/actions";

export function NameForm({ name }: { name: string }) {
  const [state, action] = useActionState(updateOwnName, null);
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      <Field label="Full name" htmlFor="name">
        <Input id="name" name="name" defaultValue={name} required autoComplete="name" />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton>Save name</SubmitButton>
      </div>
    </form>
  );
}
