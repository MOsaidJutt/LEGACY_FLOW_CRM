"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { assignSpecificLeads, decideLeadRequest, releaseLeads, setLeadDnc } from "@/lib/leads/assignment";

export async function decideRequestAction(input: { requestId: string; decision: "approve" | "reject"; qty?: number; note?: string }): Promise<ActionState> {
  try {
    const user = await authorize("leads.requests.decide");
    const note = input.note?.trim().slice(0, 500);
    const r = await decideLeadRequest({ requestId: input.requestId, actorId: user.id, decision: input.decision, qty: input.qty, note });
    revalidatePath("/manage/requests");
    return { ok: true, message: input.decision === "approve" ? `${r.assigned} leads assigned.` : "Request declined." };
  } catch (error) {
    return failure(error);
  }
}

export async function assignLeadsAction(input: { leadIds: string[]; agentId: string }): Promise<ActionState> {
  try {
    const user = await authorize("leads.manage");
    const r = await assignSpecificLeads({ leadIds: input.leadIds.slice(0, 1000), agentId: input.agentId, actorId: user.id });
    revalidatePath("/manage/leads");
    return { ok: true, message: `${r.moved} leads assigned${r.skipped ? `, ${r.skipped} skipped (already with that agent, closed or do-not-call)` : ""}.` };
  } catch (error) {
    return failure(error);
  }
}

export async function setDncAction(input: { leadId: string; dnc: boolean; reason: string }): Promise<ActionState> {
  try {
    const user = await authorize("leads.manage");
    const r = await setLeadDnc({ leadId: input.leadId, dnc: input.dnc, reason: input.reason.trim().slice(0, 500), actorId: user.id });
    revalidatePath(`/manage/leads/${input.leadId}`);
    return { ok: true, message: input.dnc ? `Number blocked on ${r.affected} ${r.affected === 1 ? "lead" : "leads"}.` : `Number unblocked; ${r.affected} ${r.affected === 1 ? "lead is" : "leads are"} back in the pool.` };
  } catch (error) {
    return failure(error);
  }
}

export async function releaseLeadsAction(input: { leadIds: string[] }): Promise<ActionState> {
  try {
    const user = await authorize("leads.manage");
    const r = await releaseLeads({ leadIds: input.leadIds.slice(0, 1000), actorId: user.id });
    revalidatePath("/manage/leads");
    return { ok: true, message: `${r.released} leads returned to the pool.` };
  } catch (error) {
    return failure(error);
  }
}
