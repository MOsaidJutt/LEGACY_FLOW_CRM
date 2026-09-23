import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { Inbox, Search } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { isOnDncList, leadTimeline } from "@/lib/leads/calls";
import { formatPhone } from "@/lib/phone";
import { formatDateTime, tzShortName } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { ButtonLink } from "@/components/ui/button";
import { Badge, toneOf } from "@/components/ui/badge";
import { LeadWorkspace } from "./lead-workspace";

export const metadata: Metadata = { title: "Call list" };

type View = "assigned" | "follow_up" | "all";
const VIEWS: { key: View; label: string }[] = [
  { key: "assigned", label: "Working" },
  { key: "follow_up", label: "Follow-ups" },
  { key: "all", label: "All" },
];

export default async function CallListPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePermission("leads.work");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 100) : "";
  const { leads, dispositions, callbacks } = schema;

  const counts = await db
    .select({ status: leads.status, n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.assignedTo, user.id), inArray(leads.status, ["assigned", "follow_up"])))
    .groupBy(leads.status);
  const working = counts.find((c) => c.status === "assigned")?.n ?? 0;
  const followUps = counts.find((c) => c.status === "follow_up")?.n ?? 0;

  const requested = (typeof sp.view === "string" ? sp.view : "") as View;
  const view: View = VIEWS.some((v) => v.key === requested) ? requested : working === 0 && followUps > 0 ? "follow_up" : "assigned";
  const statuses = view === "all" ? (["assigned", "follow_up"] as const) : ([view] as const);

  const like = `%${q}%`;
  const rows = await db
    .select({
      id: leads.id,
      company: leads.company,
      contactName: leads.contactName,
      city: leads.city,
      state: leads.state,
      status: leads.status,
      callCount: leads.callCount,
      dispLabel: dispositions.label,
      dispTone: dispositions.tone,
      callbackAt: sql<Date | null>`(select min(${callbacks.dueAt}) from ${callbacks} where ${callbacks.leadId} = ${leads.id} and ${callbacks.status} = 'pending')`
        .mapWith((v) => (v ? new Date(v) : null))
        .as("callback_at"),
    })
    .from(leads)
    .leftJoin(dispositions, eq(dispositions.id, leads.lastDispositionId))
    .where(
      and(
        eq(leads.assignedTo, user.id),
        inArray(leads.status, [...statuses]),
        q ? or(ilike(leads.company, like), ilike(leads.contactName, like), ilike(leads.phone, like), ilike(leads.email, like)) : undefined,
      ),
    )
    .orderBy(view === "follow_up" ? sql`callback_at asc nulls last` : asc(leads.assignedAt), asc(leads.company))
    .limit(500);

  const selectedId = typeof sp.lead === "string" && rows.some((r) => r.id === sp.lead) ? sp.lead : rows[0]?.id;
  const settings = await getSettings();
  const tz = settings.businessTimezone;

  const hrefFor = (params: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ view, q: q || undefined, ...params })) if (v) u.set(k, v);
    return `/agent/calls?${u.toString()}`;
  };

  let workspace: React.ReactNode = null;
  if (selectedId) {
    const [lead] = await db
      .select({ lead: leads, sourceName: schema.leadSources.name })
      .from(leads)
      .leftJoin(schema.leadSources, eq(schema.leadSources.id, leads.sourceId))
      .where(eq(leads.id, selectedId));
    const [dispRows, fieldRows, timeline, dnc, pendingCallback] = await Promise.all([
      db.select().from(dispositions).where(eq(dispositions.active, true)).orderBy(asc(dispositions.sortOrder)),
      db.select({ key: schema.leadFields.key, label: schema.leadFields.label }).from(schema.leadFields).where(eq(schema.leadFields.isCore, false)),
      leadTimeline(selectedId),
      isOnDncList(lead.lead.phoneE164),
      db
        .select({ dueAt: callbacks.dueAt, note: callbacks.note })
        .from(callbacks)
        .where(and(eq(callbacks.leadId, selectedId), eq(callbacks.status, "pending")))
        .limit(1),
    ]);
    const idx = rows.findIndex((r) => r.id === selectedId);
    const nextLeadId = rows[idx + 1]?.id ?? (rows.length > 1 ? rows[0].id : "");
    const labels = new Map(fieldRows.map((f) => [f.key, f.label]));
    const l = lead.lead;

    workspace = (
      <LeadWorkspace
        key={l.id}
        view={view}
        nextLeadId={nextLeadId}
        tzLabel={tzShortName(tz)}
        tz={tz}
        lead={{
          id: l.id,
          company: l.company,
          contactName: l.contactName,
          title: l.title,
          phone: l.phoneE164 ? formatPhone(l.phoneE164) : l.phone,
          hasValidPhone: Boolean(l.phoneE164),
          email: l.email,
          website: l.website,
          city: l.city,
          state: l.state,
          industry: l.industry,
          source: lead.sourceName,
          status: l.status,
          callCount: l.callCount,
          lastCalledAt: l.lastCalledAt ? formatDateTime(l.lastCalledAt, tz) : null,
          extra: Object.entries(l.extra ?? {})
            .filter(([, v]) => v)
            .map(([k, v]) => ({ label: labels.get(k) ?? k, value: v })),
        }}
        dnc={dnc}
        pendingCallback={pendingCallback[0] ? { dueAt: formatDateTime(pendingCallback[0].dueAt, tz), note: pendingCallback[0].note } : null}
        dispositions={dispRows.map((d) => ({ id: d.id, key: d.key, label: d.label, description: d.description, tone: d.tone, requiresCallback: d.requiresCallback }))}
        timeline={timeline.map((t) => ({
          id: t.id,
          type: t.type,
          summary: t.summary,
          notes: typeof t.data?.notes === "string" ? t.data.notes : null,
          at: formatDateTime(t.createdAt, tz),
          by: t.userName,
        }))}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Call list"
        description={`${working} working ${working === 1 ? "lead" : "leads"} · ${followUps} ${followUps === 1 ? "follow-up" : "follow-ups"}`}
        actions={<ButtonLink href="/agent/request" variant="secondary">Request leads</ButtonLink>}
      />

      {working + followUps === 0 ? (
        <div className="rounded-lg border border-line bg-raised">
          <EmptyState icon={Inbox} title="Your call list is empty" action={<ButtonLink href="/agent/request" variant="primary">Request leads</ButtonLink>}>
            Request a batch of leads. Management approves it, or it is assigned automatically after {settings.autoAssignMinutes} minutes.
          </EmptyState>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)]">
          <section className="overflow-hidden rounded-lg border border-line bg-raised lg:sticky lg:top-6">
            <div className="flex gap-1 border-b border-line p-1.5" role="tablist" aria-label="Lead lists">
              {VIEWS.map((v) => {
                const n = v.key === "assigned" ? working : v.key === "follow_up" ? followUps : working + followUps;
                const active = v.key === view;
                return (
                  <Link
                    key={v.key}
                    role="tab"
                    aria-selected={active}
                    href={`/agent/calls?view=${v.key}`}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] transition-colors",
                      active ? "bg-selected font-medium text-ink" : "text-ink-3 hover:bg-hover hover:text-ink",
                    )}
                  >
                    {v.label}
                    <span className="tabular-nums text-ink-3">{n}</span>
                  </Link>
                );
              })}
            </div>
            <form action="/agent/calls" className="relative border-b border-line p-2">
              <input type="hidden" name="view" value={view} />
              <Search className="pointer-events-none absolute left-4.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search company, contact, phone"
                aria-label="Search your leads"
                className="h-8 w-full rounded-md bg-transparent pl-8 pr-2 text-sm text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-0"
              />
            </form>
            <ul className="max-h-[calc(100dvh-15rem)] overflow-y-auto">
              {rows.length === 0 ? <li className="px-4 py-8 text-center text-sm text-ink-3">No leads match “{q}”.</li> : null}
              {rows.map((r) => {
                const active = r.id === selectedId;
                return (
                  <li key={r.id}>
                    <Link
                      href={hrefFor({ lead: r.id })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className={cn("block border-b border-line px-4 py-2.5 transition-colors", active ? "bg-selected" : "hover:bg-hover/60")}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{r.company || r.contactName || "Unnamed lead"}</span>
                        {r.dispLabel ? (
                          <Badge tone={toneOf(r.dispTone)} className="shrink-0">
                            {r.dispLabel}
                          </Badge>
                        ) : (
                          <span className="shrink-0 text-xs text-ink-3">New</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex justify-between gap-2 text-[13px] text-ink-3">
                        <span className="truncate">
                          {[r.contactName, [r.city, r.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
                        </span>
                        {r.callbackAt ? <span className="shrink-0 tabular-nums">{formatDateTime(r.callbackAt, tz)}</span> : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <div className="min-w-0">{workspace}</div>
        </div>
      )}
    </>
  );
}
