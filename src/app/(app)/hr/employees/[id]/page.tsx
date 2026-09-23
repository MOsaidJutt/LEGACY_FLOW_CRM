import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { attendance, summarizeAttendance } from "@/lib/attendance";
import { resolvePeriod } from "@/lib/period";
import { formatDateTime, formatDuration } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Table, Td, Tr } from "@/components/ui/table";
import { Badge, type Tone } from "@/components/ui/badge";
import { DocumentList, DocumentUpload, EventForm, ProfileForm } from "./employee-forms";

export const metadata: Metadata = { title: "Employee" };

const KIND: Record<string, { label: string; tone: Tone }> = {
  warning: { label: "Warning", tone: "danger" },
  review: { label: "Review", tone: "info" },
  change: { label: "Change", tone: "accent" },
  note: { label: "Note", tone: "neutral" },
};
const LEAVE_TONE: Record<string, Tone> = { pending: "warning", approved: "success", rejected: "danger", cancelled: "neutral" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("hr.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { users, roles, employeeProfiles, hrDocuments, employeeEvents, leaveRequests, leaveTypes, files } = schema;
  const author = alias(users, "author");

  const [person] = await db
    .select({ user: users, role: roles.name, profile: employeeProfiles })
    .from(users)
    .innerJoin(roles, eq(roles.id, users.roleId))
    .leftJoin(employeeProfiles, eq(employeeProfiles.userId, users.id))
    .where(eq(users.id, id));
  if (!person) notFound();

  const settings = await getSettings();
  const tz = settings.businessTimezone;
  const month = resolvePeriod(tz, { period: "30d" });

  const [docs, events, leaves, att] = await Promise.all([
    db
      .select({ id: hrDocuments.id, category: hrDocuments.category, title: hrDocuments.title, notes: hrDocuments.notes, expiresOn: hrDocuments.expiresOn, createdAt: hrDocuments.createdAt, uploader: author.name, fileName: files.name, size: files.size })
      .from(hrDocuments)
      .innerJoin(files, eq(files.id, hrDocuments.fileId))
      .leftJoin(author, eq(author.id, hrDocuments.uploadedBy))
      .where(eq(hrDocuments.userId, id))
      .orderBy(desc(hrDocuments.createdAt)),
    db
      .select({ id: employeeEvents.id, kind: employeeEvents.kind, title: employeeEvents.title, details: employeeEvents.details, createdAt: employeeEvents.createdAt, author: author.name })
      .from(employeeEvents)
      .leftJoin(author, eq(author.id, employeeEvents.createdBy))
      .where(eq(employeeEvents.userId, id))
      .orderBy(desc(employeeEvents.createdAt)),
    db
      .select({ id: leaveRequests.id, type: leaveTypes.name, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, status: leaveRequests.status, reason: leaveRequests.reason })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveTypes.id, leaveRequests.leaveTypeId))
      .where(eq(leaveRequests.userId, id))
      .orderBy(desc(leaveRequests.startDate))
      .limit(20),
    attendance(tz, month.fromDay, month.toDay, [id]),
  ]);
  const s = summarizeAttendance(att);
  const p = person.profile;

  return (
    <>
      <PageHeader
        title={person.user.name}
        back={{ href: "/hr", label: "Employees" }}
        description={`${person.role} · ${person.user.email}${person.user.status === "inactive" ? " · account deactivated" : ""}`}
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Profile">
            <ProfileForm
              userId={id}
              profile={{
                employeeCode: p?.employeeCode ?? "",
                phone: p?.phone ?? "",
                personalEmail: p?.personalEmail ?? "",
                joiningDate: p?.joiningDate ?? "",
                jobTitle: p?.jobTitle ?? "",
                department: p?.department ?? "",
                address: p?.address ?? "",
                emergencyContact: p?.emergencyContact ?? "",
                notes: p?.notes ?? "",
              }}
            />
          </Panel>

          <Panel title="Documents" description="Undertakings, agreements, warning letters, reviews and other soft copies.">
            <DocumentList
              docs={docs.map((d) => ({
                id: d.id,
                category: d.category,
                title: d.title,
                notes: d.notes,
                expiresOn: d.expiresOn,
                expired: Boolean(d.expiresOn && d.expiresOn < new Date().toISOString().slice(0, 10)),
                uploaded: `${formatDateTime(d.createdAt, tz)}${d.uploader ? ` by ${d.uploader}` : ""}`,
                fileName: d.fileName,
                size: d.size,
              }))}
            />
            <div className="mt-5 border-t border-line pt-5">
              <DocumentUpload userId={id} categories={settings.hrDocumentCategories} />
            </div>
          </Panel>

          <Panel title="Employment history" description="Warnings, reviews, role changes and notes, newest first.">
            <EventForm userId={id} />
            {events.length ? (
              <ol className="mt-5 flex flex-col divide-y divide-line border-t border-line">
                {events.map((e) => (
                  <li key={e.id} className="py-3 text-sm">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND[e.kind]?.tone}>{KIND[e.kind]?.label ?? e.kind}</Badge>
                      <span className="font-medium">{e.title}</span>
                    </p>
                    {e.details ? <p className="mt-1 whitespace-pre-wrap text-ink-2">{e.details}</p> : null}
                    <p className="mt-1 text-xs text-ink-3">
                      {formatDateTime(e.createdAt, tz)}
                      {e.author ? ` · ${e.author}` : ""}
                    </p>
                  </li>
                ))}
              </ol>
            ) : null}
          </Panel>
        </div>

        <div className="flex flex-col gap-5 xl:sticky xl:top-6">
          <Panel title="Last 30 days">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[
                ["Days present", `${s.presentDays} of ${s.scheduledDays}`],
                ["Absent", s.absentDays],
                ["Late days", s.lateDays ? `${s.lateDays} (${s.lateMinutes} min)` : 0],
                ["Left early", s.earlyDays],
                ["Leave days", s.leaveDays],
                ["Recorded time", formatDuration(s.screenSeconds)],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-ink-3">{k}</dt>
                  <dd className="mt-0.5 font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
          <Panel title="Leave" flush>
            {leaves.length === 0 ? (
              <p className="px-4 py-6 text-sm text-ink-3">No leave recorded.</p>
            ) : (
              <Table>
                <tbody>
                  {leaves.map((l) => (
                    <Tr key={l.id}>
                      <Td className="whitespace-nowrap tabular-nums">
                        {l.startDate}
                        {l.endDate !== l.startDate ? ` to ${l.endDate}` : ""}
                      </Td>
                      <Td className="text-ink-2">{l.type}</Td>
                      <Td>
                        <Badge tone={LEAVE_TONE[l.status]}>{l.status[0].toUpperCase() + l.status.slice(1)}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
