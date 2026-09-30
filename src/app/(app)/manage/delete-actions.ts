"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { deleteImport, deleteSourceLeads, importDeletionSummary, sourceDeletionSummary, type DeletionSummary } from "@/lib/leads/delete";

export type SummaryState = { summary?: DeletionSummary; error?: string };

/** What would be removed, fetched before the confirmation is shown. */
export async function importSummaryAction(importId: string): Promise<SummaryState> {
  try {
    await authorize("leads.import");
    return { summary: await importDeletionSummary(importId) };
  } catch (error) {
    return { error: failure(error).error };
  }
}

export async function sourceSummaryAction(sourceId: string): Promise<SummaryState> {
  try {
    await authorize("leads.import");
    return { summary: await sourceDeletionSummary(sourceId) };
  } catch (error) {
    return { error: failure(error).error };
  }
}

/** Deletes an uploaded file, and its leads when asked. Permanent. */
export async function deleteImportAction(input: { importId: string; deleteLeads: boolean }): Promise<ActionState> {
  try {
    const actor = await authorize("leads.import");
    const result = await deleteImport({ importId: input.importId, deleteLeads: input.deleteLeads, actorId: actor.id });
    revalidatePath("/manage/imports");
    revalidatePath("/manage/leads");
    return {
      ok: true,
      message: input.deleteLeads
        ? `Deleted "${result.label}" and ${result.leadsDeleted.toLocaleString()} lead${result.leadsDeleted === 1 ? "" : "s"}.`
        : `Deleted the file record for "${result.label}". Its leads were kept.`,
    };
  } catch (error) {
    return failure(error);
  }
}

/** Deletes a whole imported lead database (campaign). Permanent. */
export async function deleteLeadDatabaseAction(input: { sourceId: string; removeSource: boolean }): Promise<ActionState> {
  try {
    const actor = await authorize("leads.import");
    const result = await deleteSourceLeads({ sourceId: input.sourceId, actorId: actor.id, removeSource: input.removeSource });
    revalidatePath("/manage/leads");
    revalidatePath("/manage/imports");
    return {
      ok: true,
      message: `Deleted ${result.leadsDeleted.toLocaleString()} lead${result.leadsDeleted === 1 ? "" : "s"} and ${result.filesDeleted} file${result.filesDeleted === 1 ? "" : "s"} from "${result.label}".`,
    };
  } catch (error) {
    return failure(error);
  }
}
