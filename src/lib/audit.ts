import "server-only";
import { headers } from "next/headers";
import { db, schema, type DB, type Tx } from "@/db";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  module: "auth" | "users" | "leads" | "imports" | "requests" | "calls" | "settings" | "hr" | "reports" | "messages";
  entityType?: string;
  entityId?: string;
  summary?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

async function requestIp() {
  try {
    const h = await headers();
    return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "").trim() || null;
  } catch {
    return null; // outside a request (cron / scripts)
  }
}

/** Append-only audit record. Pass `tx` to commit it atomically with the change it describes. */
export async function audit(entry: AuditEntry, tx: DB | Tx = db) {
  await tx.insert(schema.auditLogs).values({ ...entry, ip: await requestIp() });
}

/** Only the fields that changed, for compact before/after records. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
