"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, formString, type ActionState } from "@/lib/actions";
import { audit, diff } from "@/lib/audit";
import { notify } from "@/lib/notify";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);

export async function saveProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const userId = uuid(formString(formData, "userId"));
    if (!userId) return { error: "Employee not found." };
    const joining = formString(formData, "joiningDate");
    if (joining && !DAY.test(joining)) return { error: "Enter a valid joining date." };
    const next = {
      employeeCode: formString(formData, "employeeCode").slice(0, 40) || null,
      phone: formString(formData, "phone").slice(0, 40) || null,
      personalEmail: formString(formData, "personalEmail").slice(0, 200) || null,
      joiningDate: joining || null,
      jobTitle: formString(formData, "jobTitle").slice(0, 120) || null,
      department: formString(formData, "department").slice(0, 120) || null,
      address: formString(formData, "address").slice(0, 1000) || null,
      emergencyContact: formString(formData, "emergencyContact").slice(0, 500) || null,
      notes: formString(formData, "notes").slice(0, 4000) || null,
    };
    if (next.employeeCode) {
      const [taken] = await db.select({ userId: schema.employeeProfiles.userId }).from(schema.employeeProfiles).where(eq(schema.employeeProfiles.employeeCode, next.employeeCode));
      if (taken && taken.userId !== userId) return { error: "Another employee already has this employee ID." };
    }
    const [before] = await db.select().from(schema.employeeProfiles).where(eq(schema.employeeProfiles.userId, userId));
    await db.insert(schema.employeeProfiles).values({ userId, ...next }).onConflictDoUpdate({ target: schema.employeeProfiles.userId, set: next });
    const d = diff((before ?? {}) as Record<string, unknown>, next);
    if (d.changed) await audit({ actorId: actor.id, action: "employee_profile_updated", module: "hr", entityType: "user", entityId: userId, before: d.before, after: d.after });
    revalidatePath(`/hr/employees/${userId}`);
    return { ok: true, message: "Profile saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function addEmployeeEventAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const userId = uuid(formString(formData, "userId"));
    const kind = formString(formData, "kind");
    const title = formString(formData, "title").slice(0, 200);
    if (!userId) return { error: "Employee not found." };
    if (!["warning", "review", "change", "note"].includes(kind)) return { error: "Choose a record type." };
    if (title.length < 3) return { error: "Add a short title." };
    const [row] = await db
      .insert(schema.employeeEvents)
      .values({ userId, kind, title, details: formString(formData, "details").slice(0, 4000) || null, createdBy: actor.id })
      .returning({ id: schema.employeeEvents.id });
    await audit({ actorId: actor.id, action: "employee_record_added", module: "hr", entityType: "employee_event", entityId: row.id, after: { userId, kind, title } });
    revalidatePath(`/hr/employees/${userId}`);
    return { ok: true, message: "Record added." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteDocumentAction(documentId: string): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const [doc] = await db.delete(schema.hrDocuments).where(eq(schema.hrDocuments.id, documentId)).returning();
    if (!doc) return { error: "Document not found." };
    await db.delete(schema.files).where(eq(schema.files.id, doc.fileId));
    await audit({ actorId: actor.id, action: "hr_document_deleted", module: "hr", entityType: "hr_document", entityId: documentId, before: { userId: doc.userId, title: doc.title, category: doc.category } });
    revalidatePath(`/hr/employees/${doc.userId}`);
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ leave */

export async function recordLeaveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const userId = uuid(formString(formData, "userId"));
    const leaveTypeId = uuid(formString(formData, "leaveTypeId"));
    const startDate = formString(formData, "startDate");
    const endDate = formString(formData, "endDate");
    const status = formString(formData, "status") === "pending" ? "pending" : "approved";
    if (!userId || !leaveTypeId) return { error: "Choose the employee and leave type." };
    if (!DAY.test(startDate) || !DAY.test(endDate) || endDate < startDate) return { error: "Enter a valid date range." };
    const [row] = await db
      .insert(schema.leaveRequests)
      .values({
        userId,
        leaveTypeId,
        startDate,
        endDate,
        reason: formString(formData, "reason").slice(0, 1000) || null,
        status,
        decidedBy: status === "approved" ? actor.id : null,
        decidedAt: status === "approved" ? new Date() : null,
      })
      .returning({ id: schema.leaveRequests.id });
    await audit({ actorId: actor.id, action: "leave_recorded", module: "hr", entityType: "leave", entityId: row.id, after: { userId, startDate, endDate, status } });
    if (status === "approved") await notify(db, [userId], { type: "hr", title: `Leave recorded: ${startDate}${endDate !== startDate ? ` to ${endDate}` : ""}`, link: "/notifications" });
    revalidatePath("/hr/leave");
    return { ok: true, message: "Leave saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function decideLeaveAction(id: string, decision: "approved" | "rejected", comment: string): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const [row] = await db
      .update(schema.leaveRequests)
      .set({ status: decision, decidedBy: actor.id, decidedAt: new Date(), comment: comment.trim().slice(0, 500) || null })
      .where(and(eq(schema.leaveRequests.id, id), eq(schema.leaveRequests.status, "pending")))
      .returning();
    if (!row) return { error: "This leave request was already decided." };
    await audit({ actorId: actor.id, action: `leave_${decision}`, module: "hr", entityType: "leave", entityId: id, after: { comment } });
    await notify(db, [row.userId], {
      type: "hr",
      title: `Leave ${decision === "approved" ? "approved" : "declined"}: ${row.startDate}${row.endDate !== row.startDate ? ` to ${row.endDate}` : ""}`,
      body: comment || undefined,
    });
    revalidatePath("/hr/leave");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function addHolidayAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const date = formString(formData, "date");
    const name = formString(formData, "name").slice(0, 120);
    if (!DAY.test(date) || name.length < 2) return { error: "Enter a date and a name." };
    await db.insert(schema.holidays).values({ date, name }).onConflictDoUpdate({ target: schema.holidays.date, set: { name } });
    await audit({ actorId: actor.id, action: "holiday_saved", module: "hr", entityType: "holiday", entityId: date, after: { name } });
    revalidatePath("/hr/leave");
    return { ok: true, message: "Holiday saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteHolidayAction(id: string): Promise<ActionState> {
  try {
    const actor = await authorize("hr.manage");
    const [h] = await db.delete(schema.holidays).where(eq(schema.holidays.id, id)).returning();
    if (h) await audit({ actorId: actor.id, action: "holiday_deleted", module: "hr", entityType: "holiday", entityId: h.date, before: { name: h.name } });
    revalidatePath("/hr/leave");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
