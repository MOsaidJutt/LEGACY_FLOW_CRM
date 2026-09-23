import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { SESSION_COOKIE } from "./constants";
import { homeFor, type Permission } from "./permissions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
  sessionId: string;
  mustChangePassword: boolean;
};

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function clientIp() {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
}

/** Creates a session row and sets the httpOnly cookie. Call from a server action only. */
export async function startSession(userId: string) {
  const settings = await getSettings();
  const h = await headers();
  const token = randomBytes(32).toString("base64url");
  const id = hashToken(token);
  const expiresAt = new Date(Date.now() + settings.sessionMaxHours * 3_600_000);

  await db.insert(schema.sessions).values({
    id,
    userId,
    expiresAt,
    ip: await clientIp(),
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return id;
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentSessionId() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashToken(token) : null;
}

/** The signed-in user for this request, or null. Deduplicated per render. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const sessionId = await currentSessionId();
  if (!sessionId) return null;

  const [row] = await db
    .select({
      sessionId: schema.sessions.id,
      endedAt: schema.sessions.endedAt,
      expiresAt: schema.sessions.expiresAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      status: schema.users.status,
      mustChangePassword: schema.users.mustChangePassword,
      roleKey: schema.roles.key,
      roleName: schema.roles.name,
      permissions: schema.roles.permissions,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!row || row.endedAt || row.status !== "active") return null;

  const now = Date.now();
  if (row.expiresAt.getTime() <= now) return null;
  const settings = await getSettings();
  if (now - row.lastSeenAt.getTime() > settings.sessionIdleMinutes * 60_000) return null;

  // sliding activity marker, written at most once a minute
  if (now - row.lastSeenAt.getTime() > 60_000) {
    await db.update(schema.sessions).set({ lastSeenAt: new Date(now) }).where(eq(schema.sessions.id, sessionId));
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleKey: row.roleKey,
    roleName: row.roleName,
    permissions: row.permissions,
    sessionId: row.sessionId,
    mustChangePassword: row.mustChangePassword,
  };
});

export function can(user: Pick<CurrentUser, "permissions"> | null, permission: Permission) {
  return Boolean(user?.permissions.includes(permission));
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: users without the permission are sent to their own home screen. */
export async function requirePermission(...anyOf: Permission[]) {
  const user = await requireUser();
  if (!anyOf.some((p) => user.permissions.includes(p))) redirect(homeFor(user.permissions));
  return user;
}
