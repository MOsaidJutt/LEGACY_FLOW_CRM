"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { authorize, failure, formString, type ActionState } from "@/lib/actions";
import { audit } from "@/lib/audit";

export type DeviceState = (ActionState & { token?: string; name?: string }) | null;

export async function createDeviceAction(_prev: DeviceState, formData: FormData): Promise<DeviceState> {
  try {
    const actor = await authorize("users.manage");
    const userId = formString(formData, "userId");
    const name = formString(formData, "name").slice(0, 120);
    if (!/^[0-9a-f-]{36}$/i.test(userId)) return { error: "Choose the agent who uses this computer." };
    if (name.length < 2) return { error: "Name the computer, e.g. Desk 4." };
    const token = `lfd_${randomBytes(24).toString("base64url")}`;
    const [row] = await db
      .insert(schema.desktopDevices)
      .values({ userId, name, tokenHash: createHash("sha256").update(token).digest("hex") })
      .returning({ id: schema.desktopDevices.id });
    await audit({ actorId: actor.id, action: "workstation_registered", module: "users", entityType: "desktop_device", entityId: row.id, after: { userId, name } });
    revalidatePath("/admin/workstations");
    return { ok: true, token, name };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeDeviceAction(id: string): Promise<ActionState> {
  try {
    const actor = await authorize("users.manage");
    await db.update(schema.desktopDevices).set({ revokedAt: new Date() }).where(eq(schema.desktopDevices.id, id));
    await audit({ actorId: actor.id, action: "workstation_revoked", module: "users", entityType: "desktop_device", entityId: id });
    revalidatePath("/admin/workstations");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}
