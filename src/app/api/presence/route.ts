import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { recordHeartbeat } from "@/lib/monitoring/presence";
import { processExpiredRequests } from "@/lib/leads/assignment";
import { unreadMessageCount } from "@/lib/messages";

/**
 * Browser heartbeat (every 30 s while the app is open). Keeps the session alive,
 * drives active / idle time, and piggybacks the 5-minute auto-assignment so it
 * fires on time even between cron runs.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ signedIn: false }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { lastActivityAt?: unknown };
  const lastActivityAt = typeof body.lastActivityAt === "number" && Number.isFinite(body.lastActivityAt) ? new Date(body.lastActivityAt) : new Date();

  const presence = await recordHeartbeat({ userId: user.id, sessionId: user.sessionId, source: "web", lastActivityAt });
  await processExpiredRequests().catch((error) => console.error("[presence] auto-assign failed", error));

  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt)));

  let requests: number | null = null;
  if (user.permissions.includes("leads.requests.decide")) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.leadRequests)
      .where(eq(schema.leadRequests.status, "pending"));
    requests = row.n;
  }

  const messages = user.permissions.includes("messages.use") ? await unreadMessageCount(user.id) : 0;
  return Response.json({ signedIn: true, state: presence.state, breakType: presence.breakType, notifications: unread, messages, requests });
}
