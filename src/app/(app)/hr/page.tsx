import type { Metadata } from "next";
import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage() {
  await requirePermission("hr.manage");
  const { users, roles, employeeProfiles: ep, hrDocuments, leaveRequests } = schema;
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      status: users.status,
      role: roles.name,
      code: ep.employeeCode,
      jobTitle: ep.jobTitle,
      department: ep.department,
      joiningDate: ep.joiningDate,
      docs: sql<number>`(select count(*)::int from ${hrDocuments} d where d.user_id = ${users.id})`,
      expiring: sql<number>`(select count(*)::int from ${hrDocuments} d where d.user_id = ${users.id} and d.expires_on is not null and d.expires_on <= (current_date + 30))`,
      onLeave: sql<boolean>`exists (select 1 from ${leaveRequests} l where l.user_id = ${users.id} and l.status = 'approved' and l.start_date <= ${today} and l.end_date >= ${today})`,
    })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(ep, eq(ep.userId, users.id))
    .orderBy(asc(users.status), asc(users.name));

  return (
    <>
      <PageHeader title="Employees" description="Employee records, documents and history. Only HR can see this information." />
      <section className="rounded-lg border border-line bg-raised">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Employee ID</Th>
              <Th>Job title</Th>
              <Th>Department</Th>
              <Th>Joined</Th>
              <Th className="text-right">Documents</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className={r.status === "inactive" ? "opacity-60" : undefined}>
                <Td>
                  <Link href={`/hr/employees/${r.id}`} className="font-medium hover:underline">
                    {r.name}
                  </Link>
                  <span className="ml-2 text-xs text-ink-3">{r.role}</span>
                </Td>
                <Td className="font-mono text-[13px]">{r.code}</Td>
                <Td className="text-ink-2">{r.jobTitle}</Td>
                <Td className="text-ink-2">{r.department}</Td>
                <Td className="tabular-nums text-ink-2">{r.joiningDate}</Td>
                <Td className="text-right tabular-nums">
                  {r.docs}
                  {r.expiring ? (
                    <Badge tone="warning" className="ml-2">
                      {r.expiring} expiring
                    </Badge>
                  ) : null}
                </Td>
                <Td>
                  {r.status === "inactive" ? <Badge>Former</Badge> : r.onLeave ? <Badge tone="info">On leave</Badge> : <Badge tone="success">Active</Badge>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>
    </>
  );
}
