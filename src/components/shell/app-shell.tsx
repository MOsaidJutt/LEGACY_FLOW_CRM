"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useTheme } from "next-themes";
import { Coffee, LogOut, Menu, Moon, Sun, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { signOut } from "@/lib/auth/actions";
import { endBreak, startBreak } from "@/lib/monitoring/actions";
import type { BreakType } from "@/lib/settings-defaults";
import { ActivityTracker, type PresenceUpdate } from "./activity-tracker";
import { navFor } from "./nav";

const noopSubscribe = () => () => {};

export type ShellUser = { name: string; roleName: string; permissions: string[] };
export type ShellPresence = { state: "active" | "idle" | "break" | "offline"; breakType: string | null; since: string };
type Counts = { notifications: number; messages: number; requests: number | null };

export function AppShell({
  user,
  breakTypes,
  presence,
  counts: initialCounts,
  children,
}: {
  user: ShellUser;
  breakTypes: BreakType[];
  presence: ShellPresence;
  counts: Counts;
  children: React.ReactNode;
}) {
  const [counts, setCounts] = useState(initialCounts);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const onUpdate = useCallback((u: PresenceUpdate) => {
    if (!u.signedIn) return;
    setCounts((c) => ({ notifications: u.notifications ?? c.notifications, messages: u.messages ?? c.messages, requests: u.requests ?? c.requests }));
  }, []);

  // adopt fresh server counts after a navigation / refresh, and close the drawer on route change
  const [seen, setSeen] = useState({ counts: initialCounts, pathname });
  if (seen.counts !== initialCounts || seen.pathname !== pathname) {
    if (seen.counts !== initialCounts) setCounts(initialCounts);
    if (seen.pathname !== pathname) setDrawerOpen(false);
    setSeen({ counts: initialCounts, pathname });
  }

  const sidebar = <Sidebar user={user} breakTypes={breakTypes} presence={presence} counts={counts} />;

  return (
    <div className="flex min-h-dvh">
      <ActivityTracker onUpdate={onUpdate} />

      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-line bg-panel lg:block">{sidebar}</aside>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        {sidebar}
      </MobileDrawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[var(--z-sticky)] flex h-12 items-center gap-3 border-b border-line bg-panel px-3 lg:hidden">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open navigation" className="rounded-md p-1.5 text-ink-2 hover:bg-hover">
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="brand-mark size-5 text-ink" aria-hidden />
          <span className="text-sm font-semibold">Legacy Flow</span>
        </header>
        {presence.state === "break" ? <BreakBanner presence={presence} breakTypes={breakTypes} /> : null}
        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

function Sidebar({
  user,
  breakTypes,
  presence,
  counts,
}: {
  user: ShellUser;
  breakTypes: BreakType[];
  presence: ShellPresence;
  counts: Counts;
}) {
  const pathname = usePathname();
  const groups = navFor(user.permissions);
  const isAgent = user.permissions.includes("leads.work");

  return (
    <div className="flex h-full flex-col">
      <Link href="/" className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <span className="brand-mark size-6 text-ink" aria-hidden />
        <span className="text-[15px] font-semibold tracking-tight">Legacy Flow</span>
      </Link>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2.5 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            {groups.length > 1 ? <p className="px-2 pb-1 text-[11px] font-medium text-ink-3">{group.label}</p> : null}
            <ul className="flex flex-col gap-px">
              {group.items.map((item) => {
                const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + "/");
                const badge = item.badge ? counts[item.badge] : null;
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13.5px] transition-colors duration-150",
                        active ? "bg-selected font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
                      )}
                    >
                      <Icon className={cn("size-4 shrink-0", active ? "text-ink" : "text-ink-3")} aria-hidden />
                      <span className="truncate">{item.label}</span>
                      {badge ? (
                        <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] tabular-nums text-on-accent">
                          {badge > 99 ? "99+" : badge}
                          <span className="sr-only"> unread</span>
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line p-2.5">
        {isAgent ? <BreakControl breakTypes={breakTypes} presence={presence} /> : null}
        <UserMenu user={user} />
      </div>
    </div>
  );
}

function BreakControl({ breakTypes, presence }: { breakTypes: BreakType[]; presence: ShellPresence }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  if (presence.state === "break") return null; // the banner owns "End break"

  return (
    <div className="mb-1">
      <button
        type="button"
        popoverTarget="break-menu"
        disabled={pending}
        className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13.5px] text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-60"
      >
        <Coffee className="size-4 text-ink-3" aria-hidden />
        Take a break
      </button>
      <div
        id="break-menu"
        popover="auto"
        ref={popoverRef}
        className="m-0 w-56 rounded-lg border border-line bg-raised p-1 text-ink shadow-pop [inset:auto_auto_4.5rem_0.75rem]"
      >
        <p className="px-2 pb-1 pt-1.5 text-xs text-ink-3">Start a break</p>
        {breakTypes.map((b) => (
          <button
            key={b.key}
            type="button"
            className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-hover"
            onClick={() =>
              startTransition(async () => {
                const result = await startBreak(b.key);
                setError(result?.error ?? null);
                popoverRef.current?.hidePopover();
              })
            }
          >
            <span>{b.label}</span>
            <span className="text-xs tabular-nums text-ink-3">{b.maxMinutes} min</span>
          </button>
        ))}
      </div>
      {error ? <p className="px-2 text-xs text-danger">{error}</p> : null}
    </div>
  );
}

function BreakBanner({ presence, breakTypes }: { presence: ShellPresence; breakTypes: BreakType[] }) {
  const [pending, startTransition] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const type = breakTypes.find((b) => b.key === presence.breakType);
  const elapsed = Math.max(0, Math.floor((now - new Date(presence.since).getTime()) / 1000));
  const over = type ? elapsed > type.maxMinutes * 60 : false;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 sm:px-6 lg:px-8", over ? "border-warning/40 bg-warning-soft" : "border-line bg-selected")}>
      <Coffee className="size-4 text-ink-2" aria-hidden />
      <p className="text-sm">
        <span className="font-medium">{type?.label ?? "Break"}</span>
        <span className="ml-2 tabular-nums text-ink-2">
          {mm}:{ss}
        </span>
        {type ? <span className="ml-2 text-ink-3">of {type.maxMinutes} min</span> : null}
        {over ? <span className="ml-2 font-medium text-warning">Over the allowed time</span> : null}
      </p>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => void (await endBreak()))}
        className="ml-auto inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
      >
        End break
      </button>
    </div>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const { resolvedTheme, setTheme } = useTheme();
  // false during SSR and hydration, true afterwards: avoids a theme icon mismatch
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
  const dark = mounted ? resolvedTheme === "dark" : true;

  return (
    <div className="flex items-center gap-1">
      <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-hover">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-hover text-ink-2">
          <UserRound className="size-4" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium leading-tight text-ink">{user.name}</span>
          <span className="block truncate text-xs leading-tight text-ink-3">{user.roleName}</span>
        </span>
      </Link>
      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
        title={dark ? "Light theme" : "Dark theme"}
        className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink"
      >
        {dark ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
      </button>
      <form action={signOut}>
        <button type="submit" aria-label="Sign out" title="Sign out" className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink">
          <LogOut className="size-4" aria-hidden />
        </button>
      </form>
    </div>
  );
}

function MobileDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label="Navigation"
      className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-r border-line bg-panel p-0 text-ink backdrop:bg-black/55 lg:hidden"
    >
      <button type="button" onClick={onClose} aria-label="Close navigation" className="absolute right-2 top-3 rounded-md p-1.5 text-ink-3 hover:bg-hover">
        <X className="size-4" aria-hidden />
      </button>
      {children}
    </dialog>
  );
}
