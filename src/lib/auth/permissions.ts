export const PERMISSIONS = [
  { key: "leads.request", group: "Leads", label: "Request leads" },
  { key: "leads.work", group: "Leads", label: "Work assigned leads and record call outcomes" },
  { key: "leads.import", group: "Leads", label: "Import lead files" },
  { key: "leads.manage", group: "Leads", label: "Search, assign, release and transfer all leads" },
  { key: "leads.requests.decide", group: "Leads", label: "Approve, reject or adjust lead requests" },
  { key: "calls.recordings", group: "Calls", label: "Listen to call recordings" },
  { key: "monitor.view", group: "Monitoring", label: "View activity monitoring and agent metrics" },
  { key: "reports.view", group: "Reports", label: "Generate and export reports" },
  { key: "reports.approve", group: "Reports", label: "Approve reports and change Management Scores" },
  { key: "messages.use", group: "Communication", label: "Send and receive messages" },
  { key: "announcements.post", group: "Communication", label: "Post announcements" },
  { key: "hr.manage", group: "HR", label: "Manage employee records, documents and leave" },
  { key: "hr.attendance", group: "HR", label: "View attendance and punctuality" },
  { key: "users.manage", group: "Administration", label: "Manage user accounts, roles and groups" },
  { key: "settings.manage", group: "Administration", label: "Manage settings, dispositions, fields and dialer" },
  { key: "audit.view", group: "Administration", label: "View the audit log" },
] as const;

export type Permission = (typeof PERMISSIONS)[number]["key"];

export const DEFAULT_ROLES: Record<string, { name: string; description: string; permissions: Permission[] }> = {
  agent: {
    name: "Agent",
    description: "Requests and calls leads, records outcomes and callbacks.",
    permissions: ["leads.request", "leads.work", "messages.use"],
  },
  management: {
    name: "Management",
    description: "Imports and distributes leads, monitors the floor, runs reports.",
    permissions: [
      "leads.import",
      "leads.manage",
      "leads.requests.decide",
      "calls.recordings",
      "monitor.view",
      "reports.view",
      "reports.approve",
      "messages.use",
      "announcements.post",
      "hr.attendance",
      "audit.view",
    ],
  },
  admin: {
    name: "Admin",
    description: "Manages accounts, permissions and system configuration.",
    permissions: ["users.manage", "settings.manage", "audit.view", "monitor.view", "reports.view", "messages.use", "announcements.post"],
  },
  hr: {
    name: "HR",
    description: "Maintains employee records, documents, attendance and leave.",
    permissions: ["hr.manage", "hr.attendance", "messages.use"],
  },
};

/** Where a user lands after signing in, derived from what they can do. */
export function homeFor(permissions: readonly string[]) {
  const has = (p: Permission) => permissions.includes(p);
  if (has("leads.work")) return "/agent";
  if (has("leads.manage") || has("monitor.view")) return "/manage";
  if (has("users.manage") || has("settings.manage")) return "/admin";
  if (has("hr.manage")) return "/hr";
  if (has("messages.use")) return "/messages";
  return "/account";
}
