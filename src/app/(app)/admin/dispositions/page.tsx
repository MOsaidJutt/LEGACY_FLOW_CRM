import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePermission } from "@/lib/auth/session";
import { PageHeader, Panel } from "@/components/ui/layout";
import { DispositionForm } from "./disposition-form";

export const metadata: Metadata = { title: "Dispositions" };

export default async function DispositionsPage() {
  await requirePermission("settings.manage");
  const rows = await db.select().from(schema.dispositions).orderBy(asc(schema.dispositions.sortOrder), asc(schema.dispositions.label));
  return (
    <>
      <PageHeader
        title="Dispositions"
        description="The call outcomes agents choose from, in this order. The six required outcomes keep their behavior; you can rename them, recolor them and add your own."
      />
      <div className="flex flex-col gap-3">
        {rows.map((d) => (
          <DispositionForm key={d.id} disposition={d} />
        ))}
        <Panel title="Add an outcome" className="mt-2">
          <DispositionForm />
        </Panel>
      </div>
    </>
  );
}
