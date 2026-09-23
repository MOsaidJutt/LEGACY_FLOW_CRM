import { config } from "dotenv";
import { mkdirSync } from "node:fs";

config({ path: [".env.local", ".env"], quiet: true });

export const LOCAL_DB_DIR = "./.data/pglite";

/** Opens the same database the app uses: Neon when DATABASE_URL is set, local PGlite otherwise. */
export async function openScriptDb() {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url, max: 2 });
    const db = drizzle(pool);
    return {
      db,
      label: `Postgres (${new URL(url).host})`,
      migrate: () => migrate(db, { migrationsFolder: "./drizzle" }),
      close: () => pool.end(),
    };
  }
  mkdirSync(LOCAL_DB_DIR, { recursive: true });
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(LOCAL_DB_DIR);
  const db = drizzle(client);
  return {
    db: db as unknown as import("drizzle-orm/node-postgres").NodePgDatabase,
    label: `local PGlite (${LOCAL_DB_DIR})`,
    migrate: () => migrate(db, { migrationsFolder: "./drizzle" }),
    close: () => client.close(),
  };
}
