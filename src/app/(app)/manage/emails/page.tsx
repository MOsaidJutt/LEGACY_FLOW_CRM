import type { Metadata } from "next";
import Link from "next/link";
import { Mail } from "lucide-react";
import { requirePermission } from "@/lib/auth/session";
import { emailLog } from "@/lib/leads/emails";
import { getSettings } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Emails" };

export default async function EmailsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission("leads.manage");
  const tz = (await getSettings()).businessTimezone;
  const sp = await searchParams;
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string).trim() : "");
  const q = get("q").slice(0, 100);
  const status = get("status");
  const page = Math.max(1, Number(get("page")) || 1);
  const { rows, total, perPage } = await emailLog({ q, status, page });
  const pages = Math.max(1, Math.ceil(total / perPage));

  return (
    <>
      <PageHeader
        title="Emails"
        description="Every follow-up email sent from the CRM, by Management or by an agent, with its lead, recipient and result."
      />

      <form className="mb-3 flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={q} placeholder="Search lead, recipient or subject" aria-label="Search emails" className="w-72" />
        <Select name="status" defaultValue={status} aria-label="Status" className="w-40">
          <option value="">Any result</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </Select>
        <Button type="submit">Filter</Button>
      </form>

      <section className="rounded-lg border border-line bg-raised">
        {rows.length === 0 ? (
          <EmptyState icon={Mail} title="No emails sent yet">
            Follow-up emails sent from a lead record appear here, with who sent them and whether they arrived.
          </EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Lead</Th>
                <Th>To</Th>
                <Th>Subject</Th>
                <Th>Sent by</Th>
                <Th>Agent on the lead</Th>
                <Th>Campaign</Th>
                <Th>Result</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="whitespace-nowrap tabular-nums">{formatDateTime(r.createdAt, tz)}</Td>
                  <Td>
                    <Link href={`/manage/leads/${r.leadId}`} className="font-medium hover:underline">
                      {r.company || r.contactName || "Unnamed lead"}
                    </Link>
                  </Td>
                  <Td className="[overflow-wrap:anywhere]">{r.toEmail}</Td>
                  <Td className="max-w-[20rem] text-ink-2">{r.subject}</Td>
                  <Td className="whitespace-nowrap">{r.sentBy ?? "-"}</Td>
                  <Td className="whitespace-nowrap">{r.assignedAgent ?? <span className="text-ink-3">Unassigned</span>}</Td>
                  <Td className="text-ink-2">{r.campaign ?? ""}</Td>
                  <Td>
                    {r.status === "sent" ? (
                      <Badge tone="success">Sent</Badge>
                    ) : (
                      <span className="inline-flex flex-col gap-0.5">
                        <Badge tone="danger">Failed</Badge>
                        {r.error ? <span className="text-xs text-ink-3">{r.error}</span> : null}
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      {pages > 1 ? (
        <div className="mt-3 flex items-center justify-between text-[13px] text-ink-3">
          <span className="tabular-nums">
            {(page - 1) * perPage + 1} to {Math.min(page * perPage, total)} of {total.toLocaleString()}
          </span>
          <span className="flex gap-3">
            {page > 1 ? (
              <Link href={`?${new URLSearchParams({ q, status, page: String(page - 1) })}`} className="hover:underline">
                Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={`?${new URLSearchParams({ q, status, page: String(page + 1) })}`} className="hover:underline">
                Next
              </Link>
            ) : null}
          </span>
        </div>
      ) : null}
    </>
  );
}
