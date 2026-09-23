"use client";

import { useState, useTransition } from "react";
import { Download, Save } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form-message";
import { approveReportAction, saveReportAction } from "./actions";

export function LiveReportActions({ params }: { params: Record<string, string> }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const qs = (format: string) => `/api/reports/export?${new URLSearchParams({ ...params, format })}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={qs("xlsx")} prefetch={false}>
        <Download aria-hidden /> Excel
      </ButtonLink>
      <ButtonLink href={qs("pdf")} prefetch={false}>
        <Download aria-hidden /> PDF
      </ButtonLink>
      <Button variant="primary" pending={pending} onClick={() => startTransition(async () => setError((await saveReportAction(params))?.error ?? null))}>
        {!pending ? <Save aria-hidden /> : null}
        Save report
      </Button>
      {error ? <FormMessage state={{ error }} /> : null}
    </div>
  );
}

export function SavedReportActions({ id, canApprove, approved }: { id: string; canApprove: boolean; approved: boolean }) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<{ error?: string; message?: string } | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ButtonLink href={`/api/reports/export?saved=${id}&format=xlsx`} prefetch={false}>
        <Download aria-hidden /> Excel
      </ButtonLink>
      <ButtonLink href={`/api/reports/export?saved=${id}&format=pdf`} prefetch={false}>
        <Download aria-hidden /> PDF
      </ButtonLink>
      {canApprove && !approved ? (
        <Button variant="primary" pending={pending} onClick={() => startTransition(async () => setState(await approveReportAction(id)))}>
          Approve report
        </Button>
      ) : null}
      {state ? <FormMessage state={state} /> : null}
    </div>
  );
}
