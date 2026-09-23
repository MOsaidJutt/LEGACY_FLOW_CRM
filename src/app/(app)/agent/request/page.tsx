import type { Metadata } from "next";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { processExpiredRequests } from "@/lib/leads/assignment";
import { formatDateTime } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { REQUEST_STATUS as STATUS } from "@/lib/leads/request-status";
import { PendingRequest, RequestForm } from "./request-form";

export const metadata: Metadata = { title: "Request leads" };

export default async function RequestLeadsPage() {
  const user = await requirePermission("leads.request");
  await processExpiredRequests();
  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const { leadRequests, leads } = schema;

  const [history, [list]] = await Promise.all([
    db.select().from(leadRequests).where(eq(leadRequests.agentId, user.id)).orderBy(desc(leadRequests.createdAt)).limit(15),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.assignedTo, user.id), inArray(leads.status, ["assigned", "follow_up"]))),
  ]);
  const pending = history.find((r) => r.status === "pending");

  return (
    <>
      <PageHeader
        title="Request leads"
        description={`Management approves each request. If nobody responds within ${settings.autoAssignMinutes} minutes, the leads are assigned to you automatically.`}
      />
      {pending ? <AutoRefresh everyMs={8_000} /> : null}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,26rem)_1fr]">
        <Panel title="New request" description={`You have ${list.n} ${list.n === 1 ? "lead" : "leads"} in your list right now.`}>
          {pending ? (
            <PendingRequest
              id={pending.id}
              qty={pending.requestedQty}
              createdAt={pending.createdAt.toISOString()}
              expiresAt={pending.expiresAt.toISOString()}
            />
          ) : (
            <RequestForm presets={settings.leadPresets} max={settings.maxLeadRequest} />
          )}
        </Panel>

        <Panel title="Your recent requests" flush>
          {history.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">Your requests and their results will be listed here.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Requested</Th>
                  <Th className="text-right">Asked</Th>
                  <Th className="text-right">Assigned</Th>
                  <Th>Status</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap tabular-nums">{formatDateTime(r.createdAt, tz)}</Td>
                    <Td className="text-right tabular-nums">{r.requestedQty}</Td>
                    <Td className="text-right tabular-nums">{r.status === "pending" ? "" : r.assignedQty}</Td>
                    <Td>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </Td>
                    <Td className="max-w-[36ch] truncate text-ink-3">{r.note}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Panel>
      </div>
    </>
  );
}
