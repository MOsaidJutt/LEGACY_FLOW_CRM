import { CircleAlert, CircleCheck } from "lucide-react";

/** Result line under a form, announced to screen readers. */
export function FormMessage({ state }: { state: { ok?: boolean; error?: string; message?: string } | null | undefined }) {
  if (!state) return null;
  if (state.error) {
    return (
      <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{state.error}</span>
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="flex items-start gap-2 rounded-md bg-success-soft px-3 py-2 text-sm text-success">
        <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{state.message}</span>
      </p>
    );
  }
  return null;
}
