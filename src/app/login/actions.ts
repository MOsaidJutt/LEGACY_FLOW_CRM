"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { startSession } from "@/lib/auth/session";
import { homeFor } from "@/lib/auth/permissions";
import { audit } from "@/lib/audit";
import { recordEvent } from "@/lib/monitoring/events";
import { recordHeartbeat } from "@/lib/monitoring/presence";

export type SignInState = { error?: string; email?: string } | null;

const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 15 * 60_000;

// Compared against when the email is unknown, so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;

function safeNext(next: string) {
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : null;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!email || !password) return { error: "Enter your email and password.", email };

  const [{ failures }] = await db
    .select({ failures: sql<number>`count(*)::int` })
    .from(schema.auditLogs)
    .where(
      and(
        eq(schema.auditLogs.action, "login_failed"),
        eq(schema.auditLogs.entityId, email),
        gt(schema.auditLogs.createdAt, new Date(Date.now() - FAILURE_WINDOW_MS)),
      ),
    );
  if (failures >= MAX_FAILURES) {
    return { error: "Too many attempts. Wait 15 minutes, or ask an admin to reset your password.", email };
  }

  const [user] = await db
    .select({
      id: schema.users.id,
      passwordHash: schema.users.passwordHash,
      status: schema.users.status,
      permissions: schema.roles.permissions,
    })
    .from(schema.users)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(eq(schema.users.email, email))
    .limit(1);

  const valid = await verifyPassword(password, user?.passwordHash ?? (await (dummyHash ??= hashPassword("placeholder-0"))));
  if (!user || !valid) {
    await audit({ actorId: null, action: "login_failed", module: "auth", entityType: "user", entityId: email });
    return { error: "That email and password do not match.", email };
  }
  if (user.status !== "active") return { error: "This account is deactivated. Contact your admin.", email };

  const sessionId = await startSession(user.id);
  const now = new Date();
  await db.update(schema.users).set({ lastLoginAt: now }).where(eq(schema.users.id, user.id));
  await recordEvent(db, { userId: user.id, sessionId, type: "login", summary: "Logged in" });
  await recordHeartbeat({ userId: user.id, sessionId, source: "web", lastActivityAt: now });
  await audit({ actorId: user.id, action: "login", module: "auth", entityType: "user", entityId: user.id });

  redirect(next ?? homeFor(user.permissions));
}
