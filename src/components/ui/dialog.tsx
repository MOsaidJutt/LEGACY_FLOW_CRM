"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Native <dialog>: top layer, focus trap and Escape handling come from the browser. */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        "m-auto w-[min(94vw,32rem)] overflow-hidden rounded-lg border border-line bg-raised p-0 text-ink shadow-pop backdrop:bg-black/55 open:animate-[lf-fade-in_180ms_var(--ease-out-quart)]",
        className,
      )}
    >
      {open ? (
        <>
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-semibold">
                {title}
              </h2>
              {description ? <p className="mt-0.5 text-sm text-ink-3">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </>
      ) : null}
    </dialog>
  );
}
