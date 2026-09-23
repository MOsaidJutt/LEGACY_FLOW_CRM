"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, formString, ActionError, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createUser, endAllSessions, resetPassword, updateUser } from "@/lib/admin/users";

const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);

/* ------------------------------------------------------------------ users */

export type UserFormState = (ActionState & { password?: string; email?: string }) | null;

export async function saveUserAction(_prev: UserFormState, formData: FormData): Promise<UserFormState> {
  try {
    const actor = await authorize("users.manage");
    const id = uuid(formString(formData, "id"));
    const input = {
      name: formString(formData, "name"),
      email: formString(formData, "email"),
      roleId: formString(formData, "roleId"),
      shiftId: uuid(formString(formData, "shiftId")),
    };
    if (id) {
      const status = formString(formData, "status") === "inactive" ? "inactive" : "active";
      await updateUser(actor.id, id, { ...input, status });
      revalidatePath("/admin/users");
      return { ok: true, message: "Changes saved." };
    }
    const created = await createUser(actor.id, input);
    revalidatePath("/admin/users");
    return { ok: true, message: "Account created.", password: created.password, email: input.email.toLowerCase() };
  } catch (error) {
    return failure(error);
  }
}

export async function resetPasswordAction(userId: string): Promise<UserFormState> {
  try {
    const actor = await authorize("users.manage");
    const password = await resetPassword(actor.id, userId);
    revalidatePath("/admin/users");
    return { ok: true, password };
  } catch (error) {
    return failure(error);
  }
}

export async function signOutUserAction(userId: string): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const n = await endAllSessions(userId);
    await audit({ actorId: actor.id, action: "sessions_revoked", module: "users", entityType: "user", entityId: userId, after: { sessions: n } });
    revalidatePath("/admin/users");
    return { ok: true, message: n ? `Signed out of ${n} ${n === 1 ? "session" : "sessions"}.` : "No open sessions." };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ roles */

const VALID = new Set<string>(PERMISSIONS.map((p) => p.key));

export async function saveRoleAction(roleId: string, permissions: string[]): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const next = [...new Set(permissions.filter((p) => VALID.has(p)))];
    await db.transaction(async (tx) => {
      const [role] = await tx.select().from(schema.roles).where(eq(schema.roles.id, roleId)).for("update");
      if (!role) throw new ActionError("Role not found.");
      if (role.permissions.includes("users.manage") && !next.includes("users.manage")) {
        const [others] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.users)
          .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
          .where(and(eq(schema.users.status, "active"), sql`${schema.roles.id} <> ${roleId}`, sql`${schema.roles.permissions} @> '["users.manage"]'::jsonb`));
        if (others.n === 0) throw new ActionError("No other active account could manage users. Keep “Manage user accounts” on this role.");
      }
      await tx.update(schema.roles).set({ permissions: next }).where(eq(schema.roles.id, roleId));
      await audit({ actorId: actor.id, action: "role_permissions_changed", module: "users", entityType: "role", entityId: roleId, before: { permissions: role.permissions }, after: { permissions: next } }, tx);
    });
    revalidatePath("/admin/roles");
    return { ok: true, message: "Permissions saved. They apply on each user's next page load." };
  } catch (error) {
    return failure(error);
  }
}

export async function createRoleAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const name = formString(formData, "name").slice(0, 80);
    if (name.length < 2) return { error: "Name the role." };
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "role";
    const basedOn = uuid(formString(formData, "basedOn"));
    let permissions: string[] = [];
    if (basedOn) {
      const [base] = await db.select({ permissions: schema.roles.permissions }).from(schema.roles).where(eq(schema.roles.id, basedOn));
      permissions = base?.permissions ?? [];
    }
    const [taken] = await db.select({ id: schema.roles.id }).from(schema.roles).where(eq(schema.roles.key, key));
    if (taken) return { error: "A role with this name already exists." };
    const [role] = await db.insert(schema.roles).values({ key, name, description: formString(formData, "description") || null, permissions }).returning({ id: schema.roles.id });
    await audit({ actorId: actor.id, action: "role_created", module: "users", entityType: "role", entityId: role.id, after: { name, permissions } });
    revalidatePath("/admin/roles");
    return { ok: true, message: `Role “${name}” created.` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteRoleAction(roleId: string): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, roleId));
    if (!role) return { error: "Role not found." };
    if (role.isSystem) return { error: "Built-in roles cannot be deleted." };
    const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.roleId, roleId));
    if (used.n > 0) return { error: `Move the ${used.n} ${used.n === 1 ? "user" : "users"} with this role to another role first.` };
    await db.delete(schema.roles).where(eq(schema.roles.id, roleId));
    await audit({ actorId: actor.id, action: "role_deleted", module: "users", entityType: "role", entityId: roleId, before: { name: role.name } });
    revalidatePath("/admin/roles");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ groups */

export async function createGroupAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const name = formString(formData, "name").slice(0, 80);
    if (name.length < 2) return { error: "Name the group." };
    const [exists] = await db.select({ id: schema.groups.id }).from(schema.groups).where(sql`lower(${schema.groups.name}) = ${name.toLowerCase()}`);
    if (exists) return { error: "A group with this name already exists." };
    const [g] = await db.insert(schema.groups).values({ name, description: formString(formData, "description") || null }).returning({ id: schema.groups.id });
    await audit({ actorId: actor.id, action: "group_created", module: "users", entityType: "group", entityId: g.id, after: { name } });
    revalidatePath("/admin/groups");
    return { ok: true, message: `Group “${name}” created.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setGroupMembersAction(groupId: string, userIds: string[]): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const ids = [...new Set(userIds.filter((u) => uuid(u)))];
    await db.transaction(async (tx) => {
      const before = await tx.select({ userId: schema.groupMembers.userId }).from(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
      await tx.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
      if (ids.length) {
        const valid = await tx.select({ id: schema.users.id }).from(schema.users).where(inArray(schema.users.id, ids));
        if (valid.length) await tx.insert(schema.groupMembers).values(valid.map((u) => ({ groupId, userId: u.id })));
      }
      await audit({ actorId: actor.id, action: "group_members_changed", module: "users", entityType: "group", entityId: groupId, before: { members: before.map((b) => b.userId) }, after: { members: ids } }, tx);
    });
    revalidatePath("/admin/groups");
    return { ok: true, message: "Members saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteGroupAction(groupId: string): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    const [g] = await db.delete(schema.groups).where(eq(schema.groups.id, groupId)).returning({ name: schema.groups.name });
    if (g) await audit({ actorId: actor.id, action: "group_deleted", module: "users", entityType: "group", entityId: groupId, before: { name: g.name } });
    revalidatePath("/admin/groups");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
