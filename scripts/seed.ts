/**
 * Base data every installation needs (idempotent, safe to re-run):
 * roles, first admin, dispositions, lead fields, settings, leave types, default group and shift.
 *
 *   npm run db:seed          base data only
 *   npm run db:demo          base data + demo users and 360 sample leads (local testing)
 */
import { eq, sql } from "drizzle-orm";
import { openScriptDb } from "./db";
import * as schema from "../src/db/schema";
import { DEFAULT_ROLES } from "../src/lib/auth/permissions";
import { hashPassword, temporaryPassword } from "../src/lib/auth/password";
import { DEFAULT_SETTINGS } from "../src/lib/settings-defaults";

const DISPOSITIONS = [
  { key: "no_answer", label: "No Answer", action: "release", tone: "neutral", requiresCallback: false, sortOrder: 10, description: "No one picked up. The lead returns to the pool when you log out." },
  { key: "callback", label: "Call Back Later", action: "retain", tone: "info", requiresCallback: true, sortOrder: 20, description: "Schedule a callback. The lead stays with you." },
  { key: "not_interested", label: "Not Interested", action: "close", tone: "warning", requiresCallback: false, sortOrder: 30, description: "The contact declined. The lead is closed." },
  { key: "dnc", label: "Do Not Call", action: "dnc", tone: "danger", requiresCallback: false, sortOrder: 40, description: "Adds the number to the internal do-not-call list." },
  { key: "email", label: "Email", action: "retain", tone: "info", requiresCallback: false, sortOrder: 50, description: "Email follow-up needed or sent. The lead stays with you." },
  { key: "qualified", label: "Successful: Qualify", action: "retain", tone: "success", requiresCallback: false, sortOrder: 60, description: "Qualified conversation. The lead stays with you." },
] as const;

const CORE_FIELDS = [
  { key: "company", label: "Company", type: "text", sortOrder: 10 },
  { key: "contact_name", label: "Contact name", type: "text", sortOrder: 20 },
  { key: "title", label: "Job title", type: "text", sortOrder: 30 },
  { key: "phone", label: "Phone", type: "phone", sortOrder: 40 },
  { key: "email", label: "Email", type: "email", sortOrder: 50 },
  { key: "website", label: "Website", type: "url", sortOrder: 60 },
  { key: "city", label: "City", type: "text", sortOrder: 70 },
  { key: "state", label: "State", type: "text", sortOrder: 80 },
  { key: "industry", label: "Industry", type: "text", sortOrder: 90 },
];

async function main() {
  const demo = process.argv.includes("--demo");
  const conn = await openScriptDb();
  const db = conn.db;
  console.log(`Seeding ${conn.label}${demo ? " with demo data" : ""} ...`);

  for (const [key, role] of Object.entries(DEFAULT_ROLES)) {
    await db
      .insert(schema.roles)
      .values({ key, name: role.name, description: role.description, permissions: role.permissions, isSystem: true })
      .onConflictDoNothing({ target: schema.roles.key });
  }
  const roleRows = await db.select().from(schema.roles);
  const roleId = (key: string) => roleRows.find((r) => r.key === key)!.id;

  for (const d of DISPOSITIONS) {
    await db.insert(schema.dispositions).values({ ...d, isSystem: true }).onConflictDoNothing({ target: schema.dispositions.key });
  }
  for (const f of CORE_FIELDS) {
    await db.insert(schema.leadFields).values({ ...f, isCore: true }).onConflictDoNothing({ target: schema.leadFields.key });
  }
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.insert(schema.settings).values({ key, value }).onConflictDoNothing({ target: schema.settings.key });
  }
  for (const lt of [
    { name: "Annual leave", daysPerYear: 14 },
    { name: "Sick leave", daysPerYear: 8 },
    { name: "Casual leave", daysPerYear: 10 },
    { name: "Unpaid leave", daysPerYear: null },
  ]) {
    await db.insert(schema.leaveTypes).values(lt).onConflictDoNothing({ target: schema.leaveTypes.name });
  }
  await db.insert(schema.groups).values({ name: "B2B Team", description: "All calling agents" }).onConflictDoNothing({ target: schema.groups.name });

  let [shift] = await db.select().from(schema.shifts).limit(1);
  if (!shift) {
    [shift] = await db
      .insert(schema.shifts)
      .values({ name: "U.S. business hours", startTime: "08:00", endTime: "17:00", days: [1, 2, 3, 4, 5], graceMinutes: 10 })
      .returning();
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || "admin@lonestarlegacy.local").toLowerCase();
  const [existingAdmin] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, adminEmail));
  if (!existingAdmin) {
    const password = process.env.SEED_ADMIN_PASSWORD || temporaryPassword();
    await db.insert(schema.users).values({
      email: adminEmail,
      name: "System Admin",
      passwordHash: await hashPassword(password),
      roleId: roleId("admin"),
      mustChangePassword: !process.env.SEED_ADMIN_PASSWORD,
    });
    console.log(`\n  Admin account: ${adminEmail}\n  Password:      ${password}${process.env.SEED_ADMIN_PASSWORD ? "" : "   (temporary, must be changed at first sign-in)"}\n`);
  }

  if (demo) await seedDemo(db, roleId, shift.id);

  await conn.close();
  console.log("Seed complete.");
}

/* ------------------------------------------------------------------ demo data */

type Db = Awaited<ReturnType<typeof openScriptDb>>["db"];

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function seedDemo(db: Db, roleId: (key: string) => string, shiftId: string) {
  const DEMO_PASSWORD = "LegacyFlow-2026";
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  // Lone Star Legacy's seven agents, plus one Management and one HR demo login
  const people = [
    ...["Sarah", "Hannah", "Sam", "Noah", "Leo", "Ryan", "Shawn"].map((name) => ({ name, email: name.toLowerCase(), role: "agent" })),
    { name: "Omar Farooq", email: "omar.farooq", role: "management" },
    { name: "Nadia Hussain", email: "nadia.hussain", role: "hr" },
  ];
  const [team] = await db.select().from(schema.groups).where(eq(schema.groups.name, "B2B Team"));
  const [{ maxCode }] = await db
    .select({ maxCode: sql<number>`coalesce(max(substring(${schema.employeeProfiles.employeeCode} from 'LSL-(\\d+)')::int), 1000)::int` })
    .from(schema.employeeProfiles);
  let code = maxCode + 1;
  for (const p of people) {
    const email = `${p.email}@lonestarlegacy.local`;
    await db
      .insert(schema.users)
      .values({ email, name: p.name, passwordHash, roleId: roleId(p.role), shiftId: p.role === "agent" ? shiftId : null })
      .onConflictDoNothing({ target: schema.users.email });
    const [row] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email));
    const [profile] = await db
      .select({ userId: schema.employeeProfiles.userId })
      .from(schema.employeeProfiles)
      .where(eq(schema.employeeProfiles.userId, row.id));
    if (profile) continue;
    await db.insert(schema.employeeProfiles).values({
      userId: row.id,
      employeeCode: `LSL-${code++}`,
      jobTitle: p.role === "agent" ? "Calling Agent" : p.role === "management" ? "Operations Manager" : "HR Officer",
      department: p.role === "agent" ? "B2B Calling" : p.role === "management" ? "Operations" : "Human Resources",
      joiningDate: "2026-09-01",
    });
    if (p.role === "agent" && team) await db.insert(schema.groupMembers).values({ groupId: team.id, userId: row.id }).onConflictDoNothing();
  }

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.leads);
  if (n > 0) {
    console.log(`  Demo users ready (password ${DEMO_PASSWORD}); ${n} leads already exist, skipping sample leads.`);
    return;
  }

  const [source] = await db
    .insert(schema.leadSources)
    .values({ name: "Texas manufacturers (demo)", description: "Sample data for local testing" })
    .onConflictDoNothing({ target: schema.leadSources.name })
    .returning();

  const r = rng(2026);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(r() * list.length)];
  const first = ["James", "Maria", "Robert", "Linda", "Michael", "Patricia", "David", "Jennifer", "William", "Elizabeth", "Carlos", "Susan", "Daniel", "Karen", "Thomas", "Nancy", "Kevin", "Lisa", "Brian", "Angela"];
  const last = ["Johnson", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris"];
  const nameA = ["Lone", "Red", "Pecos", "Brazos", "Alamo", "Gulf", "Prairie", "Summit", "Ironwood", "Bluebonnet", "Frontier", "Cedar", "Trinity", "Guadalupe", "Liberty"];
  const nameB = ["Fabrication", "Logistics", "Supply", "Industrial", "Metals", "Plastics", "Components", "Machining", "Packaging", "Energy Services", "Controls", "Builders"];
  const suffix = ["LLC", "Inc.", "Co.", "Group", "Partners"];
  const cities = [
    { city: "Dallas", area: ["214", "469", "972"] },
    { city: "Houston", area: ["713", "281", "832"] },
    { city: "Austin", area: ["512", "737"] },
    { city: "San Antonio", area: ["210", "726"] },
    { city: "Fort Worth", area: ["817", "682"] },
    { city: "El Paso", area: ["915"] },
  ];
  const industries = ["Manufacturing", "Logistics", "Construction", "Oil & Gas Services", "Wholesale", "Industrial Supply"];
  const titles = ["Owner", "Operations Manager", "Purchasing Manager", "General Manager", "Plant Manager", "Office Manager"];

  const rows: (typeof schema.leads.$inferInsert)[] = [];
  for (let i = 0; i < 360; i++) {
    const c = pick(cities);
    const company = `${pick(nameA)} ${pick(nameB)} ${pick(suffix)}`;
    const fn = pick(first);
    const ln = pick(last);
    const domain = company.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 18) + ".com";
    const digits = `${pick(c.area)}555${String(Math.floor(r() * 10000)).padStart(4, "0")}`;
    rows.push({
      sourceId: source?.id,
      company,
      contactName: `${fn} ${ln}`,
      title: pick(titles),
      phone: `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`,
      phoneE164: `+1${digits}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}@${domain}`,
      website: `https://www.${domain}`,
      city: c.city,
      state: "TX",
      industry: pick(industries),
    });
  }
  for (let i = 0; i < rows.length; i += 100) await db.insert(schema.leads).values(rows.slice(i, i + 100));
  console.log(`  Demo users ready (password ${DEMO_PASSWORD}) and ${rows.length} sample leads added.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
