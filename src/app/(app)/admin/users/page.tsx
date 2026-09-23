import type { Metadata } from "next";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/layout";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requirePermission("users.manage");
  const tz = (await getSettings()).businessTimezone;
  const { users, roles, shifts, sessions } = schema;

  const [rows, roleRows, shiftRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        status: users.status,
        roleId: users.roleId,
        roleName: roles.name,
        shiftId: users.shiftId,
        lastLoginAt: users.lastLoginAt,
        mustChangePassword: users.mustChangePassword,
        openSessions: sql<number>`(select count(*)::int from ${sessions} s where s.user_id = ${users.id} and s.ended_at is null and s.expires_at > now())`,
      })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .orderBy(asc(users.status), asc(roles.name), asc(users.name)),
    db.select({ id: roles.id, name: roles.name }).from(roles).orderBy(asc(roles.name)),
    db.select({ id: shifts.id, name: shifts.name }).from(shifts).orderBy(asc(shifts.name)),
  ]);

  const active = rows.filter((r) => r.status === "active").length;

  return (
    <>
      <PageHeader title="Users" description={`${active} active ${active === 1 ? "account" : "accounts"}. New accounts get a temporary password that must be changed at first sign-in.`} />
      <UsersTable
        meId={me.id}
        roles={roleRows}
        shifts={shiftRows}
        rows={rows.map((r) => ({
          ...r,
          lastLogin: r.lastLoginAt ? formatDateTime(r.lastLoginAt, tz) : null,
        }))}
      />
    </>
  );
}
