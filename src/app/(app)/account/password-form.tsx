"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { changePassword, signOut } from "@/lib/auth/actions";

export function PasswordForm({ submitLabel = "Update password" }: { submitLabel?: string }) {
  const [state, action] = useActionState(changePassword, null);
  const errors = state?.fieldErrors ?? {};
  return (
    <form action={action} className="flex max-w-sm flex-col gap-4">
      <Field label="Current password" htmlFor="current" error={errors.current}>
        <Input id="current" name="current" type="password" autoComplete="current-password" required aria-invalid={Boolean(errors.current)} />
      </Field>
      <Field label="New password" htmlFor="next" hint="At least 10 characters, with a letter and a number." error={errors.next}>
        <Input id="next" name="next" type="password" autoComplete="new-password" required minLength={10} aria-invalid={Boolean(errors.next)} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirm" error={errors.confirm}>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={Boolean(errors.confirm)} />
      </Field>
      <FormMessage state={state} />
      <div>
        <SubmitButton variant="primary">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}

/** Shown instead of the app until a temporary password is replaced. */
export function ForcedPasswordChange({ name }: { name: string }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-5 py-12">
      <div className="w-full max-w-sm">
        <span className="brand-mark mb-8 block size-9 text-ink" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">Choose your password</h1>
        <p className="mb-6 mt-1 text-sm text-ink-3">
          Welcome, {name.split(" ")[0]}. You signed in with a temporary password; replace it to continue.
        </p>
        <PasswordForm submitLabel="Save and continue" />
        <form action={signOut} className="mt-6">
          <button type="submit" className="text-sm text-ink-3 underline-offset-4 hover:text-ink hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
