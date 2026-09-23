import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Bell } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { formatDateTime, relativeTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { SubmitButton } from "@/components/ui/submit-button";
import { markAllReadAction } from "./actions";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireUser();
  const tz = (await getSettings()).businessTimezone;
  const rows = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, user.id)).orderBy(desc(schema.notifications.createdAt)).limit(100);
  const unread = rows.filter((r) => !r.readAt).length;
  const now = new Date();

  return (
    <>
      <PageHeader
        title="Notifications"
        description={unread ? `${unread} unread` : "You are all caught up."}
        actions={
          unread ? (
            <form action={markAllReadAction}>
              <SubmitButton>Mark all as read</SubmitButton>
            </form>
          ) : null
        }
      />
      <section className="max-w-3xl rounded-lg border border-line bg-raised">
        {rows.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications yet">
            Lead assignments, request decisions, callback reminders, messages and announcements show up here.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((n) => (
              <li key={n.id}>
                <Link href={`/notifications/${n.id}`} className={cn("flex gap-3 px-4 py-3 transition-colors hover:bg-hover/50", !n.readAt && "bg-selected/40")}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-sm", n.readAt ? "text-ink-2" : "font-medium text-ink")}>
                      {n.title}
                      {!n.readAt ? <span className="sr-only"> (unread)</span> : null}
                    </span>
                    {n.body ? <span className="mt-0.5 block text-[13px] text-ink-3">{n.body}</span> : null}
                  </span>
                  <time className="shrink-0 text-xs tabular-nums text-ink-3" title={formatDateTime(n.createdAt, tz)}>
                    {relativeTime(n.createdAt, now)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
