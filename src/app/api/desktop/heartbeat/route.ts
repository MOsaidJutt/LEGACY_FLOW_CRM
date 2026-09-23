import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordHeartbeat } from "@/lib/monitoring/presence";

/**
 * TM-02: heartbeat from the Windows desktop agent (every 30 s).
 * Body: { idleSeconds: number, app?: string }  Header: Authorization: Bearer <device token>
 * Workstation activity keeps Active Time running while the agent works outside the
 * CRM tab (e.g. in VC Dialer); it never signs anyone in to the CRM by itself.
 */
export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token.startsWith("lfd_")) return Response.json({ error: "unauthorized" }, { status: 401 });
  const hash = createHash("sha256").update(token).digest("hex");
  const [device] = await db
    .select()
    .from(schema.desktopDevices)
    .where(and(eq(schema.desktopDevices.tokenHash, hash), isNull(schema.desktopDevices.revokedAt)));
  if (!device?.userId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { idleSeconds?: unknown; app?: unknown };
  const idle = typeof body.idleSeconds === "number" && body.idleSeconds >= 0 && body.idleSeconds < 7 * 86_400 ? body.idleSeconds : null;
  if (idle === null) return Response.json({ error: "idleSeconds is required" }, { status: 400 });
  const app = typeof body.app === "string" ? body.app.replace(/[^\w .\-()]/g, "").slice(0, 120) || null : null;

  const presence = await recordHeartbeat({ userId: device.userId, sessionId: null, source: "desktop", lastActivityAt: new Date(Date.now() - idle * 1000), app });
  await db.update(schema.desktopDevices).set({ lastSeenAt: new Date() }).where(eq(schema.desktopDevices.id, device.id));
  return Response.json({ ok: true, state: presence.state });
}
