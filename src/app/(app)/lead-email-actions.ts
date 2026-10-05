"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { sendFollowUpEmail } from "@/lib/leads/emails";

/**
 * Sends a follow-up email to a lead. Management can email any lead; an agent can
 * email a lead that is assigned to them.
 */
export async function sendFollowUpEmailAction(input: { leadId: string; subject: string; body: string; to?: string }): Promise<ActionState> {
  try {
    const actor = await authorize("leads.manage", "leads.work");
    const manages = actor.permissions.includes("leads.manage");
    const result = await sendFollowUpEmail({
      leadId: input.leadId,
      subject: input.subject,
      body: input.body,
      to: input.to,
      actorId: actor.id,
      actorName: actor.name,
      restrictToAgentId: manages ? undefined : actor.id,
    });
    revalidatePath(`/manage/leads/${input.leadId}`);
    revalidatePath("/manage/leads");
    revalidatePath("/manage/emails");
    revalidatePath("/agent/calls");
    if (result.status === "failed") {
      return { error: `The email was not sent: ${result.error} The lead has not been marked as contacted.` };
    }
    return {
      ok: true,
      message: manages
        ? `Email sent to ${result.to}. The assigned agent has been notified.`
        : `Email sent to ${result.to}. It is recorded on this lead for Management to see.`,
    };
  } catch (error) {
    return failure(error);
  }
}
