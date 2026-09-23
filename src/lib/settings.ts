import "server-only";
import { cache } from "react";
import { db, schema } from "@/db";
import { DEFAULT_SETTINGS, type AppSettings } from "./settings-defaults";

export * from "./settings-defaults";

export type SettingKey = keyof AppSettings;

async function load(): Promise<AppSettings> {
  const rows = await db.select().from(schema.settings);
  const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  for (const row of rows) {
    if (row.key in DEFAULT_SETTINGS) merged[row.key] = row.value;
  }
  const s = merged as AppSettings;
  // nested defaults survive partially-saved objects
  s.dialer = {
    ...DEFAULT_SETTINGS.dialer,
    ...s.dialer,
    vcdialer: { ...DEFAULT_SETTINGS.dialer.vcdialer, ...s.dialer?.vcdialer },
    extensions: { ...s.dialer?.extensions },
  };
  return s;
}

/** Settings for the current request (deduplicated per render). */
export const getSettings = cache(load);

/** Uncached read for background jobs. */
export const readSettings = load;

export async function saveSetting<K extends SettingKey>(key: K, value: AppSettings[K], userId: string | null) {
  await db
    .insert(schema.settings)
    .values({ key, value, updatedBy: userId })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: userId, updatedAt: new Date() } });
}
