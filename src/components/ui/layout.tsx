import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <header className="mb-6">
      {back ? (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
          <ChevronLeft className="size-3.5" aria-hidden />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-1 max-w-[72ch] text-sm text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Bordered container for a table or form section. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  flush,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** remove body padding (tables) */
  flush?: boolean;
}) {
  return (
    <section className={cn("rounded-lg border border-line bg-raised", className)}>
      {title || actions ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            {title ? <h2 className="text-[15px] font-semibold text-ink">{title}</h2> : null}
            {description ? <p className="mt-0.5 text-[13px] text-ink-3">{description}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={flush ? undefined : "p-4"}>{children}</div>
    </section>
  );
}

/** Compact metric row. Numbers are real counts, never decoration. */
export function StatRow({
  items,
}: {
  items: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string }[];
}) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-raised sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
      {items.map((item) => {
        const inner = (
          <>
            <dt className="text-[13px] text-ink-3">{item.label}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-ink">{item.value}</dd>
            {item.hint ? <p className="mt-0.5 text-xs text-ink-3">{item.hint}</p> : null}
          </>
        );
        return (
          <div key={item.label} className="-mb-px -mr-px border-b border-r border-line">
            {item.href ? (
              <Link href={item.href} className="block px-4 py-3 transition-colors hover:bg-hover">
                {inner}
              </Link>
            ) : (
              <div className="px-4 py-3">{inner}</div>
            )}
          </div>
        );
      })}
    </dl>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-12 text-center", className)}>
      {Icon ? <Icon className="mb-3 size-6 text-ink-3" aria-hidden /> : null}
      <p className="text-[15px] font-medium text-ink">{title}</p>
      {children ? <div className="mt-1 max-w-[52ch] text-sm text-ink-3">{children}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", children, className }: { tone?: "info" | "warning" | "danger" | "success"; children: React.ReactNode; className?: string }) {
  const tones = {
    info: "border-info/30 bg-info-soft text-ink",
    warning: "border-warning/35 bg-warning-soft text-ink",
    danger: "border-danger/35 bg-danger-soft text-ink",
    success: "border-success/35 bg-success-soft text-ink",
  };
  return <div className={cn("rounded-md border px-3.5 py-2.5 text-sm", tones[tone], className)}>{children}</div>;
}
