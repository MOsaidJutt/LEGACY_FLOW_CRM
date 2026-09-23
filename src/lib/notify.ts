import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { schema, type DB, type Tx } from "@/db";
import type { Permission } from "@/lib/auth/permissions";

export type NotificationInput = {
  type: string;
  title: string;
  body?: string;
  link?: string;
};

export async function notify(tx: DB | Tx, userIds: string[], n: NotificationInput) {
  const unique = [...new Set(userIds)];
  if (!unique.length) return;
  await tx.insert(schema.notifications).values(
    unique.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, link: n.link ?? null })),
  );
}

/** Active users whose role grants a permission (e.g. everyone who can approve lead requests). */
export async function usersWithPermission(tx: DB | Tx, permission: Permission) {
  const rows = await tx
    .select({ id: schema.users.id })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.users.status, "active"), sql`${schema.roles.permissions} @> ${JSON.stringify([permission])}::jsonb`));
  return rows.map((r) => r.id);
}
