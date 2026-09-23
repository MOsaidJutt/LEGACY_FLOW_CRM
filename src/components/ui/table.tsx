import { cn } from "@/lib/cn";

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  );
}

export function Th({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      className={cn("h-9 whitespace-nowrap border-b border-line bg-raised px-3 text-left text-xs font-medium text-ink-3 first:pl-4 last:pr-4", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("border-b border-line px-3 py-2.5 align-middle text-ink first:pl-4 last:pr-4", className)} {...props} />;
}

export function Tr({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr className={cn("transition-colors [&:last-child>td]:border-b-0 hover:bg-hover/40", className)} {...props} />;
}
