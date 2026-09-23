import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Panel } from "@/components/ui/layout";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Import leads" };

export default async function NewImportPage() {
  await requirePermission("leads.import");
  const sources = await db.select({ id: schema.leadSources.id, name: schema.leadSources.name }).from(schema.leadSources).orderBy(asc(schema.leadSources.name));

  return (
    <>
      <PageHeader title="Import leads" back={{ href: "/manage/imports", label: "Imports" }} description="Step 1 of 3: upload the file. Nothing is added to the lead database until you confirm the final step." />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,34rem)_1fr]">
        <Panel>
          <UploadForm sources={sources} />
        </Panel>
        <div className="text-sm text-ink-2">
          <h2 className="mb-2 text-[15px] font-semibold text-ink">How importing works</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 marker:text-ink-3">
            <li>Upload an .xlsx or .csv file. Columns can be in any order and use any names; the first row must hold the column names.</li>
            <li>Match each uploaded column to a CRM field, or keep it as a new custom field.</li>
            <li>Review the check results: duplicates inside the file, matches with leads already in the CRM, missing information and invalid U.S. phone formats. Decide what happens to each, then import.</li>
          </ol>
          <p className="mt-3 text-ink-3">Leads without a valid U.S. phone number are stored but never handed out to agents until the number is fixed.</p>
        </div>
      </div>
    </>
  );
}
