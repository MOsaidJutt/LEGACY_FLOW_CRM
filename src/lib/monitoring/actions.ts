"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { getSettings } from "@/lib/settings";
import { setBreak } from "./presence";

export async function startBreak(breakType: string): Promise<ActionState> {
  try {
    const user = await authorize();
    const settings = await getSettings();
    if (!settings.breakTypes.some((b) => b.key === breakType)) return { error: "Choose a break type." };
    await setBreak(user.id, user.sessionId, breakType);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function endBreak(): Promise<ActionState> {
  try {
    const user = await authorize();
    await setBreak(user.id, user.sessionId, null);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
