"use server";

import { revalidatePath } from "next/cache";
import { authorize, failure, type ActionState } from "@/lib/actions";
import { salaryHistory, saveSalary } from "@/lib/salary";

export async function saveSalaryAction(input: {
  userId: string;
  period: string;
  basicSalary: number;
  bonus: number;
  otherDeduction: number;
  note: string;
  finalize: boolean;
}): Promise<ActionState> {
  try {
    const actor = await authorize("salary.manage");
    const result = await saveSalary({ ...input, actorId: actor.id });
    revalidatePath("/manage/salary");
    return {
      ok: true,
      message: `${input.finalize ? "Finalized" : "Saved"}: ${result.absentDays} absent day${result.absentDays === 1 ? "" : "s"}, payable PKR ${result.finalSalary.toLocaleString()}.`,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function salaryHistoryAction(userId: string) {
  try {
    await authorize("salary.manage");
    return { rows: await salaryHistory(userId) };
  } catch (error) {
    return { error: failure(error).error };
  }
}
