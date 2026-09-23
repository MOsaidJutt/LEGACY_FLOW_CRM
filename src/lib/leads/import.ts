import "server-only";
import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import type { ImportStats } from "@/db/schema";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { parseUsPhone } from "@/lib/phone";
import { NAME_PARTS, NEW_FIELD } from "./import-labels";

const { imports, importRows, leads, leadFields, leadActivities, leadSources, dncNumbers } = schema;

export const MAX_ROWS = 20_000;
export const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Lead columns that can be targeted directly; everything else lands in leads.extra. */
const CORE_COLUMNS = ["company", "contact_name", "title", "phone", "email", "website", "city", "state", "industry"] as const;
type CoreKey = (typeof CORE_COLUMNS)[number];

/* ------------------------------------------------------------------ parsing */

function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result?: unknown }).result;
    if (r instanceof Date) return r.toISOString().slice(0, 10);
    return r === undefined || r === null ? "" : String(r).trim();
  }
  return String(cell.text ?? "").trim();
}

export async function parseSpreadsheet(data: Buffer, fileName: string) {
  const wb = new ExcelJS.Workbook();
  const name = fileName.toLowerCase();
  try {
    if (name.endsWith(".csv")) {
      await wb.csv.read(Readable.from(data), { map: (value: unknown) => value, parserOptions: { ignoreEmpty: true } } as never);
    } else if (name.endsWith(".xlsx")) {
      await wb.xlsx.load(data as never);
    } else {
      throw new ActionError("Upload an Excel (.xlsx) or CSV file. For older .xls files, open them in Excel and save as .xlsx.");
    }
  } catch (error) {
    if (error instanceof ActionError) throw error;
    throw new ActionError("The file could not be read. Check that it is a valid .xlsx or .csv file.");
  }

  const sheet = wb.worksheets.find((ws) => ws.actualRowCount > 0);
  if (!sheet) throw new ActionError("The file has no data.");
  const width = sheet.columnCount;

  // header = first of the first 10 rows with at least two filled cells
  let headerRow = 0;
  for (let r = 1; r <= Math.min(10, sheet.rowCount); r++) {
    const row = sheet.getRow(r);
    let filled = 0;
    for (let c = 1; c <= width; c++) if (cellText(row.getCell(c))) filled++;
    if (filled >= 2) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) throw new ActionError("No header row was found. The first row should contain column names.");

  const seen = new Map<string, number>();
  const headers: string[] = [];
  const header = sheet.getRow(headerRow);
  for (let c = 1; c <= width; c++) {
    let h = cellText(header.getCell(c)).replace(/\s+/g, " ").slice(0, 80) || `Column ${c}`;
    const n = (seen.get(h.toLowerCase()) ?? 0) + 1;
    seen.set(h.toLowerCase(), n);
    if (n > 1) h = `${h} (${n})`;
    headers.push(h);
  }

  const rows: { rowNumber: number; raw: Record<string, string> }[] = [];
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const raw: Record<string, string> = {};
    let any = false;
    headers.forEach((h, i) => {
      const v = cellText(row.getCell(i + 1)).slice(0, 1000);
      if (v) any = true;
      raw[h] = v;
    });
    if (!any) continue;
    rows.push({ rowNumber: r, raw });
    if (rows.length > MAX_ROWS) throw new ActionError(`The file has more than ${MAX_ROWS.toLocaleString()} rows. Split it into smaller files.`);
  }
  if (!rows.length) throw new ActionError("The file has a header row but no data rows.");

  // drop columns that are completely empty
  const used = headers.filter((h) => rows.some((r) => r.raw[h]));
  return { headers: used, rows: rows.map((r) => ({ rowNumber: r.rowNumber, raw: Object.fromEntries(used.map((h) => [h, r.raw[h]])) })) };
}

/* ------------------------------------------------------------------ mapping */

const SYNONYMS: Record<string, string[]> = {
  company: ["company", "company name", "business", "business name", "organization", "organisation", "account", "account name", "firm", "employer"],
  contact_name: ["contact", "contact name", "name", "full name", "contact person", "owner", "owner name", "decision maker"],
  first_name: ["first name", "firstname", "first", "fname", "given name"],
  last_name: ["last name", "lastname", "last", "lname", "surname", "family name"],
  title: ["title", "job title", "position", "designation", "role", "contact title"],
  phone: ["phone", "phone number", "telephone", "tel", "mobile", "cell", "direct", "direct phone", "direct dial", "contact number", "work phone", "business phone", "office phone", "phone 1"],
  email: ["email", "e mail", "email address", "mail", "work email", "business email"],
  website: ["website", "web", "url", "site", "domain", "web site", "company website", "homepage"],
  city: ["city", "town"],
  state: ["state", "province", "st", "region", "state province"],
  industry: ["industry", "sector", "category", "niche", "vertical", "business type"],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function guessMapping(headers: string[], customFields: { key: string; label: string }[]) {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  const assign = (h: string, key: string) => {
    if (taken.has(key) || mapping[h]) return;
    mapping[h] = key;
    taken.add(key);
  };
  for (const h of headers) {
    const n = norm(h);
    for (const [key, words] of Object.entries(SYNONYMS)) if (words.includes(n)) assign(h, key);
    for (const f of customFields) if (norm(f.label) === n || norm(f.key) === n) assign(h, f.key);
  }
  for (const h of headers) {
    if (mapping[h]) continue;
    const n = norm(h);
    if (/\b(phone|tel|mobile|cell)\b/.test(n)) assign(h, "phone");
    else if (/\bemail\b/.test(n)) assign(h, "email");
    else if (/\b(website|url)\b/.test(n)) assign(h, "website");
    else if (/\bcompany\b/.test(n)) assign(h, "company");
  }
  for (const h of headers) mapping[h] ??= "";
  return mapping;
}

function slugKey(label: string) {
  return (norm(label).replace(/ /g, "_") || "field").slice(0, 50);
}

/* ------------------------------------------------------------------ upload */

export async function createImport(opts: { fileName: string; data: Buffer; sourceId: string | null; newSourceName: string; userId: string }) {
  if (opts.data.byteLength > MAX_FILE_BYTES) throw new ActionError("The file is larger than 15 MB. Split it into smaller files.");
  const parsed = await parseSpreadsheet(opts.data, opts.fileName);
  const custom = await db.select({ key: leadFields.key, label: leadFields.label }).from(leadFields).where(and(eq(leadFields.isCore, false), eq(leadFields.active, true)));
  const mapping = guessMapping(parsed.headers, custom);

  return db.transaction(async (tx) => {
    let sourceId = opts.sourceId;
    if (!sourceId) {
      const name = opts.newSourceName.trim().slice(0, 120);
      if (!name) throw new ActionError("Choose a lead source or enter a new one.");
      const [existing] = await tx.select({ id: leadSources.id }).from(leadSources).where(sql`lower(${leadSources.name}) = ${name.toLowerCase()}`);
      sourceId = existing?.id ?? (await tx.insert(leadSources).values({ name }).returning({ id: leadSources.id }))[0].id;
    }
    const [row] = await tx
      .insert(imports)
      .values({
        fileName: opts.fileName.slice(0, 255),
        uploadedBy: opts.userId,
        sourceId,
        headers: parsed.headers,
        mapping,
        stats: { totalRows: parsed.rows.length, validRows: 0, duplicateRows: 0, missingRows: 0, invalidPhoneRows: 0, readyRows: 0 },
      })
      .returning({ id: imports.id });
    for (let i = 0; i < parsed.rows.length; i += 1000) {
      await tx.insert(importRows).values(parsed.rows.slice(i, i + 1000).map((r) => ({ importId: row.id, rowNumber: r.rowNumber, raw: r.raw })));
    }
    await audit(
      { actorId: opts.userId, action: "import_uploaded", module: "imports", entityType: "import", entityId: row.id, after: { fileName: opts.fileName, rows: parsed.rows.length } },
      tx,
    );
    return row.id;
  });
}

/* ------------------------------------------------------------------ validation */

type Normalized = { values: Record<string, string>; phoneE164: string | null };

function normalizeRow(raw: Record<string, string>, mapping: Record<string, string>): Normalized {
  const values: Record<string, string> = {};
  let first = "";
  let last = "";
  for (const [header, key] of Object.entries(mapping)) {
    const v = (raw[header] ?? "").trim();
    if (!key || !v) continue;
    if (key === "first_name") first = v;
    else if (key === "last_name") last = v;
    else values[key] = values[key] ? `${values[key]} ${v}` : v;
  }
  if (!values.contact_name && (first || last)) values.contact_name = `${first} ${last}`.trim();
  if (values.email) values.email = values.email.toLowerCase();
  const phone = parseUsPhone(values.phone);
  return { values, phoneE164: phone?.e164 ?? null };
}

export function websiteDomain(url: string | null | undefined) {
  if (!url) return "";
  return url.toLowerCase().trim().replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "");
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Applies the mapping, flags issues and finds duplicates. Leaves the import in "mapped" state. */
export async function validateImport(importId: string, mapping: Record<string, string>, userId: string) {
  const [imp] = await db.select().from(imports).where(eq(imports.id, importId));
  if (!imp) throw new ActionError("Import not found.");
  if (imp.status === "imported" || imp.status === "cancelled") throw new ActionError("This import is already closed.");

  const targets = Object.values(mapping).filter(Boolean);
  if (!targets.some((t) => ["phone", "company", "contact_name", "first_name", "last_name"].includes(t))) {
    throw new ActionError("Map at least the phone, company or contact name column.");
  }
  const dupTargets = targets.filter((t, i) => targets.indexOf(t) !== i);
  if (dupTargets.length) throw new ActionError("Each CRM field can be used by one column only. Map the extra columns to a new field or ignore them.");

  // columns mapped to "create new field" become custom lead fields
  const finalMapping: Record<string, string> = {};
  const fields = await db.select().from(leadFields);
  for (const [header, key] of Object.entries(mapping)) {
    if (key !== NEW_FIELD) {
      finalMapping[header] = key;
      continue;
    }
    let base = slugKey(header);
    if ((CORE_COLUMNS as readonly string[]).includes(base) || base in NAME_PARTS) base = `${base}_custom`;
    const existing = fields.find((f) => f.key === base);
    if (!existing) {
      await db.insert(leadFields).values({ key: base, label: header.slice(0, 80), type: "text", isCore: false }).onConflictDoNothing();
      fields.push({ key: base } as (typeof fields)[number]);
    }
    finalMapping[header] = base;
  }

  const rows = await db.select({ id: importRows.id, rowNumber: importRows.rowNumber, raw: importRows.raw }).from(importRows).where(eq(importRows.importId, importId)).orderBy(asc(importRows.rowNumber));
  const normalized = rows.map((r) => ({ ...r, ...normalizeRow(r.raw, finalMapping) }));
  const mapped = new Set(Object.values(finalMapping));
  const contactMapped = mapped.has("contact_name") || mapped.has("first_name") || mapped.has("last_name");

  // existing leads that could match (phone, email, website domain, company+contact)
  const phones = [...new Set(normalized.map((r) => r.phoneE164).filter(Boolean))] as string[];
  const emails = [...new Set(normalized.map((r) => r.values.email).filter(Boolean))];
  const domains = [...new Set(normalized.map((r) => websiteDomain(r.values.website)).filter(Boolean))];
  const companies = [...new Set(normalized.map((r) => r.values.company?.toLowerCase()).filter(Boolean))] as string[];
  const domainExpr = sql<string>`regexp_replace(regexp_replace(regexp_replace(lower(${leads.website}), '^[a-z]+://', ''), '^www\\.', ''), '[/?#].*$', '')`;

  const existing: { id: string; phoneE164: string | null; email: string | null; domain: string; company: string | null; contact: string | null }[] = [];
  const CHUNK = 500;
  const lookups: [string[], "phone" | "email" | "domain" | "company"][] = [
    [phones, "phone"],
    [emails, "email"],
    [domains, "domain"],
    [companies, "company"],
  ];
  for (const [values, kind] of lookups) {
    for (let i = 0; i < values.length; i += CHUNK) {
      const chunk = values.slice(i, i + CHUNK);
      const cond =
        kind === "phone"
          ? inArray(leads.phoneE164, chunk)
          : kind === "email"
            ? inArray(sql`lower(${leads.email})`, chunk)
            : kind === "domain"
              ? inArray(domainExpr, chunk)
              : inArray(sql`lower(${leads.company})`, chunk);
      const found = await db
        .select({ id: leads.id, phoneE164: leads.phoneE164, email: sql<string | null>`lower(${leads.email})`, domain: domainExpr, company: sql<string | null>`lower(${leads.company})`, contact: sql<string | null>`lower(${leads.contactName})` })
        .from(leads)
        .where(cond);
      existing.push(...found);
    }
  }
  const byPhone = new Map(existing.filter((e) => e.phoneE164).map((e) => [e.phoneE164!, e.id]));
  const byEmail = new Map(existing.filter((e) => e.email).map((e) => [e.email!, e.id]));
  const byDomain = new Map(existing.filter((e) => e.domain).map((e) => [e.domain, e.id]));
  const byCompanyContact = new Map(existing.filter((e) => e.company && e.contact).map((e) => [`${e.company}|${e.contact}`, e.id]));

  const firstSeen = new Map<string, number>();
  const stats: ImportStats = { totalRows: rows.length, validRows: 0, duplicateRows: 0, missingRows: 0, invalidPhoneRows: 0, readyRows: 0 };
  const updates = normalized.map((r) => {
    const issues: string[] = [];
    const v = r.values;
    if (!v.phone) issues.push("missing_phone");
    else if (!r.phoneE164) issues.push("invalid_phone");
    if (mapped.has("company") && !v.company) issues.push("missing_company");
    if (contactMapped && !v.contact_name) issues.push("missing_contact_name");
    if (v.email && !EMAIL.test(v.email)) issues.push("invalid_email");

    const domain = websiteDomain(v.website);
    const keys: [string, string][] = [];
    if (r.phoneE164) keys.push([`p:${r.phoneE164}`, "phone"]);
    if (v.email) keys.push([`e:${v.email}`, "email"]);
    if (domain) keys.push([`d:${domain}`, "website"]);
    if (v.company && v.contact_name) keys.push([`c:${v.company.toLowerCase()}|${v.contact_name.toLowerCase()}`, "company and contact"]);

    let matchLeadId: string | null = null;
    let matchReason: string | null = null;
    const existingMatch =
      (r.phoneE164 && byPhone.get(r.phoneE164) && ["phone", byPhone.get(r.phoneE164)!]) ||
      (v.email && byEmail.get(v.email) && ["email", byEmail.get(v.email)!]) ||
      (domain && byDomain.get(domain) && ["website", byDomain.get(domain)!]) ||
      (v.company && v.contact_name && byCompanyContact.get(`${v.company.toLowerCase()}|${v.contact_name.toLowerCase()}`) && ["company and contact", byCompanyContact.get(`${v.company.toLowerCase()}|${v.contact_name.toLowerCase()}`)!]) ||
      null;
    if (existingMatch) {
      issues.push("duplicate_existing");
      matchLeadId = existingMatch[1];
      matchReason = `Same ${existingMatch[0]} as an existing lead`;
    }
    let inFileDup = false;
    for (const [key, what] of keys) {
      const seenAt = firstSeen.get(key);
      if (seenAt !== undefined && seenAt !== r.rowNumber) {
        if (!inFileDup) {
          issues.push("duplicate_in_file");
          matchReason ??= `Same ${what} as row ${seenAt}`;
        }
        inFileDup = true;
      } else if (seenAt === undefined) firstSeen.set(key, r.rowNumber);
    }

    const decision = existingMatch ? "review" : inFileDup ? "reject" : "import";
    if (existingMatch || inFileDup) stats.duplicateRows++;
    if (issues.some((i) => i.startsWith("missing_"))) stats.missingRows++;
    if (issues.includes("invalid_phone")) stats.invalidPhoneRows++;
    if (issues.length === 0) stats.validRows++;
    if (decision === "import") stats.readyRows++;
    const values = { ...v, ...(r.phoneE164 ? { phone_e164: r.phoneE164 } : {}) };
    return { id: r.id, values, issues, match_lead_id: matchLeadId, match_reason: matchReason, decision };
  });

  await db.transaction(async (tx) => {
    for (let i = 0; i < updates.length; i += 1000) {
      const chunk = JSON.stringify(updates.slice(i, i + 1000));
      await tx.execute(sql`
        update ${importRows} as r
        set "values" = x."values", issues = x.issues, match_lead_id = x.match_lead_id, match_reason = x.match_reason,
            decision = x.decision::row_decision
        from jsonb_to_recordset(${chunk}::jsonb) as x(id uuid, "values" jsonb, issues jsonb, match_lead_id uuid, match_reason text, decision text)
        where r.id = x.id`);
    }
    await tx.update(imports).set({ mapping: finalMapping, status: "mapped", stats }).where(eq(imports.id, importId));
    await audit({ actorId: userId, action: "import_validated", module: "imports", entityType: "import", entityId: importId, after: { ...stats } }, tx);
  });
  return stats;
}

/* ------------------------------------------------------------------ decisions */

const EXISTING_CHOICES = ["reject", "keep_both", "update", "review"] as const;
const PLAIN_CHOICES = ["import", "reject"] as const;

async function openImport(tx: Tx, importId: string) {
  const [imp] = await tx.select().from(imports).where(eq(imports.id, importId)).for("update");
  if (!imp) throw new ActionError("Import not found.");
  if (imp.status !== "mapped") throw new ActionError("This import can no longer be changed.");
  return imp;
}

export async function setRowDecision(importId: string, rowId: string, decision: string) {
  await db.transaction(async (tx) => {
    await openImport(tx, importId);
    const [row] = await tx.select({ issues: importRows.issues }).from(importRows).where(and(eq(importRows.id, rowId), eq(importRows.importId, importId)));
    if (!row) throw new ActionError("Row not found.");
    const allowed: readonly string[] = row.issues.includes("duplicate_existing") ? EXISTING_CHOICES : PLAIN_CHOICES;
    if (!allowed.includes(decision)) throw new ActionError("That choice is not available for this row.");
    await tx.update(importRows).set({ decision: decision as (typeof schema.rowDecision.enumValues)[number] }).where(eq(importRows.id, rowId));
  });
}

/** Applies one decision to every row with a given issue (e.g. all existing-lead matches). */
export async function setBulkDecision(importId: string, issue: string, decision: string) {
  await db.transaction(async (tx) => {
    await openImport(tx, importId);
    const allowed: readonly string[] = issue === "duplicate_existing" ? EXISTING_CHOICES : PLAIN_CHOICES;
    if (!allowed.includes(decision)) throw new ActionError("That choice is not available for these rows.");
    await tx
      .update(importRows)
      .set({ decision: decision as (typeof schema.rowDecision.enumValues)[number] })
      .where(and(eq(importRows.importId, importId), sql`${importRows.issues} @> ${JSON.stringify([issue])}::jsonb`));
  });
}

export async function reopenMapping(importId: string) {
  await db.transaction(async (tx) => {
    await openImport(tx, importId);
    await tx.update(imports).set({ status: "uploaded" }).where(eq(imports.id, importId));
  });
}

export async function cancelImport(importId: string, userId: string) {
  const [row] = await db
    .update(imports)
    .set({ status: "cancelled" })
    .where(and(eq(imports.id, importId), inArray(imports.status, ["uploaded", "mapped"])))
    .returning({ id: imports.id });
  if (!row) throw new ActionError("This import can no longer be cancelled.");
  await audit({ actorId: userId, action: "import_cancelled", module: "imports", entityType: "import", entityId: importId });
}

/* ------------------------------------------------------------------ commit */

function leadColumns(values: Record<string, string>) {
  const core: Partial<Record<CoreKey, string>> = {};
  const extra: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) {
    if (k === "phone_e164") continue;
    if ((CORE_COLUMNS as readonly string[]).includes(k)) core[k as CoreKey] = v.slice(0, 255);
    else extra[k] = v;
  }
  return {
    company: core.company ?? null,
    contactName: core.contact_name ?? null,
    title: core.title ?? null,
    phone: core.phone ?? null,
    email: core.email ?? null,
    website: core.website ?? null,
    city: core.city ?? null,
    state: core.state ?? null,
    industry: core.industry ?? null,
    extra,
  };
}

export async function commitImport(importId: string, userId: string) {
  return db.transaction(async (tx) => {
    const imp = await openImport(tx, importId);
    const [{ review }] = await tx
      .select({ review: sql<number>`count(*)::int` })
      .from(importRows)
      .where(and(eq(importRows.importId, importId), eq(importRows.decision, "review")));
    if (review > 0) throw new ActionError(`${review} ${review === 1 ? "row still needs" : "rows still need"} a decision before importing.`);

    const rows = await tx.select().from(importRows).where(eq(importRows.importId, importId)).orderBy(asc(importRows.rowNumber));
    const toInsert = rows.filter((r) => r.decision === "import" || r.decision === "keep_both");
    const toUpdate = rows.filter((r) => r.decision === "update" && r.matchLeadId);

    const phones = [...new Set(toInsert.map((r) => r.values.phone_e164).filter(Boolean))];
    const dnc = new Set<string>();
    for (let i = 0; i < phones.length; i += 1000) {
      const found = await tx.select({ p: dncNumbers.phoneE164 }).from(dncNumbers).where(inArray(dncNumbers.phoneE164, phones.slice(i, i + 1000)));
      for (const f of found) dnc.add(f.p);
    }

    const links: { id: string; lead_id: string }[] = [];
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const inserted = await tx
        .insert(leads)
        .values(
          chunk.map((r) => ({
            ...leadColumns(r.values),
            phoneE164: r.values.phone_e164 || null,
            sourceId: imp.sourceId,
            importId,
            status: r.values.phone_e164 && dnc.has(r.values.phone_e164) ? ("dnc" as const) : ("available" as const),
          })),
        )
        .returning({ id: leads.id });
      inserted.forEach((lead, j) => links.push({ id: chunk[j].id, lead_id: lead.id }));
      await tx.insert(leadActivities).values(inserted.map((lead) => ({ leadId: lead.id, userId, type: "imported", summary: `Imported from ${imp.fileName}`, data: { importId } })));
    }

    for (const r of toUpdate) {
      const cols = leadColumns(r.values);
      const set: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(cols)) if (k !== "extra" && v) set[k] = v;
      if (r.values.phone_e164) set.phoneE164 = r.values.phone_e164;
      if (Object.keys(cols.extra).length) set.extra = sql`${leads.extra} || ${JSON.stringify(cols.extra)}::jsonb`;
      await tx.update(leads).set(set).where(eq(leads.id, r.matchLeadId!));
      await tx.insert(leadActivities).values({ leadId: r.matchLeadId!, userId, type: "updated", summary: `Updated from import ${imp.fileName}`, data: { importId, row: r.rowNumber } });
      links.push({ id: r.id, lead_id: r.matchLeadId! });
    }

    for (let i = 0; i < links.length; i += 1000) {
      await tx.execute(sql`
        update ${importRows} as r set lead_id = x.lead_id
        from jsonb_to_recordset(${JSON.stringify(links.slice(i, i + 1000))}::jsonb) as x(id uuid, lead_id uuid)
        where r.id = x.id`);
    }

    const stats: ImportStats = {
      ...imp.stats,
      importedRows: toInsert.length,
      updatedRows: toUpdate.length,
      rejectedRows: rows.filter((r) => r.decision === "reject").length,
    };
    await tx.update(imports).set({ status: "imported", importedAt: new Date(), stats }).where(eq(imports.id, importId));
    await audit({ actorId: userId, action: "import_committed", module: "imports", entityType: "import", entityId: importId, after: { ...stats } }, tx);
    return stats;
  });
}
