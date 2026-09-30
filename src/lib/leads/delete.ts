import "server-only";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";

const { imports, importRows, leads, leadSources, users } = schema;

export type DeletionSummary = {
  id: string;
  label: string;
  /** Lead source (campaign) the data belongs to. */
  campaign: string | null;
  totalLeads: number;
  assignedLeads: number;
  calledLeads: number;
  followUpLeads: number;
  dncLeads: number;
  uploadedBy?: string | null;
  importedAt?: Date | null;
};

const counts = (where: Parameters<typeof db.select>[0] extends never ? never : ReturnType<typeof eq>) =>
  db
    .select({
      total: sql<number>`count(*)::int`,
      assigned: sql<number>`count(*) filter (where ${leads.assignedTo} is not null)::int`,
      called: sql<number>`count(*) filter (where ${leads.callCount} > 0)::int`,
      followUp: sql<number>`count(*) filter (where ${leads.status} = 'follow_up')::int`,
      dnc: sql<number>`count(*) filter (where ${leads.status} = 'dnc')::int`,
    })
    .from(leads)
    .where(where);

/** What exactly would be removed if this import were deleted. Shown before confirming. */
export async function importDeletionSummary(importId: string): Promise<DeletionSummary> {
  const [imp] = await db
    .select({
      id: imports.id,
      fileName: imports.fileName,
      importedAt: imports.importedAt,
      campaign: leadSources.name,
      uploader: users.name,
    })
    .from(imports)
    .leftJoin(leadSources, eq(leadSources.id, imports.sourceId))
    .leftJoin(users, eq(users.id, imports.uploadedBy))
    .where(eq(imports.id, importId));
  if (!imp) throw new ActionError("That import no longer exists.");
  const [c] = await counts(eq(leads.importId, importId));
  return {
    id: imp.id,
    label: imp.fileName,
    campaign: imp.campaign,
    totalLeads: c.total,
    assignedLeads: c.assigned,
    calledLeads: c.called,
    followUpLeads: c.followUp,
    dncLeads: c.dnc,
    uploadedBy: imp.uploader,
    importedAt: imp.importedAt,
  };
}

/** What exactly would be removed if a whole imported database (lead source) were deleted. */
export async function sourceDeletionSummary(sourceId: string): Promise<DeletionSummary> {
  const [source] = await db.select({ id: leadSources.id, name: leadSources.name }).from(leadSources).where(eq(leadSources.id, sourceId));
  if (!source) throw new ActionError("That lead database no longer exists.");
  const [c] = await counts(eq(leads.sourceId, sourceId));
  return {
    id: source.id,
    label: source.name,
    campaign: source.name,
    totalLeads: c.total,
    assignedLeads: c.assigned,
    calledLeads: c.called,
    followUpLeads: c.followUp,
    dncLeads: c.dnc,
  };
}

/**
 * Deletes one uploaded file, and optionally the leads that came from it.
 * Everything is scoped to that import, so other campaigns, settings, dispositions
 * and lead fields are never touched (CRM Issues, sections 3 and 4).
 */
export async function deleteImport(opts: { importId: string; deleteLeads: boolean; actorId: string }) {
  const summary = await importDeletionSummary(opts.importId);
  const deleted = await db.transaction(async (tx) => {
    let leadsDeleted = 0;
    if (opts.deleteLeads && summary.totalLeads > 0) {
      const rows = await tx.delete(leads).where(eq(leads.importId, opts.importId)).returning({ id: leads.id });
      leadsDeleted = rows.length;
    }
    // import_rows cascade with the import row itself
    await tx.delete(imports).where(eq(imports.id, opts.importId));
    return leadsDeleted;
  });

  await audit({
    actorId: opts.actorId,
    action: opts.deleteLeads ? "import_and_leads_deleted" : "import_file_deleted",
    module: "imports",
    entityType: "import",
    entityId: opts.importId,
    summary: `Deleted the import "${summary.label}"${opts.deleteLeads ? ` and ${deleted} lead${deleted === 1 ? "" : "s"}` : " (file record only)"}`,
    before: {
      file: summary.label,
      campaign: summary.campaign,
      leadsFromThisFile: summary.totalLeads,
      assignedLeads: summary.assignedLeads,
      calledLeads: summary.calledLeads,
    },
    after: { leadsDeleted: deleted, fileRecordDeleted: true },
  });
  return { leadsDeleted: deleted, label: summary.label };
}

/**
 * Deletes every lead in one imported database (lead source), and the import records
 * that produced them. Scoped to that campaign only.
 */
export async function deleteSourceLeads(opts: { sourceId: string; actorId: string; removeSource: boolean }) {
  const summary = await sourceDeletionSummary(opts.sourceId);
  const result = await db.transaction(async (tx) => {
    const removed = await tx.delete(leads).where(eq(leads.sourceId, opts.sourceId)).returning({ id: leads.id });
    const files = await tx.delete(imports).where(eq(imports.sourceId, opts.sourceId)).returning({ id: imports.id });
    if (opts.removeSource) await tx.delete(leadSources).where(eq(leadSources.id, opts.sourceId));
    return { leadsDeleted: removed.length, filesDeleted: files.length };
  });

  await audit({
    actorId: opts.actorId,
    action: "lead_database_deleted",
    module: "imports",
    entityType: "lead_source",
    entityId: opts.sourceId,
    summary: `Deleted the lead database "${summary.label}": ${result.leadsDeleted} lead${result.leadsDeleted === 1 ? "" : "s"} and ${result.filesDeleted} file${result.filesDeleted === 1 ? "" : "s"}`,
    before: {
      campaign: summary.label,
      leads: summary.totalLeads,
      assignedLeads: summary.assignedLeads,
      calledLeads: summary.calledLeads,
      followUpLeads: summary.followUpLeads,
    },
    after: { ...result, campaignRemoved: opts.removeSource },
  });
  return { ...result, label: summary.label };
}

/** Lead databases (campaigns) with their lead counts, for the delete picker. */
export async function leadDatabases() {
  return db
    .select({
      id: leadSources.id,
      name: leadSources.name,
      leads: sql<number>`count(${leads.id})::int`,
      assigned: sql<number>`count(*) filter (where ${leads.assignedTo} is not null)::int`,
    })
    .from(leadSources)
    .leftJoin(leads, eq(leads.sourceId, leadSources.id))
    .groupBy(leadSources.id, leadSources.name)
    .orderBy(leadSources.name);
}

/** Files that still have rows linked to leads, used to warn before deleting a file record. */
export async function importsWithLinkedRows(importIds: string[]) {
  if (!importIds.length) return new Set<string>();
  const rows = await db
    .selectDistinct({ importId: importRows.importId })
    .from(importRows)
    .where(and(inArray(importRows.importId, importIds), isNotNull(importRows.leadId)));
  return new Set(rows.map((r) => r.importId));
}
