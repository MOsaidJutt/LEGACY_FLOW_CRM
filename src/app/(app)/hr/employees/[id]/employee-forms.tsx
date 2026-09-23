"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { addEmployeeEventAction, deleteDocumentAction, saveProfileAction } from "../../actions";

type Profile = Record<"employeeCode" | "phone" | "personalEmail" | "joiningDate" | "jobTitle" | "department" | "address" | "emergencyContact" | "notes", string>;

export function ProfileForm({ userId, profile: p }: { userId: string; profile: Profile }) {
  const [state, action] = useActionState(saveProfileAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <input type="hidden" name="userId" value={userId} />
      <Field label="Employee ID" htmlFor="employeeCode">
        <Input id="employeeCode" name="employeeCode" defaultValue={p.employeeCode} />
      </Field>
      <Field label="Job title" htmlFor="jobTitle">
        <Input id="jobTitle" name="jobTitle" defaultValue={p.jobTitle} />
      </Field>
      <Field label="Department / team" htmlFor="department">
        <Input id="department" name="department" defaultValue={p.department} />
      </Field>
      <Field label="Joining date" htmlFor="joiningDate">
        <Input id="joiningDate" name="joiningDate" type="date" defaultValue={p.joiningDate} />
      </Field>
      <Field label="Phone" htmlFor="phone">
        <Input id="phone" name="phone" type="tel" defaultValue={p.phone} />
      </Field>
      <Field label="Personal email" htmlFor="personalEmail">
        <Input id="personalEmail" name="personalEmail" type="email" defaultValue={p.personalEmail} />
      </Field>
      <Field label="Address" htmlFor="address" className="sm:col-span-2 xl:col-span-3">
        <Input id="address" name="address" defaultValue={p.address} />
      </Field>
      <Field label="Emergency contact" htmlFor="emergencyContact" className="sm:col-span-2 xl:col-span-1">
        <Textarea id="emergencyContact" name="emergencyContact" rows={2} defaultValue={p.emergencyContact} />
      </Field>
      <Field label="HR notes" htmlFor="notes" className="sm:col-span-2">
        <Textarea id="notes" name="notes" rows={2} defaultValue={p.notes} />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 xl:col-span-3">
        <SubmitButton variant="primary">Save profile</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

type Doc = { id: string; category: string; title: string; notes: string | null; expiresOn: string | null; expired: boolean; uploaded: string; fileName: string; size: number };

export function DocumentList({ docs }: { docs: Doc[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!docs.length) return <p className="text-sm text-ink-3">No documents uploaded yet.</p>;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {docs.map((d) => (
        <li key={d.id} className="flex items-start gap-3 py-3 first:pt-0">
          <FileText className="mt-0.5 size-4 shrink-0 text-ink-3" aria-hidden />
          <div className="min-w-0 flex-1 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{d.title}</span>
              <Badge>{d.category}</Badge>
              {d.expiresOn ? <Badge tone={d.expired ? "danger" : "neutral"}>{d.expired ? "Expired" : "Expires"} {d.expiresOn}</Badge> : null}
            </p>
            {d.notes ? <p className="mt-0.5 text-ink-2">{d.notes}</p> : null}
            <p className="mt-0.5 text-xs text-ink-3">
              {d.fileName} · {(d.size / 1024).toFixed(0)} KB · {d.uploaded}
            </p>
          </div>
          <a href={`/api/hr/documents/${d.id}`} className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-ink" aria-label={`Download ${d.title}`} title="Download">
            <Download className="size-4" aria-hidden />
          </a>
          <button
            type="button"
            disabled={pending}
            aria-label={`Delete ${d.title}`}
            title="Delete"
            className="rounded-md p-1.5 text-ink-3 hover:bg-hover hover:text-danger disabled:opacity-50"
            onClick={() => {
              if (window.confirm(`Delete “${d.title}”? This cannot be undone.`)) startTransition(async () => setError((await deleteDocumentAction(d.id))?.error ?? null));
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </li>
      ))}
      {error ? <li className="py-2 text-sm text-danger">{error}</li> : null}
    </ul>
  );
}

export function DocumentUpload({ userId, categories }: { userId: string; categories: string[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<{ error?: string; message?: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setState(null);
    const res = await fetch("/api/hr/documents", { method: "POST", body: new FormData(e.currentTarget) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { error?: string } | undefined;
    setPending(false);
    if (!res?.ok) return setState({ error: body?.error ?? "The upload failed. Try again." });
    formRef.current?.reset();
    setState({ message: "Document uploaded." });
    router.refresh();
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="userId" value={userId} />
      <Field label="Type" htmlFor="doc-cat">
        <Select id="doc-cat" name="category" required>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title" htmlFor="doc-title">
        <Input id="doc-title" name="title" required placeholder="e.g. Signed employment agreement" />
      </Field>
      <Field label="File" htmlFor="doc-file" hint="PDF, image or Word document, up to 10 MB.">
        <Input id="doc-file" name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx" className="py-1.5 file:mr-3 file:rounded file:border-0 file:bg-hover file:px-2 file:py-1 file:text-[13px] file:text-ink" />
      </Field>
      <Field label="Expiry or renewal date" htmlFor="doc-exp" hint="Optional.">
        <Input id="doc-exp" name="expiresOn" type="date" />
      </Field>
      <Field label="Notes" htmlFor="doc-notes" className="sm:col-span-2">
        <Input id="doc-notes" name="notes" placeholder="Optional" />
      </Field>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" pending={pending}>
          Upload document
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function EventForm({ userId }: { userId: string }) {
  const [state, action] = useActionState(addEmployeeEventAction, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[9rem_1fr]">
      <input type="hidden" name="userId" value={userId} />
      <Select name="kind" aria-label="Record type" defaultValue="note">
        <option value="note">Note</option>
        <option value="warning">Warning</option>
        <option value="review">Review</option>
        <option value="change">Role or pay change</option>
      </Select>
      <Input name="title" required placeholder="Title, e.g. Verbal warning for late arrival" aria-label="Title" />
      <Textarea name="details" rows={2} placeholder="Details (optional)" aria-label="Details" className="sm:col-span-2" />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <SubmitButton>Add to history</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
