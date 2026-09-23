import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { PageHeader, Panel } from "@/components/ui/layout";
import { BreaksForm, RulesForm, ShiftForm } from "./settings-forms";

export const metadata: Metadata = { title: "Time & rules" };

const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Asia/Karachi", "UTC"];

export default async function SettingsPage() {
  await requirePermission("settings.manage");
  const [settings, shifts] = await Promise.all([getSettings(), db.select().from(schema.shifts).orderBy(asc(schema.shifts.name))]);
  return (
    <>
      <PageHeader title="Time & rules" description="Inactivity, lead request and session rules, break types and working shifts." />
      <div className="flex flex-col gap-5">
        <Panel title="Rules">
          <RulesForm
            timezones={TIMEZONES}
            values={{
              businessTimezone: settings.businessTimezone,
              inactivityMinutes: settings.inactivityMinutes,
              autoAssignMinutes: settings.autoAssignMinutes,
              leadPresets: settings.leadPresets.join(", "),
              maxLeadRequest: settings.maxLeadRequest,
              sessionIdleMinutes: settings.sessionIdleMinutes,
              sessionMaxHours: settings.sessionMaxHours,
            }}
          />
        </Panel>
        <Panel title="Breaks and HR document types">
          <BreaksForm breaks={settings.breakTypes} categories={settings.hrDocumentCategories} />
        </Panel>
        <Panel title="Shifts" description={`Times are in ${settings.businessTimezone}. Used for punctuality: late arrival, early logout and scheduled hours.`}>
          <div className="flex flex-col divide-y divide-line">
            {shifts.map((s) => (
              <div key={s.id} className="py-3 first:pt-0">
                <ShiftForm shift={{ id: s.id, name: s.name, startTime: s.startTime.slice(0, 5), endTime: s.endTime.slice(0, 5), days: s.days, graceMinutes: s.graceMinutes }} />
              </div>
            ))}
            <div className="pt-4">
              <p className="mb-2 text-[13px] font-medium text-ink-2">Add a shift</p>
              <ShiftForm />
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
