"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { sendFollowUpEmail } from "@/lib/leads/emails";

/** Sends the follow-up email and reports the outcome back to the Leads panel. */
export async function sendFollowUpEmailAction(input: { leadId: string; subject: string; body: string }): Promise<ActionState> {
  try {
    const actor = await authorize("leads.manage");
    const result = await sendFollowUpEmail({
      leadId: input.leadId,
      subject: input.subject,
      body: input.body,
      actorId: actor.id,
      actorName: actor.name,
    });
    revalidatePath(`/manage/leads/${input.leadId}`);
    revalidatePath("/manage/leads");
    if (result.status === "failed") {
      return { error: `The email was not sent: ${result.error} The lead has not been marked as contacted.` };
    }
    return { ok: true, message: `Follow-up email sent to ${result.to}. The assigned agent has been notified.` };
  } catch (error) {
    return failure(error);
  }
}
