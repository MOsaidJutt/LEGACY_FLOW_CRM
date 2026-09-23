import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { unreadMessageCount } from "@/lib/messages";
import { AppShell } from "@/components/shell/app-shell";
import { ForcedPasswordChange } from "./account/password-form";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  if (user.mustChangePassword) return <ForcedPasswordChange name={user.name} />;

  const canDecide = user.permissions.includes("leads.requests.decide");
  const [settings, [presence], [unread], pending, messages] = await Promise.all([
    getSettings(),
    db.select().from(schema.presence).where(eq(schema.presence.userId, user.id)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, user.id), isNull(schema.notifications.readAt))),
    canDecide
      ? db.select({ n: sql<number>`count(*)::int` }).from(schema.leadRequests).where(eq(schema.leadRequests.status, "pending"))
      : Promise.resolve(null),
    user.permissions.includes("messages.use") ? unreadMessageCount(user.id) : Promise.resolve(0),
  ]);

  return (
    <AppShell
      user={{ name: user.name, roleName: user.roleName, permissions: user.permissions }}
      breakTypes={settings.breakTypes}
      presence={{
        state: presence?.state ?? "active",
        breakType: presence?.breakType ?? null,
        since: (presence?.since ?? new Date()).toISOString(),
      }}
      counts={{ notifications: unread.n, messages, requests: pending ? pending[0].n : null }}
    >
      {children}
    </AppShell>
  );
}
