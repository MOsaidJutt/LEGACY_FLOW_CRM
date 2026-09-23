import "server-only";
import { schema, type DB, type Tx } from "@/db";

export type ActivityEvent = {
  userId: string;
  sessionId?: string | null;
  type: string;
  summary?: string;
  meta?: Record<string, unknown>;
  source?: "web" | "desktop" | "system";
};

/** Chronological agent activity (login, lead requests, calls, breaks, idle...). */
export async function recordEvent(tx: DB | Tx, event: ActivityEvent) {
  await tx.insert(schema.activityEvents).values({
    userId: event.userId,
    sessionId: event.sessionId ?? null,
    type: event.type,
    summary: event.summary ?? null,
    meta: event.meta ?? {},
    source: event.source ?? "web",
  });
}
