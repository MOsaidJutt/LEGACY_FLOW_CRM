import type { Metadata } from "next";
import { asc, desc, eq, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Inbox } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { poolCount, processExpiredRequests } from "@/lib/leads/assignment";
import { formatDateTime } from "@/lib/time";
import { PageHeader, Panel, EmptyState } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AutoRefresh } from "@/components/auto-refresh";
import { REQUEST_STATUS as STATUS } from "@/lib/leads/request-status";
import { RequestDecision } from "./request-decision";

export const metadata: Metadata = { title: "Lead requests" };

export default async function LeadRequestsPage() {
  await requirePermission("leads.requests.decide");
  await processExpiredRequests();
  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const { leadRequests, users } = schema;
  const decider = alias(users, "decider");

  const [pending, recent, pool] = await Promise.all([
    db
      .select({ id: leadRequests.id, qty: leadRequests.requestedQty, createdAt: leadRequests.createdAt, expiresAt: leadRequests.expiresAt, agent: users.name })
      .from(leadRequests)
      .innerJoin(users, eq(users.id, leadRequests.agentId))
      .where(eq(leadRequests.status, "pending"))
      .orderBy(asc(leadRequests.createdAt)),
    db
      .select({
        id: leadRequests.id,
        qty: leadRequests.requestedQty,
        approvedQty: leadRequests.approvedQty,
        assignedQty: leadRequests.assignedQty,
        status: leadRequests.status,
        note: leadRequests.note,
        createdAt: leadRequests.createdAt,
        decidedAt: leadRequests.decidedAt,
        agent: users.name,
        decidedBy: decider.name,
      })
      .from(leadRequests)
      .innerJoin(users, eq(users.id, leadRequests.agentId))
      .leftJoin(decider, eq(decider.id, leadRequests.decidedBy))
      .where(ne(leadRequests.status, "pending"))
      .orderBy(desc(leadRequests.createdAt))
      .limit(25),
    poolCount(),
  ]);

  return (
    <>
      <AutoRefresh everyMs={10_000} />
      <PageHeader
        title="Lead requests"
        description={`Decide within ${settings.autoAssignMinutes} minutes or the requested leads are assigned automatically. ${pool.toLocaleString()} callable leads are in the pool.`}
      />

      <div className="flex flex-col gap-5">
        <Panel title="Waiting for a decision" flush>
          {pending.length === 0 ? (
            <EmptyState icon={Inbox} title="No requests waiting">
              When an agent asks for leads, the request appears here with a countdown to automatic assignment.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((r) => (
                <RequestDecision
                  key={r.id}
                  id={r.id}
                  agent={r.agent}
                  qty={r.qty}
                  requestedAt={formatDateTime(r.createdAt, tz)}
                  expiresAt={r.expiresAt.toISOString()}
                  pool={pool}
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent decisions" flush>
          {recent.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">Nothing decided yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Requested</Th>
                  <Th>Agent</Th>
                  <Th className="text-right">Asked</Th>
                  <Th className="text-right">Assigned</Th>
                  <Th>Result</Th>
                  <Th>Decided by</Th>
                  <Th>Note</Th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap tabular-nums">{formatDateTime(r.createdAt, tz)}</Td>
                    <Td className="font-medium">{r.agent}</Td>
                    <Td className="text-right tabular-nums">{r.qty}</Td>
                    <Td className="text-right tabular-nums">{r.assignedQty}</Td>
                    <Td>
                      <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                    </Td>
                    <Td className="text-ink-2">{r.status === "auto_approved" ? "System" : (r.decidedBy ?? (r.status === "cancelled" ? "Agent" : ""))}</Td>
                    <Td className="max-w-[40ch] truncate text-ink-3">{r.note}</Td>
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
