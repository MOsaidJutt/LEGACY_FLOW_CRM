"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Ban, Check, Copy, ExternalLink, Mail, Phone, PhoneCall } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, toneOf } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveOutcomeAction, startCallAction } from "../actions";

type Lead = {
  id: string;
  company: string | null;
  contactName: string | null;
  title: string | null;
  phone: string | null;
  hasValidPhone: boolean;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  industry: string | null;
  source: string | null;
  status: string;
  callCount: number;
  lastCalledAt: string | null;
  extra: { label: string; value: string }[];
};

type Disposition = { id: string; key: string; label: string; description: string | null; tone: string; requiresCallback: boolean };
type TimelineItem = { id: string; type: string; summary: string; notes: string | null; at: string; by: string | null };

const pad = (n: number) => String(n).padStart(2, "0");

function wallInput(date: Date, tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}`;
}

export function LeadWorkspace({
  lead,
  dispositions,
  timeline,
  dnc,
  pendingCallback,
  view,
  nextLeadId,
  tz,
  tzLabel,
}: {
  lead: Lead;
  dispositions: Disposition[];
  timeline: TimelineItem[];
  dnc: boolean;
  pendingCallback: { dueAt: string; note: string | null } | null;
  view: string;
  nextLeadId: string;
  tz: string;
  tzLabel: string;
}) {
  const [call, setCall] = useState<{ id: string; startedAt: number; method: string } | null>(null);
  const [callMessage, setCallMessage] = useState<{ tone: "info" | "danger"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [calling, startCalling] = useTransition();
  const [selected, setSelected] = useState<string>("");
  const [callbackAt, setCallbackAt] = useState("");
  const [state, formAction] = useActionState(saveOutcomeAction, null);
  const manualCopyRef = useRef<HTMLInputElement>(null);

  const disposition = dispositions.find((d) => d.id === selected);
  const callable = lead.hasValidPhone && !dnc;
  const title = lead.company || lead.contactName || "Unnamed lead";

  async function copyNumber(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
      return true;
    } catch {
      // clipboard blocked (e.g. insecure context): leave the number selected for Ctrl+C
      manualCopyRef.current?.select();
      return false;
    }
  }

  function onCall() {
    setCallMessage(null);
    startCalling(async () => {
      const result = await startCallAction(lead.id);
      if (!result.ok) {
        setCallMessage({ tone: "danger", text: result.error });
        return;
      }
      setCall({ id: result.callId, startedAt: new Date(result.startedAt).getTime(), method: result.plan.method });
      const copiedOk = await copyNumber(result.digits);
      if (result.plan.method === "url") {
        window.open(result.plan.url, "_blank", "noopener,noreferrer");
        setCallMessage({ tone: "info", text: "Opened in your dialer. The number is also on your clipboard." });
      } else if (result.plan.method === "dialer") {
        setCallMessage({ tone: "info", text: "VC Dialer is placing the call." });
      } else {
        setCallMessage({
          tone: "info",
          text: copiedOk
            ? `Number copied. Paste it into VC Dialer.${result.plan.reason ? ` (${result.plan.reason}.)` : ""}`
            : "Copy the selected number with Ctrl+C and paste it into VC Dialer.",
        });
      }
    });
  }

  // 1-9 picks an outcome, C starts the call, unless the user is typing
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || t.closest("input, textarea, select, [contenteditable]")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= dispositions.length) {
        setSelected(dispositions[n - 1].id);
        e.preventDefault();
      } else if ((e.key === "c" || e.key === "C") && callable && !calling) {
        onCall();
        e.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const presets = [
    { label: "In 1 hour", make: () => new Date(Date.now() + 3_600_000) },
    { label: "In 3 hours", make: () => new Date(Date.now() + 3 * 3_600_000) },
    {
      label: "Tomorrow 10:00",
      make: () => {
        const today = wallInput(new Date(Date.now() + 86_400_000), tz).slice(0, 10);
        return `${today}T10:00`;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-lg border border-line bg-raised">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
            <p className="mt-0.5 text-sm text-ink-2">
              {[lead.contactName && lead.company ? lead.contactName : null, lead.title].filter(Boolean).join(", ") || " "}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
              {lead.status === "follow_up" ? <Badge tone="info">Follow-up</Badge> : null}
              <span>
                {lead.callCount === 0 ? "Not called yet" : `${lead.callCount} ${lead.callCount === 1 ? "call" : "calls"}, last ${lead.lastCalledAt}`}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              <input
                ref={manualCopyRef}
                readOnly
                value={lead.phone ?? "No phone"}
                aria-label="Phone number"
                className="h-9 w-[11.5rem] rounded-md border border-transparent bg-transparent px-2 text-right font-mono text-[15px] tabular-nums text-ink focus-visible:border-line-strong"
              />
              {lead.phone && lead.hasValidPhone ? (
                <Button size="md" variant="ghost" onClick={() => void copyNumber(lead.phone!.replace(/\D/g, ""))} aria-label="Copy phone number" title="Copy number">
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                </Button>
              ) : null}
              <Button variant="primary" onClick={onCall} pending={calling} disabled={!callable} title="Call (C)">
                {!calling ? <PhoneCall aria-hidden /> : null}
                {call ? "Call again" : "Call"}
              </Button>
            </div>
            {call ? <CallTimer startedAt={call.startedAt} /> : null}
          </div>
        </div>

        {dnc ? (
          <p className="flex items-center gap-2 border-t border-line bg-danger-soft px-5 py-2.5 text-sm text-danger">
            <Ban className="size-4" aria-hidden /> This number is on the do-not-call list. Calling is blocked.
          </p>
        ) : !lead.hasValidPhone ? (
          <p className="flex items-center gap-2 border-t border-line bg-warning-soft px-5 py-2.5 text-sm text-ink">
            <Phone className="size-4 text-warning" aria-hidden /> No valid U.S. phone number on this lead. Record an outcome or ask Management to fix it.
          </p>
        ) : callMessage ? (
          <p role="status" className={cn("border-t border-line px-5 py-2.5 text-sm", callMessage.tone === "danger" ? "bg-danger-soft text-danger" : "bg-info-soft text-ink")}>
            {callMessage.text}
          </p>
        ) : null}

        <dl className="grid gap-x-6 gap-y-3 border-t border-line p-5 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <Detail label="Email">
            {lead.email ? (
              <a href={`mailto:${lead.email}`} className="inline-flex items-center gap-1.5 [overflow-wrap:anywhere] hover:underline">
                <Mail className="size-3.5 shrink-0 text-ink-3" aria-hidden />
                {lead.email}
              </a>
            ) : null}
          </Detail>
          <Detail label="Website">
            {lead.website ? (
              <a
                href={/^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 break-all hover:underline"
              >
                {lead.website.replace(/^https?:\/\/(www\.)?/i, "")}
                <ExternalLink className="size-3.5 shrink-0 text-ink-3" aria-hidden />
              </a>
            ) : null}
          </Detail>
          <Detail label="Location">{[lead.city, lead.state].filter(Boolean).join(", ")}</Detail>
          <Detail label="Industry">{lead.industry}</Detail>
          <Detail label="Source">{lead.source}</Detail>
          {lead.extra.map((x) => (
            <Detail key={x.label} label={x.label}>
              {x.value}
            </Detail>
          ))}
        </dl>
      </section>

      <section className="rounded-lg border border-line bg-raised">
        <form action={formAction}>
          <input type="hidden" name="leadId" value={lead.id} />
          <input type="hidden" name="callId" value={call?.id ?? ""} />
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="nextLeadId" value={nextLeadId} />
          <input type="hidden" name="dispositionId" value={selected} />

          <fieldset className="p-5">
            <legend className="float-left mb-3 flex w-full items-baseline justify-between text-[15px] font-semibold">
              Call outcome
              <span className="text-xs font-normal text-ink-3">Keys 1 to {dispositions.length}</span>
            </legend>
            {pendingCallback ? (
              <p className="clear-both mb-3 rounded-md bg-info-soft px-3 py-2 text-sm">
                Callback scheduled for <span className="font-medium">{pendingCallback.dueAt}</span>
                {pendingCallback.note ? `: ${pendingCallback.note}` : "."} Saving an outcome completes it.
              </p>
            ) : null}
            <div className="clear-both grid grid-cols-2 gap-2 md:grid-cols-3">
              {dispositions.map((d, i) => {
                const active = d.id === selected;
                return (
                  <button
                    key={d.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setSelected(d.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left text-sm transition-colors duration-150",
                      active ? "border-ink/60 bg-selected text-ink" : "border-line bg-bg/40 text-ink-2 hover:border-line-strong hover:text-ink",
                    )}
                  >
                    <span className="grid size-5 shrink-0 place-items-center rounded border border-line text-[11px] tabular-nums text-ink-3">{i + 1}</span>
                    <span className="flex-1 font-medium">{d.label}</span>
                    <ToneDot tone={d.tone} />
                  </button>
                );
              })}
            </div>
            {disposition?.description ? <p className="mt-2.5 text-[13px] text-ink-3">{disposition.description}</p> : null}

            {disposition?.requiresCallback ? (
              <div className="mt-4 flex flex-wrap items-end gap-3 rounded-md border border-line p-3">
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
                  Callback ({tzLabel})
                  <input
                    type="datetime-local"
                    name="callbackAt"
                    required
                    value={callbackAt}
                    min={wallInput(new Date(), tz)}
                    onChange={(e) => setCallbackAt(e.target.value)}
                    className="h-9 rounded-md border border-line-strong/70 bg-raised px-2.5 text-sm text-ink focus-visible:border-focus focus-visible:outline-offset-0"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {presets.map((p) => (
                    <Button
                      key={p.label}
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const v = p.make();
                        setCallbackAt(typeof v === "string" ? v : wallInput(v, tz));
                      }}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="mt-4 flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
              Notes
              <Textarea name="notes" rows={3} placeholder="What happened on the call?" />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <SubmitButton variant="primary" disabled={!selected}>
                Save outcome{nextLeadId ? " and next" : ""}
              </SubmitButton>
              <div className="min-w-0 flex-1">
                <FormMessage state={state} />
              </div>
            </div>
          </fieldset>
        </form>
      </section>

      <section className="rounded-lg border border-line bg-raised">
        <h3 className="border-b border-line px-5 py-3 text-[15px] font-semibold">History</h3>
        {timeline.length === 0 ? (
          <p className="px-5 py-6 text-sm text-ink-3">No activity yet.</p>
        ) : (
          <ol className="divide-y divide-line">
            {timeline.map((t) => (
              <li key={t.id} className="flex gap-4 px-5 py-3 text-sm">
                <span className="w-28 shrink-0 tabular-nums text-ink-3">{t.at}</span>
                <div className="min-w-0">
                  <p className="text-ink">
                    {t.summary}
                    {t.by ? <span className="text-ink-3"> · {t.by}</span> : null}
                  </p>
                  {t.notes ? <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{t.notes}</p> : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-ink">{children || <span className="text-ink-3">Not provided</span>}</dd>
    </div>
  );
}

function ToneDot({ tone }: { tone: string }) {
  const t = toneOf(tone);
  const color = { neutral: "bg-ink-3", success: "bg-success", warning: "bg-warning", danger: "bg-danger", info: "bg-info", accent: "bg-stone" }[t];
  return <span className={cn("size-2 shrink-0 rounded-full", color)} aria-hidden />;
}

function CallTimer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <p className="text-xs tabular-nums text-ink-3" aria-live="off">
      Call started {Math.floor(s / 60)}:{pad(s % 60)} ago
    </p>
  );
}
