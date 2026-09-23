import { timingSafeEqual } from "node:crypto";
import { processExpiredRequests } from "@/lib/leads/assignment";
import { processCallbackReminders } from "@/lib/leads/callbacks";
import { sweepPresence } from "@/lib/monitoring/presence";
import { sweepSessions } from "@/lib/auth/lifecycle";

/**
 * Background work, called every minute by BOTH production hosts:
 *   VPS:    * * * * *  curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/tick
 *   second platform: its scheduler, same URL and header
 * Every job is idempotent and uses row locks, so overlapping runs are harmless.
 */
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = Date.now();
  const result: Record<string, number | string> = {};
  const jobs: [string, () => Promise<number>][] = [
    ["autoAssigned", processExpiredRequests],
    ["callbackReminders", processCallbackReminders],
    ["presenceOffline", sweepPresence],
    ["sessionsEnded", sweepSessions],
  ];
  for (const [name, job] of jobs) {
    try {
      result[name] = await job();
    } catch (error) {
      console.error(`[cron] ${name} failed`, error);
      result[name] = "failed";
    }
  }
  return Response.json({ ok: true, ms: Date.now() - started, ...result });
}

export const GET = run;
export const POST = run;
