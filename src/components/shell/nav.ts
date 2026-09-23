import {
  Award,
  Bell,
  Monitor,
  CalendarClock,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  Database,
  FileSpreadsheet,
  Gauge,
  Inbox,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessagesSquare,
  PhoneCall,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Tags,
  TimerReset,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import type { Permission } from "@/lib/auth/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  anyOf: Permission[] | "everyone";
  exact?: boolean;
  badge?: "notifications" | "requests" | "messages";
};

export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Calling",
    items: [
      { href: "/agent", label: "Dashboard", icon: LayoutDashboard, anyOf: ["leads.work"], exact: true },
      { href: "/agent/calls", label: "Call list", icon: PhoneCall, anyOf: ["leads.work"] },
      { href: "/agent/callbacks", label: "Callbacks", icon: CalendarClock, anyOf: ["leads.work"] },
      { href: "/agent/request", label: "Request leads", icon: Inbox, anyOf: ["leads.request"] },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/manage", label: "Overview", icon: Gauge, anyOf: ["monitor.view", "leads.manage"], exact: true },
      { href: "/manage/requests", label: "Lead requests", icon: Inbox, anyOf: ["leads.requests.decide"], badge: "requests" },
      { href: "/manage/leads", label: "Leads", icon: Database, anyOf: ["leads.manage"] },
      { href: "/manage/imports", label: "Imports", icon: FileSpreadsheet, anyOf: ["leads.import"] },
      { href: "/manage/agents", label: "Agents", icon: UsersRound, anyOf: ["monitor.view"] },
      { href: "/manage/reports", label: "Reports", icon: ChartColumn, anyOf: ["reports.view"] },
      { href: "/manage/performance", label: "Performance", icon: Award, anyOf: ["reports.approve"] },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/hr", label: "Employees", icon: UserRound, anyOf: ["hr.manage"], exact: true },
      { href: "/hr/leave", label: "Leave", icon: CalendarDays, anyOf: ["hr.manage"] },
      { href: "/hr/attendance", label: "Attendance", icon: ClipboardList, anyOf: ["hr.attendance"] },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Users", icon: Users, anyOf: ["users.manage"] },
      { href: "/admin/roles", label: "Roles & permissions", icon: ShieldCheck, anyOf: ["users.manage"] },
      { href: "/admin/groups", label: "Groups", icon: UsersRound, anyOf: ["users.manage"] },
      { href: "/admin/workstations", label: "Workstations", icon: Monitor, anyOf: ["users.manage"] },
      { href: "/admin/dispositions", label: "Dispositions", icon: ListChecks, anyOf: ["settings.manage"] },
      { href: "/admin/fields", label: "Lead fields", icon: Tags, anyOf: ["settings.manage"] },
      { href: "/admin/dialer", label: "Dialer", icon: Smartphone, anyOf: ["settings.manage"] },
      { href: "/admin/settings", label: "Time & rules", icon: TimerReset, anyOf: ["settings.manage"] },
      { href: "/admin/audit", label: "Audit log", icon: ScrollText, anyOf: ["audit.view"] },
    ],
  },
  {
    label: "Communication",
    items: [
      { href: "/messages", label: "Messages", icon: MessagesSquare, anyOf: ["messages.use"], badge: "messages" },
      { href: "/announcements", label: "Announcements", icon: Megaphone, anyOf: ["messages.use", "announcements.post"] },
      { href: "/notifications", label: "Notifications", icon: Bell, anyOf: "everyone", badge: "notifications" },
    ],
  },
];

export const SETTINGS_ICON = SlidersHorizontal;

export function navFor(permissions: readonly string[]) {
  return NAV.map((group) => ({
    ...group,
    items: group.items.filter((i) => i.anyOf === "everyone" || i.anyOf.some((p) => permissions.includes(p))),
  })).filter((group) => group.items.length > 0);
}
