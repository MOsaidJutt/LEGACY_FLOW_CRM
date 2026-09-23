import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { CalendarClock } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { dayRange, formatDateTime, relativeTime, tzShortName } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Callbacks" };

const TABS = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "done", label: "Completed" },
] as const;
type Tab = (typeof TABS)[number]["key"];

export default async function CallbacksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("leads.work");
  const sp = await searchParams;
  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const now = new Date();
  const { end: endOfToday } = dayRange(tz);
  const { callbacks, leads } = schema;

  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "today";
  const mine = eq(callbacks.agentId, user.id);
  const pending = eq(callbacks.status, "pending");
  const where = {
    overdue: and(mine, pending, lt(callbacks.dueAt, now)),
    today: and(mine, pending, gte(callbacks.dueAt, now), lt(callbacks.dueAt, endOfToday)),
    upcoming: and(mine, pending, gte(callbacks.dueAt, endOfToday)),
    done: and(mine, eq(callbacks.status, "done")),
  }[tab];

  const rows = await db
    .select({
      id: callbacks.id,
      dueAt: callbacks.dueAt,
      note: callbacks.note,
      completedAt: callbacks.completedAt,
      leadId: leads.id,
      company: leads.company,
      contact: leads.contactName,
      leadStatus: leads.status,
      assignedTo: leads.assignedTo,
    })
    .from(callbacks)
    .innerJoin(leads, eq(leads.id, callbacks.leadId))
    .where(where)
    .orderBy(tab === "done" ? desc(callbacks.completedAt) : asc(callbacks.dueAt))
    .limit(200);

  return (
    <>
      <PageHeader title="Callbacks" description={`Times are shown in ${tzShortName(tz)}. Saving any outcome on the lead completes its callback.`} />
      <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/agent/callbacks?tab=${t.key}`}
            role="tab"
            aria-selected={t.key === tab}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              t.key === tab ? "border-ink font-medium text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <section className="rounded-lg border border-line bg-raised">
        {rows.length === 0 ? (
          <EmptyState icon={CalendarClock} title={tab === "overdue" ? "Nothing overdue" : tab === "done" ? "No completed callbacks yet" : "No callbacks here"}>
            Callbacks come from the Call Back Later outcome on your call list.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{tab === "done" ? "Completed" : "Due"}</Th>
                <Th>Lead</Th>
                <Th>Note</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const canOpen = r.assignedTo === user.id && (r.leadStatus === "follow_up" || r.leadStatus === "assigned");
                return (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatDateTime(tab === "done" ? r.completedAt : r.dueAt, tz)}
                      {tab === "overdue" ? (
                        <Badge tone="warning" className="ml-2">
                          {relativeTime(r.dueAt, now)}
                        </Badge>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="font-medium">{r.company || r.contact}</span>
                      {r.company && r.contact ? <span className="text-ink-3"> · {r.contact}</span> : null}
                    </Td>
                    <Td className="max-w-[40ch] truncate text-ink-2">{r.note}</Td>
                    <Td className="text-right">
                      {canOpen && tab !== "done" ? (
                        <Link href={`/agent/calls?view=follow_up&lead=${r.leadId}`} className="text-sm font-medium text-ink underline-offset-4 hover:underline">
                          Open lead
                        </Link>
                      ) : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </>
  );
}
