"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { createGroupAction, deleteGroupAction, setGroupMembersAction } from "../actions";

type User = { id: string; name: string; role: string };

export function GroupCard({ group, members, users }: { group: { id: string; name: string; description: string | null }; members: string[]; users: User[] }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState(() => new Set(members));
  const [state, setState] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const names = users.filter((u) => members.includes(u.id));

  return (
    <section className="rounded-lg border border-line bg-raised">
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-[15px] font-semibold">{group.name}</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {group.description ? `${group.description} · ` : ""}
            {members.length} {members.length === 1 ? "member" : "members"}
          </p>
        </div>
        <div className="flex gap-1">
          <Button size="sm" onClick={() => setOpen(true)}>
            Edit members
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`Delete the group “${group.name}”? Messages already sent stay in place.`)) startTransition(async () => setState(await deleteGroupAction(group.id)));
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 p-4">
        {names.length === 0 ? <p className="text-sm text-ink-3">No members yet.</p> : null}
        {names.map((u) => (
          <span key={u.id} className="rounded bg-hover px-2 py-1 text-[13px] text-ink-2">
            {u.name}
          </span>
        ))}
      </div>
      {state?.error ? (
        <div className="px-4 pb-4">
          <FormMessage state={state} />
        </div>
      ) : null}

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Members of ${group.name}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              pending={pending}
              onClick={() =>
                startTransition(async () => {
                  const r = await setGroupMembersAction(group.id, [...chosen]);
                  setState(r);
                  if (!r?.error) setOpen(false);
                })
              }
            >
              Save members
            </Button>
          </>
        }
      >
        <ul className="flex flex-col gap-1">
          {users.map((u) => (
            <li key={u.id}>
              <label className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-hover">
                <Checkbox
                  checked={chosen.has(u.id)}
                  onChange={(e) =>
                    setChosen((s) => {
                      const next = new Set(s);
                      if (e.target.checked) next.add(u.id);
                      else next.delete(u.id);
                      return next;
                    })
                  }
                />
                <span className="flex-1">{u.name}</span>
                <span className="text-xs text-ink-3">{u.role}</span>
              </label>
            </li>
          ))}
        </ul>
      </Dialog>
    </section>
  );
}

export function NewGroupForm() {
  const [state, action] = useActionState(createGroupAction, null);
  return (
    <form action={action} className="grid items-end gap-4 sm:grid-cols-[1fr_1.5fr_auto]">
      <Field label="Name" htmlFor="g-name">
        <Input id="g-name" name="name" required placeholder="e.g. Senior Agents" />
      </Field>
      <Field label="Description" htmlFor="g-desc">
        <Input id="g-desc" name="description" placeholder="Optional" />
      </Field>
      <SubmitButton variant="primary">Create group</SubmitButton>
      <div className="sm:col-span-3">
        <FormMessage state={state} />
      </div>
    </form>
  );
}
