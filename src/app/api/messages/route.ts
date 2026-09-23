import { getCurrentUser } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions";
import { sendMessage } from "@/lib/messages";

const MAX = 10 * 1024 * 1024;
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
};

/** Send a message (multipart, so attachments work beyond the server-action size limit). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Sign in again." }, { status: 401 });
  if (!user.permissions.includes("messages.use")) return Response.json({ error: "You cannot send messages." }, { status: 403 });

  try {
    const form = await request.formData();
    const conversationId = String(form.get("conversationId") ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(conversationId)) throw new ActionError("Choose a conversation.");
    const file = form.get("file");
    let attachment: { name: string; mime: string; data: Buffer } | null = null;
    if (file instanceof File && file.size > 0) {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!TYPES[ext]) throw new ActionError("Attach a PDF, image, Word, Excel, CSV or text file.");
      if (file.size > MAX) throw new ActionError("Attachments can be up to 10 MB.");
      attachment = { name: file.name, mime: TYPES[ext], data: Buffer.from(await file.arrayBuffer()) };
    }
    const id = await sendMessage({ conversationId, senderId: user.id, senderName: user.name, body: String(form.get("body") ?? ""), file: attachment });
    return Response.json({ id });
  } catch (error) {
    if (error instanceof ActionError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[messages] send failed", error);
    return Response.json({ error: "The message was not sent. Try again." }, { status: 500 });
  }
}
