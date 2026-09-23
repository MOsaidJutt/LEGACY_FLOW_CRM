import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { agentUsers } from "@/lib/metrics";
import { leadTimeline } from "@/lib/leads/calls";
import { formatPhone } from "@/lib/phone";
import { formatDateTime, formatDuration } from "@/lib/time";
import { LEAD_STATUS } from "@/lib/leads/status";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge, toneOf } from "@/components/ui/badge";
import { LeadActions } from "./lead-actions";

export const metadata: Metadata = { title: "Lead" };

const ASSIGNMENT_LABEL: Record<string, string> = {
  assigned: "Assigned",
  released: "Released to pool",
  transferred: "Transferred",
  returned_on_logout: "Returned at logout",
  returned_on_timeout: "Returned at session timeout",
};

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("leads.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { leads, leadSources, users, leadAssignments, calls, dispositions, dncNumbers, leadFields } = schema;
  const assignee = alias(users, "assignee");
  const actor = alias(users, "actor");

  const [row] = await db
    .select({ lead: leads, source: leadSources.name, assignee: assignee.name })
    .from(leads)
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .leftJoin(assignee, eq(assignee.id, leads.assignedTo))
    .where(eq(leads.id, id));
  if (!row) notFound();
  const lead = row.lead;
  const tz = (await getSettings()).businessTimezone;
  const canListen = user.permissions.includes("calls.recordings");

  const [history, callRows, timeline, agents, dnc, fields] = await Promise.all([
    db
      .select({ id: leadAssignments.id, action: leadAssignments.action, createdAt: leadAssignments.createdAt, agent: users.name, actor: actor.name, note: leadAssignments.note })
      .from(leadAssignments)
      .leftJoin(users, eq(users.id, leadAssignments.userId))
      .leftJoin(actor, eq(actor.id, leadAssignments.actorId))
      .where(eq(leadAssignments.leadId, id))
      .orderBy(desc(leadAssignments.createdAt))
      .limit(50),
    db
      .select({ id: calls.id, startedAt: calls.startedAt, duration: calls.durationSec, method: calls.method, notes: calls.notes, recordingUrl: calls.recordingUrl, agent: users.name, outcome: dispositions.label, tone: dispositions.tone })
      .from(calls)
      .innerJoin(users, eq(users.id, calls.agentId))
      .leftJoin(dispositions, eq(dispositions.id, calls.dispositionId))
      .where(eq(calls.leadId, id))
      .orderBy(desc(calls.startedAt))
      .limit(50),
    leadTimeline(id, 60),
    agentUsers(),
    lead.phoneE164 ? db.select().from(dncNumbers).where(eq(dncNumbers.phoneE164, lead.phoneE164)) : Promise.resolve([]),
    db.select({ key: leadFields.key, label: leadFields.label }).from(leadFields),
  ]);
  const labels = new Map(fields.map((f) => [f.key, f.label]));
  const details: [string, React.ReactNode][] = [
    ["Contact", [lead.contactName, lead.title].filter(Boolean).join(", ")],
    ["Phone", lead.phoneE164 ? <span className="font-mono">{formatPhone(lead.phoneE164)}</span> : lead.phone ? <span className="text-warning">{lead.phone} (not a valid U.S. number)</span> : null],
    ["Email", lead.email],
    ["Website", lead.website],
    ["Location", [lead.city, lead.state].filter(Boolean).join(", ")],
    ["Industry", lead.industry],
    ["Source", row.source],
    ["Added", formatDateTime(lead.createdAt, tz)],
    ["Calls", `${lead.callCount}${lead.lastCalledAt ? `, last ${formatDateTime(lead.lastCalledAt, tz)}` : ""}`],
    ...Object.entries(lead.extra ?? {}).map(([k, v]) => [labels.get(k) ?? k, v] as [string, React.ReactNode]),
  ];

  return (
    <>
      <PageHeader
        title={lead.company || lead.contactName || "Unnamed lead"}
        back={{ href: "/manage/leads", label: "Leads" }}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={LEAD_STATUS[lead.status].tone}>{LEAD_STATUS[lead.status].label}</Badge>
            {row.assignee ? <span>with {row.assignee}</span> : null}
          </span>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Details">
            <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {details.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-ink-3">{k}</dt>
                  <dd className="mt-0.5 [overflow-wrap:anywhere]">{v || <span className="text-ink-3">Not provided</span>}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Calls" flush>
            {callRows.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">Not called yet.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Agent</Th>
                    <Th>Outcome</Th>
                    <Th className="text-right">Duration</Th>
                    <Th>Notes</Th>
                    {canListen ? <Th>Recording</Th> : null}
                  </tr>
                </thead>
                <tbody>
                  {callRows.map((c) => (
                    <Tr key={c.id}>
                      <Td className="whitespace-nowrap tabular-nums">{formatDateTime(c.startedAt, tz)}</Td>
                      <Td className="whitespace-nowrap">{c.agent}</Td>
                      <Td>{c.outcome ? <Badge tone={toneOf(c.tone)}>{c.outcome}</Badge> : <span className="text-ink-3">No outcome</span>}</Td>
                      <Td className="text-right tabular-nums">{c.duration != null ? formatDuration(c.duration) : ""}</Td>
                      <Td className="max-w-[28rem] whitespace-pre-wrap text-ink-2">{c.notes}</Td>
                      {canListen ? (
                        <Td>
                          {c.recordingUrl ? (
                            <audio controls preload="none" src={c.recordingUrl} className="h-8 w-56" />
                          ) : (
                            <span className="text-xs text-ink-3">{c.method === "dialer" ? "Not provided yet" : "Not available"}</span>
                          )}
                        </Td>
                      ) : null}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>

          <Panel title="Timeline" flush>
            <ol className="divide-y divide-line">
              {timeline.map((t) => (
                <li key={t.id} className="flex gap-4 px-4 py-2.5 text-sm">
                  <span className="w-28 shrink-0 tabular-nums text-ink-3">{formatDateTime(t.createdAt, tz)}</span>
                  <div className="min-w-0">
                    <p>
                      {t.summary}
                      {t.userName ? <span className="text-ink-3"> · {t.userName}</span> : null}
                    </p>
                    {typeof t.data?.notes === "string" ? <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{t.data.notes}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-5 xl:sticky xl:top-6">
          <Panel title="Actions">
            <LeadActions
              leadId={lead.id}
              status={lead.status}
              assignedTo={lead.assignedTo}
              agents={agents.map((a) => ({ id: a.id, name: a.name }))}
              hasPhone={Boolean(lead.phoneE164)}
              onDncList={dnc.length > 0}
            />
          </Panel>
          <Panel title="Assignment history" flush>
            {history.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">Never assigned.</p>
            ) : (
              <ol className="divide-y divide-line">
                {history.map((h) => (
                  <li key={h.id} className="px-4 py-2.5 text-sm">
                    <p>
                      {ASSIGNMENT_LABEL[h.action] ?? h.action}
                      {h.agent && h.action !== "released" ? <span className="font-medium"> {h.action.startsWith("returned") ? "from" : "to"} {h.agent}</span> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-3">
                      {formatDateTime(h.createdAt, tz)}
                      {h.actor ? ` · by ${h.actor}` : h.action.startsWith("returned") ? " · automatic" : ""}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
