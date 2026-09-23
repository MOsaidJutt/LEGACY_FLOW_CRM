"use server";

import { redirect } from "next/navigation";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { getOrCreateDirect } from "@/lib/messages";

export async function openDirectAction(otherUserId: string): Promise<ActionState> {
  let id: string;
  try {
    const user = await authorize("messages.use");
    id = await getOrCreateDirect(user.id, otherUserId);
  } catch (error) {
    return failure(error);
  }
  redirect(`/messages?c=${id}`);
}
