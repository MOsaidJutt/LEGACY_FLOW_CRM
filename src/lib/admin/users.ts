import "server-only";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { ActionError } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { endSession } from "@/lib/auth/lifecycle";
import { hashPassword, temporaryPassword } from "@/lib/auth/password";

const { users, roles, sessions } = schema;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type UserInput = { name: string; email: string; roleId: string; shiftId: string | null };

function validate(input: UserInput) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new ActionError("Enter the person's full name.");
  if (!EMAIL.test(email)) throw new ActionError("Enter a valid email address.");
  return { ...input, name: name.slice(0, 120), email: email.slice(0, 200) };
}

/** At least one active user must keep the ability to manage users. */
async function assertAdminRemains(tx: Tx, excludingUserId: string, newRoleId?: string | null) {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.status, "active"), ne(users.id, excludingUserId), sql`${roles.permissions} @> '["users.manage"]'::jsonb`));
  if (row.n > 0) return;
  if (newRoleId) {
    const [role] = await tx.select({ permissions: roles.permissions }).from(roles).where(eq(roles.id, newRoleId));
    if (role?.permissions.includes("users.manage")) return;
  }
  throw new ActionError("At least one active account must be able to manage users.");
}

export async function createUser(actorId: string, input: UserInput) {
  const v = validate(input);
  const password = temporaryPassword();
  const id = await db.transaction(async (tx) => {
    const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, v.email));
    if (taken) throw new ActionError("An account with this email already exists.");
    const [role] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.id, v.roleId));
    if (!role) throw new ActionError("Choose a role.");
    const [row] = await tx
      .insert(users)
      .values({ name: v.name, email: v.email, roleId: v.roleId, shiftId: v.shiftId, passwordHash: await hashPassword(password), mustChangePassword: true })
      .returning({ id: users.id });
    await tx.insert(schema.employeeProfiles).values({ userId: row.id }).onConflictDoNothing();
    await audit({ actorId, action: "user_created", module: "users", entityType: "user", entityId: row.id, after: { name: v.name, email: v.email, roleId: v.roleId } }, tx);
    return row.id;
  });
  return { id, password };
}

export async function updateUser(actorId: string, userId: string, input: UserInput & { status: "active" | "inactive" }) {
  const v = validate(input);
  const deactivated = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!before) throw new ActionError("User not found.");
    if (v.email !== before.email) {
      const [taken] = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, v.email), ne(users.id, userId)));
      if (taken) throw new ActionError("Another account already uses this email.");
    }
    if (userId === actorId && input.status === "inactive") throw new ActionError("You cannot deactivate your own account.");
    if (input.status === "inactive" || v.roleId !== before.roleId) await assertAdminRemains(tx, userId, input.status === "active" ? v.roleId : null);

    const next = { name: v.name, email: v.email, roleId: v.roleId, shiftId: v.shiftId, status: input.status };
    const d = diff(before as unknown as Record<string, unknown>, next);
    if (!d.changed) return false;
    await tx.update(users).set(next).where(eq(users.id, userId));
    await audit({ actorId, action: input.status !== before.status ? (input.status === "inactive" ? "user_deactivated" : "user_activated") : "user_updated", module: "users", entityType: "user", entityId: userId, before: d.before, after: d.after }, tx);
    return input.status === "inactive" && before.status === "active";
  });
  if (deactivated) await endAllSessions(userId);
}

export async function resetPassword(actorId: string, userId: string) {
  const password = temporaryPassword();
  const [row] = await db.update(users).set({ passwordHash: await hashPassword(password), mustChangePassword: true }).where(eq(users.id, userId)).returning({ id: users.id });
  if (!row) throw new ActionError("User not found.");
  await audit({ actorId, action: "password_reset", module: "users", entityType: "user", entityId: userId });
  if (userId !== actorId) await endAllSessions(userId);
  return password;
}

/** Signs a user out everywhere (their working leads return to the pool). */
export async function endAllSessions(userId: string) {
  const open = await db.select({ id: sessions.id }).from(sessions).where(and(eq(sessions.userId, userId), isNull(sessions.endedAt)));
  for (const s of open) await endSession(s.id, "revoked");
  return open.length;
}
