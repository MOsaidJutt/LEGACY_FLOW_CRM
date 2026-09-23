import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { agentUsers } from "@/lib/metrics";
import { PageHeader } from "@/components/ui/layout";
import { DialerForm } from "./dialer-form";

export const metadata: Metadata = { title: "Dialer" };

export default async function DialerPage() {
  await requirePermission("settings.manage");
  const [settings, agents] = await Promise.all([getSettings(), agentUsers()]);
  const d = settings.dialer;
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return (
    <>
      <PageHeader
        title="Dialer"
        description="How the agent's Call button works. Copying the number to the clipboard always works; connect VC Dialer here once its API access is available."
      />
      <DialerForm
        settings={{ mode: d.mode, urlTemplate: d.urlTemplate, apiBaseUrl: d.vcdialer.apiBaseUrl, accountId: d.vcdialer.accountId, hasApiKey: Boolean(d.vcdialer.apiKey), extensions: d.extensions }}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        webhookUrl={`${appUrl || "https://<your-domain>"}/api/dialer/webhook`}
      />
    </>
  );
}
