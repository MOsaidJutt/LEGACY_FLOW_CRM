import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { isMember } from "@/lib/messages";

/** Attachment download: only members of the conversation the file was sent in. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in again.", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found.", { status: 404 });

  const [row] = await db
    .select({ conversationId: schema.messages.conversationId, name: schema.files.name, mime: schema.files.mime, data: schema.files.data })
    .from(schema.messages)
    .innerJoin(schema.files, eq(schema.files.id, schema.messages.fileId))
    .where(eq(schema.files.id, id));
  if (!row || !(await isMember(row.conversationId, user.id))) return new Response("Not found.", { status: 404 });

  return new Response(new Uint8Array(row.data), {
    headers: {
      "Content-Type": row.mime,
      "Content-Disposition": `attachment; filename="${row.name.replace(/[^\w.\- ]+/g, "_")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
