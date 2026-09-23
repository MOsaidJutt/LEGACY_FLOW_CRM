import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getCurrentUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { readSettings } from "@/lib/settings";

const MAX = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

/** HR-02 / HR-03: store an employee document as a soft copy with its metadata. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (!user.permissions.includes("hr.manage")) return Response.json({ error: "Only HR can upload employee documents." }, { status: 403 });

  const form = await request.formData();
  const file = form.get("file");
  const userId = String(form.get("userId") ?? "");
  const category = String(form.get("category") ?? "").trim();
  const title = String(form.get("title") ?? "").trim().slice(0, 200);
  const expiresOn = String(form.get("expiresOn") ?? "");
  const notes = String(form.get("notes") ?? "").trim().slice(0, 1000);

  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose a file." }, { status: 400 });
  if (file.size > MAX) return Response.json({ error: "The file is larger than 10 MB." }, { status: 400 });
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!TYPES[ext]) return Response.json({ error: "Upload a PDF, image or Word document." }, { status: 400 });
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return Response.json({ error: "Employee not found." }, { status: 400 });
  if (title.length < 2) return Response.json({ error: "Give the document a title." }, { status: 400 });
  if (expiresOn && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return Response.json({ error: "Enter a valid expiry date." }, { status: 400 });
  const settings = await readSettings();
  if (!settings.hrDocumentCategories.includes(category)) return Response.json({ error: "Choose a document type." }, { status: 400 });

  const [employee] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.id, userId));
  if (!employee) return Response.json({ error: "Employee not found." }, { status: 404 });

  const doc = await db.transaction(async (tx) => {
    const [f] = await tx
      .insert(schema.files)
      .values({ name: file.name.slice(0, 255), mime: TYPES[ext], size: file.size, data: Buffer.from(await file.arrayBuffer()), uploadedBy: user.id })
      .returning({ id: schema.files.id });
    const [d] = await tx
      .insert(schema.hrDocuments)
      .values({ userId, category, title, fileId: f.id, notes: notes || null, expiresOn: expiresOn || null, uploadedBy: user.id })
      .returning({ id: schema.hrDocuments.id });
    await audit({ actorId: user.id, action: "hr_document_uploaded", module: "hr", entityType: "hr_document", entityId: d.id, after: { userId, category, title, file: file.name } }, tx);
    return d;
  });
  return Response.json({ id: doc.id });
}
