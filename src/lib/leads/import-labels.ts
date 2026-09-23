import type { Tone } from "@/components/ui/badge";

export const ISSUE_LABELS: Record<string, { label: string; tone: Tone }> = {
  missing_phone: { label: "Missing phone", tone: "warning" },
  missing_company: { label: "Missing company", tone: "warning" },
  missing_contact_name: { label: "Missing contact", tone: "warning" },
  invalid_phone: { label: "Invalid U.S. phone", tone: "danger" },
  invalid_email: { label: "Invalid email", tone: "warning" },
  duplicate_in_file: { label: "Duplicate in file", tone: "neutral" },
  duplicate_existing: { label: "Matches existing lead", tone: "info" },
};

export const DECISION_LABELS: Record<string, string> = {
  import: "Import",
  reject: "Reject",
  keep_both: "Keep both",
  update: "Update existing",
  review: "Needs review",
};

/** Pseudo targets that combine into the contact name. */
export const NAME_PARTS = { first_name: "First name (part of contact)", last_name: "Last name (part of contact)" } as const;
export const NEW_FIELD = "__new__";
