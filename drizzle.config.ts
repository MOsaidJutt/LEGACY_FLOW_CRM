import { defineConfig } from "drizzle-kit";

// `db:generate` only diffs the schema into SQL files; applying them is done by
// scripts/migrate.ts so the same migrations run on Neon and on local PGlite.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
});
