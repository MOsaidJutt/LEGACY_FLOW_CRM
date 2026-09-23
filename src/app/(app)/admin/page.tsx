import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";

export default async function AdminHome() {
  const user = await requirePermission("users.manage", "settings.manage", "audit.view");
  redirect(user.permissions.includes("users.manage") ? "/admin/users" : user.permissions.includes("settings.manage") ? "/admin/dispositions" : "/admin/audit");
}
