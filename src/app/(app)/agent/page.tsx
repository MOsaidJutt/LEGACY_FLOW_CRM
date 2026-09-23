import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { CalendarClock, PhoneCall } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { dayRange, formatDate, formatTime, relativeTime, tzShortName } from "@/lib/time";
import { PageHeader, Panel, StatRow, EmptyState } from "@/components/ui/layout";
import { ButtonLink } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Dashboard" };

export default async function AgentDashboard() {
  const user = await requirePermission("leads.work");
  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const { start, end } = dayRange(tz);
  const { leads, calls, dispositions, callbacks } = schema;

  const [outcomeRows, listRows, dueCallbacks, notes] = await Promise.all([
    db
      .select({ key: dispositions.key, n: sql<number>`count(*)::int` })
      .from(calls)
      .leftJoin(dispositions, eq(dispositions.id, calls.dispositionId))
      .where(and(eq(calls.agentId, user.id), gte(calls.startedAt, start), lt(calls.startedAt, end)))
      .groupBy(dispositions.key),
    db
      .select({ status: leads.status, n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.assignedTo, user.id), inArray(leads.status, ["assigned", "follow_up"])))
      .groupBy(leads.status),
    db
      .select({ id: callbacks.id, dueAt: callbacks.dueAt, note: callbacks.note, leadId: leads.id, company: leads.company, contact: leads.contactName })
      .from(callbacks)
      .innerJoin(leads, eq(leads.id, callbacks.leadId))
      .where(and(eq(callbacks.agentId, user.id), eq(callbacks.status, "pending"), lt(callbacks.dueAt, end)))
      .orderBy(asc(callbacks.dueAt))
      .limit(8),
    db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user.id))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(5),
  ]);

  const by = (k: string) => outcomeRows.find((r) => r.key === k)?.n ?? 0;
  const callsToday = outcomeRows.reduce((s, r) => s + r.n, 0);
  const pendingOutcome = outcomeRows.find((r) => r.key === null)?.n ?? 0;
  const answered = callsToday - by("no_answer") - pendingOutcome;
  const working = listRows.find((r) => r.status === "assigned")?.n ?? 0;
  const followUps = listRows.find((r) => r.status === "follow_up")?.n ?? 0;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Today"
        description={`${formatDate(now, tz, true)} · ${tzShortName(tz)}`}
        actions={
          <>
            <ButtonLink href="/agent/request">Request leads</ButtonLink>
            <ButtonLink href="/agent/calls" variant="primary">
              <PhoneCall aria-hidden /> Open call list
            </ButtonLink>
          </>
        }
      />

      <div className="flex flex-col gap-5">
        <StatRow
          items={[
            { label: "In your list", value: working, hint: `${followUps} follow-ups`, href: "/agent/calls" },
            { label: "Calls made", value: callsToday },
            { label: "Answered", value: Math.max(0, answered) },
            { label: "No answer", value: by("no_answer") },
            { label: "Qualified", value: by("qualified") },
          ]}
        />
        <StatRow
          items={[
            { label: "Callbacks set", value: by("callback") },
            { label: "Email", value: by("email") },
            { label: "Not interested", value: by("not_interested") },
            { label: "Do not call", value: by("dnc") },
            { label: "Callbacks due today", value: dueCallbacks.length, href: "/agent/callbacks" },
          ]}
        />

        <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
          <Panel title="Callbacks due" actions={<ButtonLink href="/agent/callbacks" size="sm" variant="ghost">All callbacks</ButtonLink>} flush>
            {dueCallbacks.length === 0 ? (
              <EmptyState icon={CalendarClock} title="No callbacks due today">
                When you choose Call Back Later, the callback shows up here and you get a reminder five minutes before it.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-line">
                {dueCallbacks.map((cb) => {
                  const overdue = cb.dueAt < now;
                  return (
                    <li key={cb.id}>
                      <Link href={`/agent/calls?view=follow_up&lead=${cb.leadId}`} className="flex items-center gap-4 px-4 py-3 hover:bg-hover/50">
                        <span className="w-20 shrink-0 text-sm tabular-nums text-ink">{formatTime(cb.dueAt, tz)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{cb.company || cb.contact}</span>
                          {cb.note ? <span className="block truncate text-[13px] text-ink-3">{cb.note}</span> : null}
                        </span>
                        {overdue ? <Badge tone="warning">Overdue</Badge> : <span className="text-xs text-ink-3">{relativeTime(cb.dueAt, now)}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Recent notifications" actions={<ButtonLink href="/notifications" size="sm" variant="ghost">View all</ButtonLink>} flush>
            {notes.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-ink-3">Lead assignments, callback reminders and messages from Management appear here.</p>
            ) : (
              <ul className="divide-y divide-line">
                {notes.map((n) => (
                  <li key={n.id} className="px-4 py-3">
                    <Link href={n.link ?? "/notifications"} className="block">
                      <p className="text-sm text-ink">
                        {!n.readAt ? <span className="mr-1.5 inline-block size-1.5 -translate-y-0.5 rounded-full bg-accent align-middle" aria-label="Unread" /> : null}
                        {n.title}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-3">{relativeTime(n.createdAt, now)}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
