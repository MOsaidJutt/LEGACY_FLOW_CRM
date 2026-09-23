"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { audit } from "@/lib/audit";
import { authorize, failure, formString, type ActionState } from "@/lib/actions";
import { endSession } from "./lifecycle";
import { hashPassword, passwordProblem, verifyPassword } from "./password";
import { clearSessionCookie, currentSessionId, getCurrentUser } from "./session";
import { homeFor } from "./permissions";

export async function signOut() {
  const sessionId = await currentSessionId();
  if (sessionId) {
    const user = await getCurrentUser();
    await endSession(sessionId, "logout");
    if (user) await audit({ actorId: user.id, action: "logout", module: "auth", entityType: "user", entityId: user.id });
  }
  await clearSessionCookie();
  redirect("/login");
}

export async function changePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let forced = false;
  let permissions: string[] = [];
  try {
    const user = await authorize();
    forced = user.mustChangePassword;
    permissions = user.permissions;
    const current = String(formData.get("current") ?? "");
    const next = String(formData.get("next") ?? "");
    const confirm = String(formData.get("confirm") ?? "");

    const [row] = await db.select({ hash: schema.users.passwordHash }).from(schema.users).where(eq(schema.users.id, user.id));
    if (!row || !(await verifyPassword(current, row.hash))) return { error: "Your current password is not correct.", fieldErrors: { current: "Not correct" } };
    const problem = passwordProblem(next);
    if (problem) return { error: problem, fieldErrors: { next: problem } };
    if (next !== confirm) return { error: "The new passwords do not match.", fieldErrors: { confirm: "Does not match" } };
    if (next === current) return { error: "Choose a password different from your current one." };

    await db
      .update(schema.users)
      .set({ passwordHash: await hashPassword(next), mustChangePassword: false })
      .where(eq(schema.users.id, user.id));
    await audit({ actorId: user.id, action: "password_changed", module: "auth", entityType: "user", entityId: user.id });
  } catch (error) {
    return failure(error);
  }
  if (forced) redirect(homeFor(permissions));
  return { ok: true, message: "Password updated." };
}

export async function updateOwnName(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize();
    const name = formString(formData, "name");
    if (name.length < 2 || name.length > 120) return { error: "Enter your full name." };
    await db.update(schema.users).set({ name }).where(eq(schema.users.id, user.id));
    await audit({ actorId: user.id, action: "profile_updated", module: "users", entityType: "user", entityId: user.id, before: { name: user.name }, after: { name } });
    return { ok: true, message: "Name updated." };
  } catch (error) {
    return failure(error);
  }
}
