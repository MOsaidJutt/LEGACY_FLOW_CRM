import { getCurrentUser } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions";
import { createImport, MAX_FILE_BYTES } from "@/lib/leads/import";

/**
 * Upload endpoint for lead files. A route handler (not a server action) so that
 * files larger than the 1 MB server-action body limit can be uploaded.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Your session has ended. Sign in again." }, { status: 401 });
  if (!user.permissions.includes("leads.import")) return Response.json({ error: "You do not have permission to import leads." }, { status: 403 });

  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Choose a file to upload.");
    if (file.size > MAX_FILE_BYTES) throw new ActionError("The file is larger than 15 MB. Split it into smaller files.");
    const sourceId = String(form.get("sourceId") ?? "");
    const id = await createImport({
      fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()),
      sourceId: sourceId && sourceId !== "__new__" ? sourceId : null,
      newSourceName: String(form.get("newSource") ?? ""),
      userId: user.id,
    });
    return Response.json({ id });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[imports] upload failed", error);
    return Response.json({ error: "The upload failed. Try again." }, { status: 500 });
  }
}
