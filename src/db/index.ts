import "server-only";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export const LOCAL_DB_DIR = "./.data/pglite";

const globalForDb = globalThis as unknown as { __lfDb?: DB; __lfPool?: Pool };

function connect(): DB {
  const url = process.env.DATABASE_URL;
  if (url) {
    const pool =
      globalForDb.__lfPool ??
      new Pool({
        connectionString: url,
        max: Number(process.env.DATABASE_POOL_MAX ?? 5),
        idleTimeoutMillis: 20_000,
      });
    globalForDb.__lfPool = pool;
    return drizzlePg(pool, { schema });
  }
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_LOCAL_DB) {
    // never fall back to a private on-disk database on a production host
    throw new Error("DATABASE_URL is not set. Both production hosts must point at the same Neon database.");
  }
  // Local development without a Neon URL: embedded Postgres on disk.
  // The PGlite API is a superset of what we use, so it is typed as the pg driver.
  return drizzlePglite(new PGlite(LOCAL_DB_DIR), { schema }) as unknown as DB;
}

function instance(): DB {
  // Cached on globalThis so dev hot-reloads reuse one connection.
  return (globalForDb.__lfDb ??= connect());
}

/**
 * Lazily-connected database. Nothing connects at import time, which keeps
 * `next build` from opening the database while it collects page data.
 */
export const db = new Proxy({} as DB, {
  get(_target, prop) {
    const real = instance();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export { schema };
