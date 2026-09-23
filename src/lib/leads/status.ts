import type { Tone } from "@/components/ui/badge";

export const LEAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  available: { label: "In pool", tone: "neutral" },
  assigned: { label: "Assigned", tone: "accent" },
  follow_up: { label: "Follow-up", tone: "info" },
  closed: { label: "Closed", tone: "neutral" },
  dnc: { label: "Do not call", tone: "danger" },
};
