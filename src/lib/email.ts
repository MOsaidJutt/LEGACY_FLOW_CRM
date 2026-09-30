import "server-only";
import nodemailer from "nodemailer";
import { readSettings } from "@/lib/settings";

export type SendResult = { ok: true; messageId: string } | { ok: false; error: string };

const NOT_CONFIGURED = "Email sending is not set up yet. Add the outgoing mail server in Admin, Email.";

/** Whether an outgoing mail server has been configured. */
export async function emailReady() {
  const { email } = await readSettings();
  return Boolean(email.host && email.fromEmail);
}

function transportFor(email: Awaited<ReturnType<typeof readSettings>>["email"]) {
  return nodemailer.createTransport({
    host: email.host,
    port: email.port,
    secure: email.secure,
    auth: email.user ? { user: email.user, pass: email.password } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

const readable = (error: unknown) => {
  const raw = error instanceof Error ? error.message : String(error);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(raw)) return "The mail server could not be reached. Check the host and port.";
  if (/Invalid login|535|EAUTH/i.test(raw)) return "The mail server rejected the username or password.";
  if (/self.signed|certificate/i.test(raw)) return "The mail server's security certificate was rejected.";
  return raw.slice(0, 300);
};

/** Sends one email. Never throws: failures come back as { ok: false } so they can be recorded. */
export async function sendMail(opts: { to: string; subject: string; text: string; replyTo?: string }): Promise<SendResult> {
  const { email } = await readSettings();
  if (!email.host || !email.fromEmail) return { ok: false, error: NOT_CONFIGURED };
  try {
    const info = await transportFor(email).sendMail({
      from: email.fromName ? `"${email.fromName}" <${email.fromEmail}>` : email.fromEmail,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      replyTo: opts.replyTo || email.replyTo || undefined,
    });
    return { ok: true, messageId: String(info.messageId ?? "") };
  } catch (error) {
    return { ok: false, error: readable(error) };
  }
}

/** Checks the saved server settings without sending anything to a lead. */
export async function verifyMailSettings(): Promise<SendResult> {
  const { email } = await readSettings();
  if (!email.host || !email.fromEmail) return { ok: false, error: NOT_CONFIGURED };
  try {
    await transportFor(email).verify();
    return { ok: true, messageId: "" };
  } catch (error) {
    return { ok: false, error: readable(error) };
  }
}
