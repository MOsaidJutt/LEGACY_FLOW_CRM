import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";

/** HR-07: documents are only served to HR, and every download is audited. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in again.", { status: 401 });
  if (!user.permissions.includes("hr.manage")) return new Response("Not allowed.", { status: 403 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });

  const [row] = await db
    .select({ name: schema.files.name, mime: schema.files.mime, data: schema.files.data, userId: schema.hrDocuments.userId })
    .from(schema.hrDocuments)
    .innerJoin(schema.files, eq(schema.files.id, schema.hrDocuments.fileId))
    .where(eq(schema.hrDocuments.id, id));
  if (!row) return new Response("Not found.", { status: 404 });

  await audit({ actorId: user.id, action: "hr_document_downloaded", module: "hr", entityType: "hr_document", entityId: id, after: { userId: row.userId } });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `attachment; filename="${row.name.replace(/[^\w.\- ]+/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
