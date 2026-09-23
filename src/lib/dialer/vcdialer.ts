import "server-only";
import type { DialerSettings } from "@/lib/settings";
import type { DialerProvider } from "./index";

/**
 * VC Dialer integration slot.
 *
 * Waiting on the client's VC Dialer plan details and API documentation. When they
 * arrive, implement `startCall` against the documented "originate / click-to-call"
 * endpoint and, if the API offers webhooks, map call events in
 * src/app/api/dialer/webhook/route.ts (call start/end, duration, recording URL).
 *
 * Until then `isConfigured` stays false unless credentials are saved, and the
 * Call button falls back to copying the number, as the requirements specify.
 */
export const vcDialer: DialerProvider = {
  id: "vcdialer",

  isConfigured(settings: DialerSettings) {
    const c = settings.vcdialer;
    return Boolean(c.apiBaseUrl && c.apiKey);
  },

  async startCall(settings, ctx) {
    const c = settings.vcdialer;
    if (!ctx.extension) throw new Error("No VC Dialer extension is mapped to this agent");

    // Placeholder request shape; replace with the real endpoint and payload from VC Dialer's docs.
    const response = await fetch(new URL("/calls", c.apiBaseUrl), {
      method: "POST",
      headers: { Authorization: `Bearer ${c.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ account: c.accountId, agent: ctx.extension, to: ctx.phoneE164, reference: ctx.leadId }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`VC Dialer responded ${response.status}`);
    const body = (await response.json().catch(() => ({}))) as { id?: string; callId?: string };
    return { externalId: body.callId ?? body.id ?? null };
  },
};
