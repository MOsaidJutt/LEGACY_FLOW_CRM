import type { Metadata } from "next";
import { asc, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { PageHeader, Panel } from "@/components/ui/layout";
import { NewRoleForm, RoleEditor } from "./role-editor";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePermission("users.manage");
  const { roles } = schema;
  const rows = await db
    .select({
      id: roles.id,
      name: roles.name,
      description: roles.description,
      permissions: roles.permissions,
      isSystem: roles.isSystem,
      // qualified by hand: on a single-table select Drizzle renders ${roles.id} as a bare "id"
      users: sql<number>`(select count(*)::int from users u where u.role_id = "roles"."id")`,
    })
    .from(roles)
    .orderBy(asc(roles.isSystem), asc(roles.name));

  const groups = [...new Set(PERMISSIONS.map((p) => p.group))].map((g) => ({ group: g, items: PERMISSIONS.filter((p) => p.group === g).map((p) => ({ key: p.key, label: p.label })) }));
  const ordered = [...rows].sort((a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Roles & permissions" description="What each role can see and do. Changes apply to everyone with the role on their next page load." />
      <div className="flex flex-col gap-5">
        {ordered.map((r) => (
          <RoleEditor key={r.id} role={r} groups={groups} />
        ))}
        <Panel title="New role" description="Create a role for a new team, optionally starting from an existing role's permissions.">
          <NewRoleForm roles={ordered.map((r) => ({ id: r.id, name: r.name }))} />
        </Panel>
      </div>
    </>
  );
}
