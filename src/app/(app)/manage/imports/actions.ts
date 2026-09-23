"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { cancelImport, commitImport, reopenMapping, setBulkDecision, setRowDecision, validateImport } from "@/lib/leads/import";

export async function saveMappingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const importId = String(formData.get("importId") ?? "");
  try {
    const user = await authorize("leads.import");
    const mapping: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("map:") && typeof value === "string") mapping[key.slice(4)] = value;
    }
    await validateImport(importId, mapping, user.id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/manage/imports/${importId}`);
  redirect(`/manage/imports/${importId}`);
}

export async function setRowDecisionAction(importId: string, rowId: string, decision: string): Promise<ActionState> {
  try {
    await authorize("leads.import");
    await setRowDecision(importId, rowId, decision);
    revalidatePath(`/manage/imports/${importId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function setBulkDecisionAction(importId: string, issue: string, decision: string): Promise<ActionState> {
  try {
    await authorize("leads.import");
    await setBulkDecision(importId, issue, decision);
    revalidatePath(`/manage/imports/${importId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function reopenMappingAction(importId: string): Promise<ActionState> {
  try {
    await authorize("leads.import");
    await reopenMapping(importId);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/manage/imports/${importId}`);
  return { ok: true };
}

export async function cancelImportAction(importId: string): Promise<ActionState> {
  try {
    const user = await authorize("leads.import");
    await cancelImport(importId, user.id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath("/manage/imports");
  redirect("/manage/imports");
}

export async function commitImportAction(importId: string): Promise<ActionState> {
  try {
    const user = await authorize("leads.import");
    await commitImport(importId, user.id);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/manage/imports/${importId}`);
  revalidatePath("/manage/imports");
  return { ok: true };
}
