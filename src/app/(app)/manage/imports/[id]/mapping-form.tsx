"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { NEW_FIELD } from "@/lib/leads/import-labels";
import { cancelImportAction, saveMappingAction } from "../actions";

type Column = { header: string; samples: string[]; value: string };
type Option = { value: string; label: string; group: string };

export function MappingForm({ importId, rows, columns, options }: { importId: string; rows: number; columns: Column[]; options: Option[] }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(columns.map((c) => [c.header, c.value])));
  const [state, action] = useActionState(saveMappingAction, null);

  const used = Object.values(values).filter((v) => v && v !== NEW_FIELD);
  const duplicates = new Set(used.filter((v, i) => used.indexOf(v) !== i));
  const groups = [...new Set(options.map((o) => o.group))];
  const hasKey = used.some((v) => ["phone", "company", "contact_name", "first_name", "last_name"].includes(v));

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="importId" value={importId} />
      <section className="rounded-lg border border-line bg-raised">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[15px] font-semibold">Match {columns.length} columns to CRM fields</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            Suggestions are filled in from the column names. Choose Ignore for columns you do not need, or keep one as a new custom field.
          </p>
        </div>
        <Table>
          <thead>
            <tr>
              <Th className="w-[28%]">Uploaded column</Th>
              <Th>Sample values</Th>
              <Th className="w-[30%]">CRM field</Th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => {
              const v = values[c.header];
              const dup = v && duplicates.has(v);
              return (
                <Tr key={c.header}>
                  <Td className="font-medium">{c.header}</Td>
                  <Td className="max-w-0 text-ink-2">
                    <span className="block truncate">{c.samples.join("  ·  ") || <span className="text-ink-3">empty in the first rows</span>}</span>
                  </Td>
                  <Td>
                    <Select
                      name={`map:${c.header}`}
                      value={v}
                      aria-label={`CRM field for ${c.header}`}
                      aria-invalid={dup || undefined}
                      onChange={(e) => setValues((all) => ({ ...all, [c.header]: e.target.value }))}
                      className={v ? undefined : "text-ink-3"}
                    >
                      <option value="">Ignore this column</option>
                      {groups.map((g) => (
                        <optgroup key={g} label={g}>
                          {options
                            .filter((o) => o.group === g)
                            .map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                        </optgroup>
                      ))}
                      <option value={NEW_FIELD}>New custom field “{c.header.slice(0, 30)}”</option>
                    </Select>
                    {dup ? <p className="mt-1 text-xs text-danger">Another column already uses this field.</p> : null}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="primary" disabled={duplicates.size > 0 || !hasKey}>
          Check {rows.toLocaleString()} rows
        </SubmitButton>
        <Button variant="ghost" onClick={() => void cancelImportAction(importId)}>
          Cancel import
        </Button>
        {!hasKey ? <span className="text-sm text-warning">Map the phone, company or contact column to continue.</span> : null}
      </div>
      <FormMessage state={state} />
    </form>
  );
}
