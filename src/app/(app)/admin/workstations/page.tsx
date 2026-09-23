import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { agentUsers } from "@/lib/metrics";
import { formatDateTime, relativeTime } from "@/lib/time";
import { PageHeader, Panel } from "@/components/ui/layout";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { NewDeviceForm, RevokeButton } from "./workstations-client";

export const metadata: Metadata = { title: "Workstations" };

export default async function WorkstationsPage() {
  await requirePermission("users.manage");
  const tz = (await getSettings()).businessTimezone;
  const [devices, agents] = await Promise.all([
    db
      .select({ d: schema.desktopDevices, user: schema.users.name })
      .from(schema.desktopDevices)
      .leftJoin(schema.users, eq(schema.users.id, schema.desktopDevices.userId))
      .orderBy(desc(schema.desktopDevices.createdAt)),
    agentUsers(),
  ]);
  const appUrl = (process.env.APP_URL ?? "https://<your-domain>").replace(/\/$/, "");
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Workstations"
        description="The Windows desktop agent reports keyboard and mouse activity (and optionally the active application) from each calling computer, so Active Time is accurate while agents work in VC Dialer. Inform employees before installing it."
      />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Panel title="Registered computers" flush>
          {devices.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-ink-3">No computers registered yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Computer</Th>
                  <Th>Agent</Th>
                  <Th>Last report</Th>
                  <Th>Status</Th>
                  <Th className="text-right">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {devices.map(({ d, user }) => {
                  const live = d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < 3 * 60_000;
                  return (
                    <Tr key={d.id}>
                      <Td className="font-medium">{d.name}</Td>
                      <Td>{user}</Td>
                      <Td className="text-ink-2" title={d.lastSeenAt ? formatDateTime(d.lastSeenAt, tz) : undefined}>
                        {d.lastSeenAt ? relativeTime(d.lastSeenAt, now) : "Never"}
                      </Td>
                      <Td>{d.revokedAt ? <Badge>Revoked</Badge> : live ? <Badge tone="success">Reporting</Badge> : <Badge tone="warning">Not reporting</Badge>}</Td>
                      <Td className="text-right">{d.revokedAt ? null : <RevokeButton id={d.id} name={d.name} />}</Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Panel>
        <Panel title="Register a computer">
          <NewDeviceForm agents={agents.map((a) => ({ id: a.id, name: a.name }))} appUrl={appUrl} />
        </Panel>
      </div>
    </>
  );
}
