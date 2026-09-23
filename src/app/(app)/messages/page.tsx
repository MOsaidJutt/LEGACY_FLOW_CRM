import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq, ne } from "drizzle-orm";
import { MessagesSquare, Paperclip, Search, Users } from "lucide-react";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";
import { listConversations, loadThread, searchMessages, syncGroupConversations } from "@/lib/messages";
import { formatDateTime, relativeTime } from "@/lib/time";
import { cn } from "@/lib/cn";
import { PageHeader, EmptyState } from "@/components/ui/layout";
import { AutoRefresh } from "@/components/auto-refresh";
import { Composer, NewConversation } from "./messages-client";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("messages.use");
  const sp = await searchParams;
  const tz = (await getSettings()).businessTimezone;
  await syncGroupConversations(user.id, user.permissions.includes("announcements.post"));

  const [conversations, people] = await Promise.all([
    listConversations(user.id),
    db
      .select({ id: schema.users.id, name: schema.users.name, role: schema.roles.name })
      .from(schema.users)
      .innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
      .where(and(eq(schema.users.status, "active"), ne(schema.users.id, user.id)))
      .orderBy(asc(schema.users.name)),
  ]);
  const q = (sp.q ?? "").trim().slice(0, 80);
  const selectedId = sp.c && conversations.some((c) => c.id === sp.c) ? sp.c : q ? undefined : conversations.find((c) => c.lastMessageAt)?.id;
  const thread = selectedId ? await loadThread(selectedId, user.id) : null;
  const results = q ? await searchMessages(user.id, q) : null;
  const now = new Date();
  const titleOf = (c: { kind: string; title: string | null; otherName: string | null }) => (c.kind === "group" ? (c.title ?? "Group") : (c.otherName ?? "Direct message"));

  return (
    <>
      <AutoRefresh everyMs={6_000} />
      <PageHeader title="Messages" description="Direct messages and team conversations. Messages are kept with read status for the record." />
      <div className="grid gap-5 lg:h-[calc(100dvh-11rem)] lg:min-h-[32rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-line bg-raised">
          <div className="border-b border-line p-2">
            <NewConversation people={people} />
          </div>
          <form action="/messages" className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute left-4.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <input name="q" defaultValue={q} placeholder="Search messages" aria-label="Search messages" className="h-8 w-full rounded-md bg-transparent pl-8 pr-2 text-sm hover:bg-hover focus-visible:bg-hover focus-visible:outline-offset-0" />
          </form>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {conversations.length === 0 ? <li className="px-4 py-8 text-center text-sm text-ink-3">Start a conversation with the button above.</li> : null}
            {conversations.map((c) => (
              <li key={c.id}>
                <Link href={`/messages?c=${c.id}`} className={cn("flex gap-3 border-b border-line px-4 py-3 transition-colors", c.id === selectedId ? "bg-selected" : "hover:bg-hover/60")}>
                  <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full bg-hover text-ink-3">
                    {c.kind === "group" ? <Users className="size-3.5" aria-hidden /> : <span className="text-xs font-semibold text-ink-2">{titleOf(c).slice(0, 1)}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn("truncate text-sm", c.unread ? "font-semibold text-ink" : "font-medium text-ink")}>{titleOf(c)}</span>
                      {c.lastMessageAt ? <span className="shrink-0 text-xs text-ink-3">{relativeTime(c.lastMessageAt, now).replace(" ago", "")}</span> : null}
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] text-ink-3">{c.lastBody ?? (c.kind === "group" ? `${c.memberCount} members` : "No messages yet")}</span>
                      {c.unread ? (
                        <span className="shrink-0 rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-on-accent">
                          {c.unread}
                          <span className="sr-only"> unread</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-lg border border-line bg-raised">
          {results ? (
            <>
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <h2 className="text-[15px] font-semibold">
                  {results.length} {results.length === 1 ? "result" : "results"} for “{q}”
                </h2>
                <Link href="/messages" className="text-sm text-ink-3 hover:text-ink">
                  Clear search
                </Link>
              </div>
              <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
                {results.map((r) => (
                  <li key={r.id}>
                    <Link href={`/messages?c=${r.conversationId}`} className="block px-5 py-3 hover:bg-hover/50">
                      <p className="text-xs text-ink-3">
                        {r.conversation} · {r.sender} · {formatDateTime(r.createdAt, tz)}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm">{r.body}</p>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : thread ? (
            <>
              <div className="border-b border-line px-5 py-3">
                <h2 className="text-[15px] font-semibold">{thread.conversation.kind === "group" ? thread.conversation.title : thread.members.find((m) => m.id !== user.id)?.name}</h2>
                <p className="truncate text-[13px] text-ink-3">{thread.members.map((m) => (m.id === user.id ? "You" : m.name)).join(", ")}</p>
              </div>
              <ol className="flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-5 py-4">
                <div className="flex flex-col gap-4">
                  {thread.messages.length === 0 ? <li className="py-10 text-center text-sm text-ink-3">No messages yet. Say hello.</li> : null}
                  {thread.messages.map((m) => {
                    const mine = m.senderId === user.id;
                    return (
                      <li key={m.id} className={cn("max-w-[75ch] rounded-lg px-3.5 py-2.5", mine ? "self-end bg-selected" : "self-start bg-hover/60")}>
                        <p className="text-xs text-ink-3">
                          <span className="font-medium text-ink-2">{mine ? "You" : (m.sender ?? "Former user")}</span> · {formatDateTime(m.createdAt, tz)}
                        </p>
                        {m.body !== "(attachment)" ? <p className="mt-1 whitespace-pre-wrap text-sm text-ink [overflow-wrap:anywhere]">{m.body}</p> : null}
                        {m.fileId ? (
                          <a href={`/api/messages/files/${m.fileId}`} className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-line bg-raised px-2 py-1 text-[13px] hover:bg-hover">
                            <Paperclip className="size-3.5 text-ink-3" aria-hidden />
                            {m.fileName}
                            <span className="text-ink-3">{m.fileSize ? `${Math.max(1, Math.round(m.fileSize / 1024))} KB` : ""}</span>
                          </a>
                        ) : null}
                      </li>
                    );
                  })}
                </div>
              </ol>
              <Composer conversationId={thread.conversation.id} />
            </>
          ) : (
            <EmptyState icon={MessagesSquare} title="Choose a conversation" className="my-auto">
              Pick one on the left, or start a new message. Team groups appear automatically.
            </EmptyState>
          )}
        </section>
      </div>
    </>
  );
}
