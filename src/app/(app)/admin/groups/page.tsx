import type { Metadata } from "next";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Panel } from "@/components/ui/layout";
import { GroupCard, NewGroupForm } from "./groups-client";

export const metadata: Metadata = { title: "Groups" };

export default async function GroupsPage() {
  await requirePermission("users.manage");
  const { groups, groupMembers, users, roles } = schema;
  const [groupRows, memberRows, userRows] = await Promise.all([
    db.select().from(groups).orderBy(asc(groups.name)),
    db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers),
    db
      .select({ id: users.id, name: users.name, role: roles.name })
      .from(users)
      .innerJoin(roles, eq(roles.id, users.roleId))
      .where(eq(users.status, "active"))
      .orderBy(asc(users.name)),
  ]);

  return (
    <>
      <PageHeader title="Groups" description="Teams used for messaging, announcements and reporting, such as B2B Team, Senior Agents or Training Team." />
      <div className="flex flex-col gap-5">
        <div className="grid gap-5 lg:grid-cols-2">
          {groupRows.map((g) => (
            <GroupCard key={g.id} group={{ id: g.id, name: g.name, description: g.description }} members={memberRows.filter((m) => m.groupId === g.id).map((m) => m.userId)} users={userRows} />
          ))}
        </div>
        <Panel title="New group">
          <NewGroupForm />
        </Panel>
      </div>
    </>
  );
}
