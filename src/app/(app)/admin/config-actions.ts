"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, formString, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { readSettings, saveSetting, type BreakType, type DialerSettings } from "@/lib/settings";

const TONES = ["neutral", "success", "warning", "danger", "info"] as const;
const ACTIONS = ["release", "retain", "close", "dnc"] as const;
const FIELD_TYPES = ["text", "phone", "email", "url", "number", "date"] as const;
export const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "Asia/Karachi", "UTC"];

const int = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/* ------------------------------------------------------------------ dispositions */

export async function saveDispositionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("settings.manage");
    const id = formString(formData, "id");
    const label = formString(formData, "label").slice(0, 60);
    const description = formString(formData, "description").slice(0, 300) || null;
    const tone = formString(formData, "tone") as (typeof TONES)[number];
    const sortOrder = int(formString(formData, "sortOrder"), 0, 999) ?? 100;
    if (label.length < 2) return { error: "Give the outcome a label." };
    if (!TONES.includes(tone)) return { error: "Choose a color." };

    if (id) {
      const [before] = await db.select().from(schema.dispositions).where(eq(schema.dispositions.id, id));
      if (!before) return { error: "Outcome not found." };
      const next: Partial<typeof before> = { label, description, tone, sortOrder };
      if (!before.isSystem) {
        // the required default set keeps its behavior and cannot be switched off
        const action = formString(formData, "action") as (typeof ACTIONS)[number];
        if (!ACTIONS.includes(action)) return { error: "Choose what happens to the lead." };
        next.action = action;
        next.requiresCallback = formData.get("requiresCallback") === "on";
        next.active = formData.get("active") === "on";
      }
      await db.update(schema.dispositions).set(next).where(eq(schema.dispositions.id, id));
      await audit({ actorId: actor.id, action: "disposition_updated", module: "settings", entityType: "disposition", entityId: id, before: { label: before.label, tone: before.tone, action: before.action, active: before.active }, after: next as Record<string, unknown> });
    } else {
      const action = formString(formData, "action") as (typeof ACTIONS)[number];
      if (!ACTIONS.includes(action)) return { error: "Choose what happens to the lead." };
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);
      const [taken] = await db.select({ id: schema.dispositions.id }).from(schema.dispositions).where(eq(schema.dispositions.key, key));
      if (taken) return { error: "An outcome with this name already exists." };
      const [row] = await db
        .insert(schema.dispositions)
        .values({ key, label, description, tone, action, sortOrder, requiresCallback: formData.get("requiresCallback") === "on" })
        .returning({ id: schema.dispositions.id });
      await audit({ actorId: actor.id, action: "disposition_created", module: "settings", entityType: "disposition", entityId: row.id, after: { label, action } });
    }
    revalidatePath("/admin/dispositions");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ lead fields */

export async function saveFieldAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("settings.manage");
    const id = formString(formData, "id");
    const label = formString(formData, "label").slice(0, 80);
    const type = formString(formData, "type") as (typeof FIELD_TYPES)[number];
    if (label.length < 2) return { error: "Give the field a label." };
    if (!FIELD_TYPES.includes(type)) return { error: "Choose a field type." };
    if (id) {
      const [before] = await db.select().from(schema.leadFields).where(eq(schema.leadFields.id, id));
      if (!before) return { error: "Field not found." };
      const next = before.isCore ? { label } : { label, type, active: formData.get("active") === "on" };
      await db.update(schema.leadFields).set(next).where(eq(schema.leadFields.id, id));
      await audit({ actorId: actor.id, action: "field_updated", module: "settings", entityType: "lead_field", entityId: id, before: { label: before.label, type: before.type, active: before.active }, after: next });
    } else {
      const key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 50) || "field";
      const [taken] = await db.select({ id: schema.leadFields.id }).from(schema.leadFields).where(eq(schema.leadFields.key, key));
      if (taken) return { error: "A field with this name already exists." };
      const [row] = await db.insert(schema.leadFields).values({ key, label, type, isCore: false }).returning({ id: schema.leadFields.id });
      await audit({ actorId: actor.id, action: "field_created", module: "settings", entityType: "lead_field", entityId: row.id, after: { key, label, type } });
    }
    revalidatePath("/admin/fields");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ rules */

export async function saveRulesAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("settings.manage");
    const before = await readSettings();
    const tz = formString(formData, "businessTimezone");
    const inactivity = int(formString(formData, "inactivityMinutes"), 1, 60);
    const autoAssign = int(formString(formData, "autoAssignMinutes"), 1, 60);
    const maxReq = int(formString(formData, "maxLeadRequest"), 1, 2000);
    const idle = int(formString(formData, "sessionIdleMinutes"), 5, 480);
    const maxHours = int(formString(formData, "sessionMaxHours"), 1, 24);
    const presets = formString(formData, "leadPresets")
      .split(/[,\s]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0 && n <= 2000);
    if (!TIMEZONES.includes(tz)) return { error: "Choose a time zone." };
    if (!inactivity || !autoAssign || !maxReq || !idle || !maxHours) return { error: "Check the numbers; one of them is outside the allowed range." };
    if (!presets.length) return { error: "Enter at least one preset amount, e.g. 15, 30." };

    const next = {
      businessTimezone: tz,
      inactivityMinutes: inactivity,
      autoAssignMinutes: autoAssign,
      maxLeadRequest: maxReq,
      sessionIdleMinutes: idle,
      sessionMaxHours: maxHours,
      leadPresets: [...new Set(presets)].slice(0, 6),
    };
    for (const [key, value] of Object.entries(next)) await saveSetting(key as keyof typeof next, value as never, actor.id);
    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(next)) {
      const b = before[k as keyof typeof before];
      if (JSON.stringify(b) !== JSON.stringify(v)) {
        changedBefore[k] = b;
        changedAfter[k] = v;
      }
    }
    if (Object.keys(changedAfter).length) await audit({ actorId: actor.id, action: "settings_changed", module: "settings", entityType: "settings", entityId: "rules", before: changedBefore, after: changedAfter });
    revalidatePath("/", "layout");
    return { ok: true, message: "Rules saved." };
  } catch (error) {
    return failure(error);
  }
}

export async function saveBreaksAction(breaks: BreakType[], categories: string[]): Promise<ActionState> {
  try {
    const actor = await authorize("settings.manage");
    const clean = breaks
      .map((b, i) => ({ key: b.key || b.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) || `break_${i}`, label: b.label.trim().slice(0, 40), maxMinutes: Math.round(Number(b.maxMinutes)) }))
      .filter((b) => b.label && b.maxMinutes > 0 && b.maxMinutes <= 240);
    if (!clean.length) return { error: "Keep at least one break type." };
    if (new Set(clean.map((b) => b.key)).size !== clean.length) return { error: "Break names must be different." };
    const cats = [...new Set(categories.map((c) => c.trim().slice(0, 60)).filter(Boolean))];
    const before = await readSettings();
    await saveSetting("breakTypes", clean, actor.id);
    await saveSetting("hrDocumentCategories", cats.length ? cats : before.hrDocumentCategories, actor.id);
    await audit({ actorId: actor.id, action: "settings_changed", module: "settings", entityType: "settings", entityId: "breaks", before: { breakTypes: before.breakTypes, hrDocumentCategories: before.hrDocumentCategories }, after: { breakTypes: clean, hrDocumentCategories: cats } });
    revalidatePath("/", "layout");
    return { ok: true, message: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ shifts */

export async function saveShiftAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("settings.manage");
    const id = formString(formData, "id");
    const name = formString(formData, "name").slice(0, 80);
    const startTime = formString(formData, "startTime");
    const endTime = formString(formData, "endTime");
    const grace = int(formString(formData, "graceMinutes"), 0, 120);
    const days = formData.getAll("days").map(Number).filter((d) => d >= 0 && d <= 6);
    if (name.length < 2) return { error: "Name the shift." };
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) return { error: "Enter start and end times." };
    if (grace === null) return { error: "Grace minutes must be between 0 and 120." };
    if (!days.length) return { error: "Choose at least one working day." };
    const values = { name, startTime, endTime, graceMinutes: grace, days: [...new Set(days)].sort() };
    if (id) {
      await db.update(schema.shifts).set(values).where(eq(schema.shifts.id, id));
      await audit({ actorId: actor.id, action: "shift_updated", module: "settings", entityType: "shift", entityId: id, after: values });
    } else {
      const [row] = await db.insert(schema.shifts).values(values).returning({ id: schema.shifts.id });
      await audit({ actorId: actor.id, action: "shift_created", module: "settings", entityType: "shift", entityId: row.id, after: values });
    }
    revalidatePath("/admin/settings");
    return { ok: true, message: "Shift saved." };
  } catch (error) {
    return failure(error);
  }
}

/* ------------------------------------------------------------------ dialer */

export async function saveDialerAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const actor = await authorize("settings.manage");
    const current = (await readSettings()).dialer;
    const mode = formString(formData, "mode") as DialerSettings["mode"];
    if (!["clipboard", "url", "vcdialer"].includes(mode)) return { error: "Choose how calls are placed." };
    const urlTemplate = formString(formData, "urlTemplate").slice(0, 500);
    if (mode === "url" && !/^(https?|tel|sip|callto):/i.test(urlTemplate)) return { error: "The click-to-call URL must start with https://, tel:, sip: or callto:." };
    if (mode === "url" && !urlTemplate.includes("{phone}") && !urlTemplate.includes("{e164}")) return { error: "Include {phone} or {e164} in the click-to-call URL." };
    const apiBaseUrl = formString(formData, "apiBaseUrl").slice(0, 300);
    if (apiBaseUrl && !/^https:\/\//i.test(apiBaseUrl)) return { error: "The VC Dialer API address must start with https://." };
    const newKey = formString(formData, "apiKey");
    const extensions: Record<string, string> = {};
    for (const [k, v] of formData.entries()) {
      if (k.startsWith("ext:") && typeof v === "string" && v.trim()) extensions[k.slice(4)] = v.trim().slice(0, 40);
    }
    const next: DialerSettings = {
      mode,
      urlTemplate,
      vcdialer: { apiBaseUrl, apiKey: newKey || current.vcdialer.apiKey, accountId: formString(formData, "accountId").slice(0, 120) },
      extensions,
    };
    await saveSetting("dialer", next, actor.id);
    await audit({
      actorId: actor.id,
      action: "dialer_settings_changed",
      module: "settings",
      entityType: "settings",
      entityId: "dialer",
      before: { mode: current.mode, urlTemplate: current.urlTemplate, apiBaseUrl: current.vcdialer.apiBaseUrl },
      after: { mode, urlTemplate, apiBaseUrl, apiKeyChanged: Boolean(newKey), extensions: Object.keys(extensions).length },
    });
    revalidatePath("/admin/dialer");
    return { ok: true, message: "Dialer settings saved." };
  } catch (error) {
    return failure(error);
  }
}

