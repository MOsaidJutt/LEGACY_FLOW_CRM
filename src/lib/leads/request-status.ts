import type { Tone } from "@/components/ui/badge";

export const REQUEST_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Waiting", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  auto_approved: { label: "Auto-assigned", tone: "info" },
  rejected: { label: "Declined", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
