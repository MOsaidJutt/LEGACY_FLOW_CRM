import { timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * VC Dialer call-results webhook (slot for the integration).
 *
 * Authenticated with `Authorization: Bearer <DIALER_WEBHOOK_SECRET>`. Until the
 * VC Dialer payload format is known, it accepts a generic shape and matches the
 * call by the id VC Dialer returned when the call was placed:
 *   { callId | id, durationSec | duration, recordingUrl | recording_url, endedAt }
 * Adjust `readPayload` once VC Dialer's documentation is available.
 */
function authorized(request: Request) {
  const secret = process.env.DIALER_WEBHOOK_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function readPayload(body: Record<string, unknown>) {
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
  const recording = str(body.recordingUrl) ?? str(body.recording_url);
  return {
    externalId: str(body.callId) ?? str(body.call_id) ?? str(body.id),
    durationSec: num(body.durationSec) ?? num(body.duration),
    recordingUrl: recording && /^https:\/\//i.test(recording) ? recording : null,
    endedAt: str(body.endedAt) ? new Date(str(body.endedAt)!) : null,
  };
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid JSON" }, { status: 400 });

  const p = readPayload(body);
  if (!p.externalId) return Response.json({ error: "no call id" }, { status: 422 });

  const set: Partial<typeof schema.calls.$inferInsert> = {};
  if (p.durationSec !== null) set.durationSec = p.durationSec;
  if (p.recordingUrl) set.recordingUrl = p.recordingUrl;
  if (p.endedAt && !Number.isNaN(p.endedAt.getTime())) set.endedAt = p.endedAt;
  if (!Object.keys(set).length) return Response.json({ ok: true, updated: 0 });

  const updated = await db.update(schema.calls).set(set).where(eq(schema.calls.externalId, p.externalId)).returning({ id: schema.calls.id });
  return Response.json({ ok: true, updated: updated.length });
}
