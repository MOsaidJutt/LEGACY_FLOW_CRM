"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, SendHorizontal, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { openDirectAction } from "./actions";

export function NewConversation({ people }: { people: { id: string; name: string; role: string }[] }) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <Button variant="ghost" className="w-full justify-start" onClick={() => setOpen(true)}>
        <SquarePen aria-hidden /> New message
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-1">
      <div className="flex gap-2">
        <Select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Send a message to" className="h-8 flex-1 text-[13px]" autoFocus>
          <option value="">Message to...</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.role})
            </option>
          ))}
        </Select>
        <Button size="sm" variant="primary" disabled={!person} pending={pending} onClick={() => startTransition(async () => setError((await openDirectAction(person))?.error ?? null))}>
          Open
        </Button>
        <Button size="sm" variant="ghost" aria-label="Cancel" onClick={() => setOpen(false)}>
          <X aria-hidden />
        </Button>
      </div>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

export function Composer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (sending || (!body.trim() && !file)) return;
    setSending(true);
    setError(null);
    const data = new FormData();
    data.set("conversationId", conversationId);
    data.set("body", body);
    if (file) data.set("file", file);
    const res = await fetch("/api/messages", { method: "POST", body: data }).catch(() => null);
    const json = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setSending(false);
    if (!res?.ok) return setError(json?.error ?? "The message was not sent.");
    setBody("");
    setFile(null);
    formRef.current?.reset();
    router.refresh();
  }

  return (
    <form
      ref={formRef}
      className="border-t border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {file ? (
        <p className="mb-2 inline-flex items-center gap-2 rounded-md bg-hover px-2 py-1 text-[13px]">
          <Paperclip className="size-3.5 text-ink-3" aria-hidden />
          {file.name}
          <button type="button" aria-label="Remove attachment" onClick={() => setFile(null)} className="text-ink-3 hover:text-ink">
            <X className="size-3.5" aria-hidden />
          </button>
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <label className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md text-ink-3 hover:bg-hover hover:text-ink" title="Attach a file">
          <Paperclip className="size-4" aria-hidden />
          <span className="sr-only">Attach a file</span>
          <input type="file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xlsx,.csv,.txt" />
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Write a message. Enter sends, Shift+Enter adds a line."
          aria-label="Message"
          className="max-h-40 min-h-9 flex-1 resize-y rounded-md border border-line-strong/70 bg-raised px-3 py-2 text-sm text-ink focus-visible:border-focus focus-visible:outline-offset-0"
        />
        <Button type="submit" variant="primary" pending={sending} disabled={!body.trim() && !file} aria-label="Send message">
          {!sending ? <SendHorizontal aria-hidden /> : null}
          Send
        </Button>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
    </form>
  );
}
