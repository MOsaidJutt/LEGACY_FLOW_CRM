import { openScriptDb } from "./db";

async function main() {
  const conn = await openScriptDb();
  console.log(`Applying migrations to ${conn.label} ...`);
  await conn.migrate();
  await conn.close();
  console.log("Migrations applied.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
