"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";

const MAX_BYTES = 15 * 1024 * 1024;
const ACCEPTED = /\.(xlsx|xls|csv)$/i;

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

type Stage = { phase: "idle" } | { phase: "uploading"; percent: number } | { phase: "processing" };

export function UploadForm({ sources }: { sources: { id: string; name: string }[] }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "__new__");
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);

  const busy = stage.phase !== "idle";

  function pick(chosen: File | null) {
    setError(null);
    if (!chosen) return setFile(null);
    if (!ACCEPTED.test(chosen.name)) {
      setFile(null);
      return setError("That file type is not supported. Upload an Excel file (.xlsx or .xls) or a CSV file.");
    }
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      return setError(`That file is ${size(chosen.size)}. The largest supported lead file is 15 MB, so split it into smaller files.`);
    }
    setFile(chosen);
  }

  /**
   * XMLHttpRequest rather than fetch: it reports upload progress, so a large file
   * shows a moving bar instead of a frozen screen while the server reads it.
   */
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setStage({ phase: "uploading", percent: 0 });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/imports");
    xhr.timeout = 10 * 60 * 1000; // large files keep processing instead of failing
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const percent = Math.round((ev.loaded / ev.total) * 100);
      setStage(percent >= 100 ? { phase: "processing" } : { phase: "uploading", percent });
    };
    xhr.upload.onload = () => setStage({ phase: "processing" });
    xhr.onload = () => {
      let body: { id?: string; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* fall through to the generic message */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.id) {
        router.push(`/manage/imports/${body.id}`);
        return;
      }
      setError(body.error ?? "The upload failed. Try again.");
      setStage({ phase: "idle" });
    };
    xhr.onerror = () => {
      setError("The upload failed. Check your connection and try again.");
      setStage({ phase: "idle" });
    };
    xhr.ontimeout = () => {
      setError("The file took too long to process. Split it into smaller files and try again.");
      setStage({ phase: "idle" });
    };
    xhr.send(new FormData(formRef.current!));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-5">
      <Field label="Lead file" htmlFor="file" hint="Excel (.xlsx, .xls) or CSV, up to 15 MB and 20,000 rows.">
        <label
          htmlFor="file"
          className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-line-strong px-4 py-5 transition-colors hover:border-ink-3 hover:bg-hover/50"
        >
          <FileSpreadsheet className="size-5 shrink-0 text-ink-3" aria-hidden />
          <span className="min-w-0 text-sm">
            {file ? (
              <>
                <span className="block truncate font-medium text-ink">{file.name}</span>
                <span className="text-ink-3">{size(file.size)} · choose another file</span>
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
            disabled={busy}
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </label>
      </Field>

      <Field label="Lead source" htmlFor="sourceId" hint="Used to compare results by campaign or list provider.">
        <Select id="sourceId" name="sourceId" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={busy}>
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
          <Input id="newSource" name="newSource" required placeholder="e.g. Houston contractors, September" maxLength={120} disabled={busy} />
        </Field>
      ) : null}

      {busy ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-ink-2">
              {stage.phase === "uploading" ? `Uploading ${file?.name ?? "file"}...` : "Reading the file and checking every row..."}
            </span>
            <span className="tabular-nums text-ink-3">{stage.phase === "uploading" ? `${stage.percent}%` : "Almost there"}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={stage.phase === "uploading" ? stage.percent : undefined}>
            <div
              className={
                stage.phase === "uploading"
                  ? "h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                  : "h-full w-1/3 animate-[lf-slide_1.1s_ease-in-out_infinite] rounded-full bg-accent"
              }
              style={stage.phase === "uploading" ? { width: `${stage.percent}%` } : undefined}
            />
          </div>
          <p className="text-[13px] text-ink-3">Keep this tab open. Large files take a little longer while duplicates and phone numbers are checked.</p>
        </div>
      ) : null}

      <FormMessage state={error ? { error } : null} />
      <div>
        <Button type="submit" variant="primary" pending={busy} disabled={!file || busy}>
          Upload and map columns
        </Button>
      </div>
    </form>
  );
}
