"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, failure, formString, type ActionState } from "@/lib/actions";
import { addLeadNote, saveOutcome, startCall } from "@/lib/leads/calls";
import { cancelLeadRequest, createLeadRequest } from "@/lib/leads/assignment";
import { getSettings } from "@/lib/settings";
import { parseWallInput } from "@/lib/time";
import type { DialPlan } from "@/lib/dialer";

export type StartCallResult =
  | { ok: true; callId: string; startedAt: string; plan: DialPlan; phone: string; digits: string }
  | { ok: false; error: string };

export async function startCallAction(leadId: string): Promise<StartCallResult> {
  try {
    const user = await authorize("leads.work");
    const r = await startCall(user, leadId);
    return { ok: true, callId: r.callId, startedAt: r.startedAt.toISOString(), plan: r.plan, phone: r.phone, digits: r.digits };
  } catch (error) {
    return failure(error);
  }
}

export async function saveOutcomeAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let nextUrl: string;
  try {
    const user = await authorize("leads.work");
    const settings = await getSettings();
    const leadId = formString(formData, "leadId");
    const callbackRaw = formString(formData, "callbackAt");
    const callbackAt = callbackRaw ? parseWallInput(settings.businessTimezone, callbackRaw) : null;
    if (callbackRaw && !callbackAt) return { error: "Enter a valid callback date and time." };

    await saveOutcome(user, {
      leadId,
      callId: formString(formData, "callId") || null,
      dispositionId: formString(formData, "dispositionId"),
      notes: formString(formData, "notes"),
      callbackAt,
    });

    const view = formString(formData, "view") || "assigned";
    const next = formString(formData, "nextLeadId");
    nextUrl = `/agent/calls?view=${encodeURIComponent(view)}${next && next !== leadId ? `&lead=${encodeURIComponent(next)}` : ""}&saved=1`;
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/agent", "layout");
  redirect(nextUrl);
}

export async function addNoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize("leads.work");
    await addLeadNote(user.id, formString(formData, "leadId"), formString(formData, "note"));
    revalidatePath("/agent/calls");
    return { ok: true, message: "Note added." };
  } catch (error) {
    return failure(error);
  }
}

export async function requestLeadsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const user = await authorize("leads.request");
    const qty = Number(formString(formData, "qty"));
    await createLeadRequest(user.id, user.sessionId, qty);
    revalidatePath("/agent/request");
    return { ok: true, message: "Request sent to Management." };
  } catch (error) {
    return failure(error);
  }
}

export async function cancelRequestAction(requestId: string): Promise<ActionState> {
  try {
    const user = await authorize("leads.request");
    await cancelLeadRequest(user.id, requestId);
    revalidatePath("/agent/request");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
