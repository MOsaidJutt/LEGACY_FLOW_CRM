import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { agentUsers } from "@/lib/metrics";
import { formatPhone } from "@/lib/phone";
import { dateSpan, formatDateTime } from "@/lib/time";
import { PageHeader } from "@/components/ui/layout";
import { Input, Select } from "@/components/ui/input";
import { Button, ButtonLink } from "@/components/ui/button";
import { LEAD_STATUS } from "@/lib/leads/status";
import { LeadsTable } from "./leads-table";

export const metadata: Metadata = { title: "Leads" };
const PAGE = 50;

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("leads.manage");
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const f = { q: get("q").slice(0, 100), status: get("status"), agent: get("agent"), source: get("source"), import: get("import"), from: get("from"), to: get("to") };
  const page = Math.max(1, Number(get("page")) || 1);
  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const { leads, leadSources, dispositions, users } = schema;
  const assignee = alias(users, "assignee");

  const conds: (SQL | undefined)[] = [];
  if (f.q) {
    const like = `%${f.q}%`;
    const digits = f.q.replace(/\D/g, "");
    conds.push(
      or(
        ilike(leads.company, like),
        ilike(leads.contactName, like),
        ilike(leads.email, like),
        ilike(leads.website, like),
        ilike(leads.city, like),
        ilike(leads.industry, like),
        ilike(leads.phone, like),
        digits.length >= 4 ? ilike(leads.phoneE164, `%${digits}%`) : undefined,
        sql`${leads.extra}::text ilike ${like}`,
      ),
    );
  }
  if (f.status && f.status in LEAD_STATUS) conds.push(eq(leads.status, f.status as (typeof schema.leadStatus.enumValues)[number]));
  if (/^[0-9a-f-]{36}$/i.test(f.agent)) conds.push(eq(leads.assignedTo, f.agent));
  if (f.agent === "none") conds.push(sql`${leads.assignedTo} is null`);
  if (/^[0-9a-f-]{36}$/i.test(f.source)) conds.push(eq(leads.sourceId, f.source));
  if (/^[0-9a-f-]{36}$/i.test(f.import)) conds.push(eq(leads.importId, f.import));
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(leads.createdAt, dateSpan(tz, f.from, f.from).start));
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lt(leads.createdAt, dateSpan(tz, f.to, f.to).end));
  const where = and(...conds);

  const [rows, [{ total }], agents, sources] = await Promise.all([
    db
      .select({
        id: leads.id,
        company: leads.company,
        contactName: leads.contactName,
        phone: leads.phone,
        phoneE164: leads.phoneE164,
        city: leads.city,
        state: leads.state,
        status: leads.status,
        lastCalledAt: leads.lastCalledAt,
        source: leadSources.name,
        outcome: dispositions.label,
        outcomeTone: dispositions.tone,
        assignee: assignee.name,
      })
      .from(leads)
      .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
      .leftJoin(dispositions, eq(dispositions.id, leads.lastDispositionId))
      .leftJoin(assignee, eq(assignee.id, leads.assignedTo))
      .where(where)
      .orderBy(desc(leads.createdAt), asc(leads.company))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(leads).where(where),
    agentUsers(),
    db.select({ id: leadSources.id, name: leadSources.name }).from(leadSources).orderBy(asc(leadSources.name)),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (params: Record<string, string | number>) =>
    `/manage/leads?${new URLSearchParams(Object.entries({ ...f, page: String(page), ...params }).filter(([, v]) => v !== "" && v !== undefined).map(([k, v]) => [k, String(v)]))}`;
  const filtered = Object.values(f).some(Boolean);

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${total.toLocaleString()} ${filtered ? "matching" : ""} leads. Select leads to assign, transfer or release them.`}
        actions={<ButtonLink href="/manage/imports/new">Import leads</ButtonLink>}
      />

      <form action="/manage/leads" className="mb-4 flex flex-wrap items-end gap-2">
        {f.import ? <input type="hidden" name="import" value={f.import} /> : null}
        <Input name="q" defaultValue={f.q} placeholder="Search any field" aria-label="Search leads" className="w-64" />
        <Select name="status" defaultValue={f.status} aria-label="Status" className="w-36">
          <option value="">Any status</option>
          {Object.entries(LEAD_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </Select>
        <Select name="agent" defaultValue={f.agent} aria-label="Agent" className="w-40">
          <option value="">Any agent</option>
          <option value="none">Unassigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <Select name="source" defaultValue={f.source} aria-label="Source" className="w-48">
          <option value="">Any source</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-[13px] text-ink-3">
          Added
          <Input type="date" name="from" defaultValue={f.from} aria-label="Added from" className="w-36" />
          to
          <Input type="date" name="to" defaultValue={f.to} aria-label="Added to" className="w-36" />
        </label>
        <Button type="submit">Filter</Button>
        {filtered ? (
          <Link href="/manage/leads" className="px-2 text-sm text-ink-3 hover:text-ink">
            Clear
          </Link>
        ) : null}
      </form>

      {f.import ? (
        <p className="mb-3 text-sm text-ink-3">
          Showing leads from one import.{" "}
          <Link href={`/manage/imports/${f.import}`} className="text-ink underline-offset-4 hover:underline">
            Back to the import
          </Link>
        </p>
      ) : null}

      <LeadsTable
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        rows={rows.map((r) => ({
          id: r.id,
          company: r.company,
          contactName: r.contactName,
          phone: r.phoneE164 ? formatPhone(r.phoneE164) : r.phone,
          validPhone: Boolean(r.phoneE164),
          location: [r.city, r.state].filter(Boolean).join(", "),
          source: r.source,
          status: r.status,
          assignee: r.assignee,
          outcome: r.outcome,
          outcomeTone: r.outcomeTone,
          lastCalled: r.lastCalledAt ? formatDateTime(r.lastCalledAt, tz) : null,
        }))}
      />

      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-[13px] text-ink-3">
          <span className="tabular-nums">
            {(page - 1) * PAGE + 1} to {Math.min(page * PAGE, total)} of {total.toLocaleString()}
          </span>
          <span className="flex gap-3">
            {page > 1 ? (
              <Link href={qs({ page: page - 1 })} className="text-ink hover:underline">
                Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={qs({ page: page + 1 })} className="text-ink hover:underline">
                Next
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
    </>
  );
}
