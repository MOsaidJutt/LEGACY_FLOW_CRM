import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { ScrollText } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { dateSpan, formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, Td, Th, Tr } from "@/components/ui/table";

export const metadata: Metadata = { title: "Audit log" };
const PAGE = 100;
const MODULES = ["auth", "users", "leads", "imports", "requests", "calls", "settings", "hr", "reports", "messages"];

const humanize = (action: string) => action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function Changes({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  if (!keys.length) return null;
  const show = (v: unknown) => (v === null || v === undefined ? "none" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs text-ink-3 hover:text-ink">
        {keys.length} {keys.length === 1 ? "field" : "fields"}
      </summary>
      <dl className="mt-1.5 grid max-w-[36rem] grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs">
        {keys.map((k) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="break-all font-mono">
              {before && k in before ? <span className="text-danger line-through decoration-danger/60">{show(before[k])}</span> : null}
              {before && k in before && after && k in after ? " " : null}
              {after && k in after ? <span className="text-success">{show(after[k])}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("audit.view");
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const f = { user: get("user"), module: get("module"), q: get("q").slice(0, 80), from: get("from"), to: get("to") };
  const page = Math.max(1, Number(get("page")) || 1);
  const tz = (await getSettings()).businessTimezone;
  const { auditLogs, users } = schema;

  const conds: (SQL | undefined)[] = [];
  if (/^[0-9a-f-]{36}$/i.test(f.user)) conds.push(eq(auditLogs.actorId, f.user));
  if (MODULES.includes(f.module)) conds.push(eq(auditLogs.module, f.module));
  if (f.q) conds.push(or(ilike(auditLogs.action, `%${f.q.replace(/ /g, "_")}%`), ilike(auditLogs.entityId, `%${f.q}%`), ilike(auditLogs.summary, `%${f.q}%`)));
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(auditLogs.createdAt, dateSpan(tz, f.from, f.from).start));
  if (/^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lt(auditLogs.createdAt, dateSpan(tz, f.to, f.to).end));
  const where = and(...conds);

  const [rows, [{ total }], people] = await Promise.all([
    db
      .select({ log: auditLogs, actor: users.name })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(PAGE)
      .offset((page - 1) * PAGE),
    db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where),
    db.select({ id: users.id, name: users.name }).from(users).orderBy(asc(users.name)),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const qs = (p: number) => `/admin/audit?${new URLSearchParams(Object.entries({ ...f, page: String(p) }).filter(([, v]) => v))}`;

  return (
    <>
      <PageHeader title="Audit log" description="An append-only record of who did what and when: sign-ins, account and permission changes, imports, assignments, outcomes, do-not-call changes and settings." />

      <form action="/admin/audit" className="mb-4 flex flex-wrap items-end gap-2">
        <Select name="user" defaultValue={f.user} aria-label="Person" className="w-44">
          <option value="">Anyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select name="module" defaultValue={f.module} aria-label="Area" className="w-36">
          <option value="">Any area</option>
          {MODULES.map((m) => (
            <option key={m} value={m}>
              {m[0].toUpperCase() + m.slice(1)}
            </option>
          ))}
        </Select>
        <Input name="q" defaultValue={f.q} placeholder="Action or record" aria-label="Search actions" className="w-48" />
        <Input type="date" name="from" defaultValue={f.from} aria-label="From date" className="w-36" />
        <Input type="date" name="to" defaultValue={f.to} aria-label="To date" className="w-36" />
        <Button type="submit">Filter</Button>
        {Object.values(f).some(Boolean) ? (
          <Link href="/admin/audit" className="px-2 text-sm text-ink-3 hover:text-ink">
            Clear
          </Link>
        ) : null}
      </form>

      <section className="rounded-lg border border-line bg-raised">
        {rows.length === 0 ? (
          <EmptyState icon={ScrollText} title="No entries match" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>Area</Th>
                <Th>Action</Th>
                <Th>Record</Th>
                <Th>Changes</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ log, actor }) => (
                <Tr key={log.id}>
                  <Td className="whitespace-nowrap tabular-nums">{formatDateTime(log.createdAt, tz)}</Td>
                  <Td className="whitespace-nowrap">{actor ?? <span className="text-ink-3">{log.action === "login_failed" ? "Unknown" : "System"}</span>}</Td>
                  <Td className="text-ink-2">{log.module}</Td>
                  <Td>
                    {humanize(log.action)}
                    {log.summary ? <p className="text-xs text-ink-3">{log.summary}</p> : null}
                  </Td>
                  <Td className="max-w-[14rem] truncate font-mono text-xs text-ink-3" title={log.entityId ?? undefined}>
                    {log.entityType ? `${log.entityType}: ` : ""}
                    {log.entityId}
                  </Td>
                  <Td>
                    <Changes before={log.before ?? null} after={log.after ?? null} />
                  </Td>
                  <Td className="whitespace-nowrap font-mono text-xs text-ink-3">{log.ip}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
      {pages > 1 ? (
        <div className="mt-3 flex justify-between text-[13px] text-ink-3">
          <span className="tabular-nums">
            Page {page} of {pages}
          </span>
          <span className="flex gap-3">
            {page > 1 ? <Link href={qs(page - 1)} className="text-ink hover:underline">Newer</Link> : null}
            {page < pages ? <Link href={qs(page + 1)} className="text-ink hover:underline">Older</Link> : null}
          </span>
        </div>
      ) : null}
    </>
  );
}
