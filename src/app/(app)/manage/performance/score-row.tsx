"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { formatCell } from "@/lib/report-format";
import type { ReviewPeriod } from "@/lib/performance";
import { approveReviewAction, saveScoreAction } from "./actions";

type Row = Record<string, string | number | null>;

const METRICS: [string, string, "number" | "duration" | "percent"][] = [
  ["calls", "Calls", "number"],
  ["answered", "Answered", "number"],
  ["qualified", "Qualified", "number"],
  ["callbacks", "Callbacks", "number"],
  ["talk", "Talk", "duration"],
  ["active", "Active", "duration"],
  ["idle", "Idle", "duration"],
  ["break", "Break", "duration"],
  ["productive", "Productive", "percent"],
  ["present", "Days present", "number"],
  ["lateDays", "Late days", "number"],
];

export function ScoreRow({
  userId,
  type,
  day,
  row,
  review,
}: {
  userId: string;
  type: ReviewPeriod;
  day: string;
  row: Row;
  review: { id: string; score: number | null; comment: string | null; status: "draft" | "approved" } | null;
}) {
  const [score, setScore] = useState(review?.score?.toString() ?? "");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const parsed = score === "" ? null : Number(score);
  const changed = (review?.score ?? null) !== parsed;

  return (
    <section className="rounded-lg border border-line bg-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{row.agent}</h2>
        {review ? (
          review.status === "approved" ? <Badge tone="success">Approved · {review.score ?? "no score"}</Badge> : <Badge tone="warning">Draft · {review.score ?? "no score"}</Badge>
        ) : (
          <Badge>Not reviewed</Badge>
        )}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-x-4 gap-y-2 text-sm sm:grid-cols-6 xl:grid-cols-11">
        {METRICS.map(([key, label, kind]) => (
          <div key={key}>
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="font-medium tabular-nums">{formatCell(kind, row[key]) || (kind === "percent" ? "n/a" : "0")}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <label className="flex items-center gap-2 text-[13px] text-ink-2">
          Management score
          <Input type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} className="h-8 w-20 tabular-nums" aria-label={`Management score for ${row.agent}`} />
        </label>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={review ? "Reason for the change (required)" : "Comment (optional)"}
          aria-label="Reason or comment"
          className="h-8 min-w-60 flex-1"
        />
        <Button
          size="sm"
          pending={pending}
          disabled={!changed}
          onClick={() => startTransition(async () => setState(await saveScoreAction({ userId, type, day, score: parsed, reason })))}
        >
          Save score
        </Button>
        {review && review.status === "draft" && !changed ? (
          <Button size="sm" variant="primary" disabled={pending} onClick={() => startTransition(async () => setState(await approveReviewAction(review.id)))}>
            Approve
          </Button>
        ) : null}
        {state ? <FormMessage state={state} /> : null}
      </div>
      {review?.comment ? <p className="mt-2 text-[13px] text-ink-3">Latest note: {review.comment}</p> : null}
    </section>
  );
}
