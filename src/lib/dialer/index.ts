import "server-only";
import type { DialerSettings } from "@/lib/settings";
import { vcDialer } from "./vcdialer";

/**
 * How the agent's Call button behaves. The browser always receives a plan and
 * carries it out; the clipboard copy happens in every mode as a safety net.
 *
 *   clipboard - copy the number (the SRS fallback, always available)
 *   url       - open a click-to-call URL built from settings.urlTemplate
 *   dialer    - the server asked the dialer API to place the call
 */
export type DialPlan =
  | { method: "clipboard"; reason?: string }
  | { method: "url"; url: string }
  | { method: "dialer"; externalId: string | null };

export type DialContext = {
  phoneE164: string;
  agentId: string;
  leadId: string;
};

export interface DialerProvider {
  readonly id: string;
  /** True when enough configuration exists to try placing calls. */
  isConfigured(settings: DialerSettings): boolean;
  /** Ask the dialer to place the call; return its call id when it provides one. */
  startCall(settings: DialerSettings, ctx: DialContext & { extension: string | null }): Promise<{ externalId: string | null }>;
}

export async function planDial(settings: DialerSettings, ctx: DialContext): Promise<DialPlan> {
  const extension = settings.extensions[ctx.agentId] ?? null;

  if (settings.mode === "vcdialer") {
    if (!vcDialer.isConfigured(settings)) return { method: "clipboard", reason: "VC Dialer is not connected yet" };
    try {
      const { externalId } = await vcDialer.startCall(settings, { ...ctx, extension });
      return { method: "dialer", externalId };
    } catch (error) {
      console.error("[dialer] VC Dialer call failed, falling back to clipboard", error);
      return { method: "clipboard", reason: "VC Dialer did not accept the call" };
    }
  }

  if (settings.mode === "url" && settings.urlTemplate.trim()) {
    const digits = ctx.phoneE164.replace(/^\+1/, "");
    const url = settings.urlTemplate
      .replaceAll("{phone}", encodeURIComponent(digits))
      .replaceAll("{e164}", encodeURIComponent(ctx.phoneE164))
      .replaceAll("{extension}", encodeURIComponent(extension ?? ""))
      .replaceAll("{lead}", encodeURIComponent(ctx.leadId));
    if (/^(https?|tel|sip|callto):/i.test(url)) return { method: "url", url };
    return { method: "clipboard", reason: "The click-to-call URL is not valid" };
  }

  return { method: "clipboard" };
}
