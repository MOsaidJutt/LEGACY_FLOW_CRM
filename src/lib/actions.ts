import "server-only";
import { getCurrentUser } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  fieldErrors?: Record<string, string>;
} | null;

/** Thrown for expected, user-facing failures inside server actions. */
export class ActionError extends Error {}

/** Every server action starts here: re-checks the session and permission server-side. */
export async function authorize(...anyOf: Permission[]) {
  const user = await getCurrentUser();
  if (!user) throw new ActionError("Your session has ended. Sign in again to continue.");
  if (anyOf.length && !anyOf.some((p) => user.permissions.includes(p))) {
    throw new ActionError("You do not have permission to do that.");
  }
  return user;
}

export function failure(error: unknown): { ok: false; error: string } {
  if (error instanceof ActionError) return { ok: false, error: error.message };
  console.error("[action]", error);
  return { ok: false, error: "Something went wrong. Try again, and tell an admin if it keeps happening." };
}

export function formString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}
