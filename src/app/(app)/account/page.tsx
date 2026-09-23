import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PageHeader, Panel } from "@/components/ui/layout";
import { PasswordForm } from "./password-form";
import { NameForm } from "./name-form";

export const metadata: Metadata = { title: "Your account" };

export default async function AccountPage() {
  const user = await requireUser();
  return (
    <>
      <PageHeader title="Your account" description="Your profile and sign-in details." />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel title="Profile">
          <dl className="mb-5 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-ink-3">Email</dt>
            <dd>{user.email}</dd>
            <dt className="text-ink-3">Role</dt>
            <dd>{user.roleName}</dd>
          </dl>
          <NameForm name={user.name} />
        </Panel>
        <Panel title="Password">
          <PasswordForm />
        </Panel>
      </div>
    </>
  );
}
