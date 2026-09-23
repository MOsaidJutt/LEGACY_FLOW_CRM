"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";

export function UploadForm({ sources }: { sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "__new__");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const res = await fetch("/api/imports", { method: "POST", body: new FormData(e.currentTarget) });
      const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !body.id) {
        setError(body.error ?? "The upload failed. Try again.");
        setPending(false);
        return;
      }
      router.push(`/manage/imports/${body.id}`);
    } catch {
      setError("The upload failed. Check your connection and try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label="Lead file" htmlFor="file" hint="Excel (.xlsx) or CSV, up to 15 MB and 20,000 rows.">
        <label
          htmlFor="file"
          className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-5 transition-colors hover:border-ink-3 hover:bg-hover/50"
        >
          <FileSpreadsheet className="size-5 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 text-sm">
            {file ? (
              <>
                <span className="block truncate font-medium text-ink">{file.name}</span>
                <span className="text-ink-3">{(file.size / 1024).toFixed(0)} KB · choose another file</span>
              </>
            ) : (
              <span className="text-ink-2">Choose a file</span>
            )}
          </span>
          <input
            id="file"
            name="file"
            type="file"
            required
            accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </Field>

      <Field label="Lead source" htmlFor="sourceId" hint="Used to compare results by campaign or list provider.">
        <Select id="sourceId" name="sourceId" value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="__new__">New source...</option>
        </Select>
      </Field>
      {sourceId === "__new__" ? (
        <Field label="New source name" htmlFor="newSource">
          <Input id="newSource" name="newSource" required placeholder="e.g. Houston contractors, September" maxLength={120} />
        </Field>
      ) : null}

      <FormMessage state={error ? { error } : null} />
      <div>
        <Button type="submit" variant="primary" pending={pending} disabled={!file}>
          Upload and map columns
        </Button>
      </div>
    </form>
  );
}
