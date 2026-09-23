"use client";

import { useActionState, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { createRoleAction, deleteRoleAction, saveRoleAction } from "../actions";

type Role = { id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean; users: number };
type Group = { group: string; items: { key: string; label: string }[] };

export function RoleEditor({ role, groups }: { role: Role; groups: Group[] }) {
  const [perms, setPerms] = useState(() => new Set(role.permissions));
  const [state, setState] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = perms.size !== role.permissions.length || role.permissions.some((p) => !perms.has(p));

  return (
    <section className="rounded-lg border border-line bg-raised">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            {role.name}
            {role.isSystem ? <Badge>Built-in</Badge> : null}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {role.description ? `${role.description} ` : ""}
            {role.users} {role.users === 1 ? "user" : "users"}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!role.isSystem && role.users === 0 ? (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => setState(await deleteRoleAction(role.id)))}>
              Delete role
            </Button>
          ) : null}
          <Button size="sm" variant="primary" disabled={!dirty} pending={pending} onClick={() => startTransition(async () => setState(await saveRoleAction(role.id, [...perms])))}>
            Save permissions
          </Button>
        </div>
      </div>
      <div className="grid gap-x-8 gap-y-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {groups.map((g) => (
          <fieldset key={g.group}>
            <legend className="mb-2 text-xs font-medium text-ink-3">{g.group}</legend>
            <div className="flex flex-col gap-2">
              {g.items.map((p) => (
                <label key={p.key} className="flex items-start gap-2.5 text-sm text-ink-2">
                  <Checkbox
                    className="mt-0.5"
                    checked={perms.has(p.key)}
                    onChange={(e) =>
                      setPerms((s) => {
                        const next = new Set(s);
                        if (e.target.checked) next.add(p.key);
                        else next.delete(p.key);
                        return next;
                      })
                    }
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      {state ? (
        <div className="px-4 pb-4">
          <FormMessage state={state} />
        </div>
      ) : null}
    </section>
  );
}

export function NewRoleForm({ roles }: { roles: { id: string; name: string }[] }) {
  const [state, action] = useActionState(createRoleAction, null);
  return (
    <form action={action} className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_12rem_auto]">
      <Field label="Name" htmlFor="role-name">
        <Input id="role-name" name="name" required placeholder="e.g. Team Lead" />
      </Field>
      <Field label="Description" htmlFor="role-desc">
        <Input id="role-desc" name="description" placeholder="Optional" />
      </Field>
      <Field label="Start from" htmlFor="role-base">
        <Select id="role-base" name="basedOn" defaultValue="">
          <option value="">No permissions</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton variant="primary">Create role</SubmitButton>
      <div className="sm:col-span-4">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
