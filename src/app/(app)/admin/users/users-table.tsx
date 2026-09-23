"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { Check, Copy, KeyRound, LogOut, Pencil, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { FormMessage } from "@/components/ui/form-message";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { resetPasswordAction, saveUserAction, signOutUserAction, type UserFormState } from "../actions";

type Row = {
  id: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  roleId: string;
  roleName: string;
  shiftId: string | null;
  lastLogin: string | null;
  mustChangePassword: boolean;
  openSessions: number;
};
type Option = { id: string; name: string };

export function UsersTable({ rows, roles, shifts, meId }: { rows: Row[]; roles: Option[]; shifts: Option[]; meId: string }) {
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [message, setMessage] = useState<{ ok?: boolean; error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <FormMessage state={message} />
        <Button variant="primary" className="ml-auto" onClick={() => setEditing("new")}>
          <UserPlus aria-hidden /> Add user
        </Button>
      </div>

      <section className="rounded-lg border border-line bg-raised">
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              <Th className="text-right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id} className={r.status === "inactive" ? "opacity-60" : undefined}>
                <Td className="font-medium">
                  {r.name}
                  {r.id === meId ? <span className="ml-1.5 text-xs font-normal text-ink-3">(you)</span> : null}
                </Td>
                <Td className="text-ink-2">{r.email}</Td>
                <Td>{r.roleName}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {r.status === "active" ? <Badge tone="success">Active</Badge> : <Badge>Deactivated</Badge>}
                    {r.mustChangePassword && r.status === "active" ? <Badge tone="warning">Temporary password</Badge> : null}
                    {r.openSessions > 0 ? <Badge tone="info">Signed in</Badge> : null}
                  </div>
                </Td>
                <Td className="whitespace-nowrap tabular-nums text-ink-2">{r.lastLogin ?? <span className="text-ink-3">Never</span>}</Td>
                <Td className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label={`Edit ${r.name}`} title="Edit">
                      <Pencil aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending || r.status === "inactive"}
                      title="Reset password"
                      aria-label={`Reset password for ${r.name}`}
                      onClick={() => {
                        if (!window.confirm(`Reset ${r.name}'s password? They will be signed out and must choose a new password.`)) return;
                        startTransition(async () => {
                          const res = await resetPasswordAction(r.id);
                          if (res?.password) setSecret({ email: r.email, password: res.password });
                          else setMessage(res);
                        });
                      }}
                    >
                      <KeyRound aria-hidden />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending || r.openSessions === 0 || r.id === meId}
                      title="Sign out everywhere"
                      aria-label={`Sign ${r.name} out everywhere`}
                      onClick={() => startTransition(async () => setMessage(await signOutUserAction(r.id)))}
                    >
                      <LogOut aria-hidden />
                    </Button>
                  </div>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>

      <UserDialog
        key={editing === "new" ? "new" : (editing?.id ?? "closed")}
        user={editing}
        roles={roles}
        shifts={shifts}
        onClose={() => setEditing(null)}
        onCreated={(email, password) => {
          setEditing(null);
          setSecret({ email, password });
        }}
      />

      <Dialog open={Boolean(secret)} onClose={() => setSecret(null)} title="Temporary password" description="Share it with the person privately. It is shown only once." footer={<Button onClick={() => setSecret(null)}>Done</Button>}>
        {secret ? <SecretBox email={secret.email} password={secret.password} /> : null}
      </Dialog>
    </div>
  );
}

function UserDialog({
  user,
  roles,
  shifts,
  onClose,
  onCreated,
}: {
  user: Row | "new" | null;
  roles: Option[];
  shifts: Option[];
  onClose: () => void;
  onCreated: (email: string, password: string) => void;
}) {
  const [state, action] = useActionState<UserFormState, FormData>(saveUserAction, null);
  const existing = user && user !== "new" ? user : null;

  useEffect(() => {
    if (state?.password && state.email) onCreated(state.email, state.password);
    else if (state?.ok && existing) onClose();
  }, [state, existing, onClose, onCreated]);

  return (
    <Dialog open={Boolean(user)} onClose={onClose} title={existing ? `Edit ${existing.name}` : "Add user"}>
      <form action={action} className="flex flex-col gap-4">
        {existing ? <input type="hidden" name="id" value={existing.id} /> : null}
        <Field label="Full name" htmlFor="u-name">
          <Input id="u-name" name="name" required defaultValue={existing?.name} autoComplete="off" />
        </Field>
        <Field label="Email" htmlFor="u-email" hint="Used to sign in.">
          <Input id="u-email" name="email" type="email" required defaultValue={existing?.email} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role" htmlFor="u-role">
            <Select id="u-role" name="roleId" required defaultValue={existing?.roleId ?? roles.find((r) => r.name === "Agent")?.id}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Shift" htmlFor="u-shift">
            <Select id="u-shift" name="shiftId" defaultValue={existing?.shiftId ?? ""}>
              <option value="">No shift</option>
              {shifts.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {existing ? (
          <Field label="Status" htmlFor="u-status" hint="Deactivating signs the person out and returns their working leads to the pool.">
            <Select id="u-status" name="status" defaultValue={existing.status}>
              <option value="active">Active</option>
              <option value="inactive">Deactivated</option>
            </Select>
          </Field>
        ) : null}
        <FormMessage state={state?.error ? state : null} />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <SubmitButton variant="primary">{existing ? "Save changes" : "Create account"}</SubmitButton>
        </div>
      </form>
    </Dialog>
  );
}

function SecretBox({ email, password }: { email: string; password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
        <dt className="text-ink-3">Email</dt>
        <dd>{email}</dd>
        <dt className="text-ink-3">Password</dt>
        <dd className="font-mono text-base tracking-wide">{password}</dd>
      </dl>
      <div>
        <Button
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(`Legacy Flow sign-in\nEmail: ${email}\nTemporary password: ${password}`).catch(() => {});
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy sign-in details"}
        </Button>
      </div>
    </div>
  );
}
