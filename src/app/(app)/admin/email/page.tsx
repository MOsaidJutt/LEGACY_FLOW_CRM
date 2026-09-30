import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { PageHeader, Panel } from "@/components/ui/layout";
import { EmailForm } from "./email-form";

export const metadata: Metadata = { title: "Email" };

export default async function EmailSettingsPage() {
  await requirePermission("settings.manage");
  const { email } = await getSettings();

  return (
    <>
      <PageHeader
        title="Email"
        description="The outgoing mail server used for follow-up emails to leads. Until a server is entered here, the Send follow-up email button stays switched off."
      />
      <Panel>
        <EmailForm email={{ ...email, password: "" }} hasPassword={Boolean(email.password)} />
      </Panel>
    </>
  );
}
