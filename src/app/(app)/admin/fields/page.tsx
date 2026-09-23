import type { Metadata } from "next";
import { asc, desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Panel } from "@/components/ui/layout";
import { FieldForm } from "./field-form";

export const metadata: Metadata = { title: "Lead fields" };

export default async function FieldsPage() {
  await requirePermission("settings.manage");
  const rows = await db.select().from(schema.leadFields).orderBy(desc(schema.leadFields.isCore), asc(schema.leadFields.sortOrder), asc(schema.leadFields.label));
  const core = rows.filter((r) => r.isCore);
  const custom = rows.filter((r) => !r.isCore);
  return (
    <>
      <PageHeader title="Lead fields" description="Fields that uploaded Excel columns can be mapped to. Custom fields are searchable and shown on the lead for agents." />
      <div className="flex flex-col gap-5">
        <Panel title="Standard fields" description="Built into every lead. You can change how they are labeled." flush>
          <div className="divide-y divide-line">
            {core.map((f) => (
              <FieldForm key={f.id} field={f} />
            ))}
          </div>
        </Panel>
        <Panel title="Custom fields" description="Created here or while mapping an import." flush>
          <div className="divide-y divide-line">
            {custom.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">No custom fields yet.</p> : null}
            {custom.map((f) => (
              <FieldForm key={f.id} field={f} />
            ))}
          </div>
        </Panel>
        <Panel title="Add a custom field">
          <FieldForm />
        </Panel>
      </div>
    </>
  );
}
