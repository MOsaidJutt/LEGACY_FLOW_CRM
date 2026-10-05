import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import { ActionError } from "@/lib/actions";
import { audit } from "@/lib/audit";
import { sendMail } from "@/lib/email";
import { notify, usersWithPermission } from "@/lib/notify";

const { leads, leadEmails, leadActivities, leadSources, users } = schema;

export type FollowUpResult = {
  status: "sent" | "failed";
  to: string;
  error?: string;
};

/**
 * Sends a follow-up email to one lead, records it against that lead and notifies the
 * agent the lead is assigned to. The record keeps the agent from the moment of sending,
 * so a later reassignment never rewrites history (CRM Issues, section 5).
 */
export async function sendFollowUpEmail(opts: {
  leadId: string;
  subject: string;
  body: string;
  actorId: string;
  actorName: string;
  /** Address to use when the lead has none, or to correct the one it has. Saved to the lead. */
  to?: string;
  /** Set for agents: they may only email a lead that is assigned to them. */
  restrictToAgentId?: string;
}): Promise<FollowUpResult> {
  const subject = opts.subject.trim().slice(0, 200);
  const body = opts.body.trim().slice(0, 10_000);
  if (subject.length < 2) throw new ActionError("Give the email a subject.");
  if (body.length < 2) throw new ActionError("Write the message before sending.");

  const assignee = alias(users, "assignee");
  const [row] = await db
    .select({
      lead: leads,
      source: leadSources.name,
      agentId: assignee.id,
      agentName: assignee.name,
    })
    .from(leads)
    .leftJoin(assignee, eq(assignee.id, leads.assignedTo))
    .leftJoin(leadSources, eq(leadSources.id, leads.sourceId))
    .where(eq(leads.id, opts.leadId));
  if (!row) throw new ActionError("Lead not found.");
  if (opts.restrictToAgentId && row.lead.assignedTo !== opts.restrictToAgentId) {
    throw new ActionError("You can only email a lead that is assigned to you.");
  }
  const given = (opts.to ?? "").trim();
  const to = given || (row.lead.email ?? "").trim();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    throw new ActionError("Enter the email address to send to. This lead does not have one yet.");
  }
  // a corrected or newly entered address is kept on the lead, so the next email is one click
  const saveAddress = given && given.toLowerCase() !== (row.lead.email ?? "").toLowerCase();

  const result = await sendMail({ to, subject, text: body });
  const status = result.ok ? "sent" : "failed";
  const leadName = row.lead.company || row.lead.contactName || "the lead";

  await db.transaction(async (tx) => {
    if (saveAddress) await tx.update(leads).set({ email: to }).where(eq(leads.id, opts.leadId));
    await tx.insert(leadEmails).values({
      leadId: opts.leadId,
      sentBy: opts.actorId,
      assignedAgentId: row.agentId ?? null,
      sourceId: row.lead.sourceId ?? null,
      toEmail: to,
      subject,
      body,
      status,
      error: result.ok ? null : result.error,
      messageId: result.ok ? result.messageId.slice(0, 250) : null,
    });
    await tx.insert(leadActivities).values({
      leadId: opts.leadId,
      userId: opts.actorId,
      type: result.ok ? "email_sent" : "email_failed",
      summary: result.ok ? `Follow-up email sent to ${to}` : `Follow-up email to ${to} failed`,
      data: {
        subject,
        to,
        status,
        sentBy: opts.actorName,
        assignedAgent: row.agentName ?? null,
        campaign: row.source ?? null,
        ...(result.ok ? {} : { error: result.error }),
      },
    });
    // the other side is told: Management emailing tells the agent holding the lead,
    // an agent emailing tells Management. Only ever about a real send.
    if (result.ok) {
      const sentByTheAgent = row.agentId === opts.actorId;
      if (sentByTheAgent) {
        const managers = await usersWithPermission(tx, "leads.manage");
        await notify(tx, managers.filter((id) => id !== opts.actorId), {
          type: "lead_email",
          title: "Follow-up email sent by an agent",
          body: `${opts.actorName} emailed ${leadName} at ${to}.`,
          link: `/manage/leads/${opts.leadId}`,
        });
      } else if (row.agentId) {
        await notify(tx, [row.agentId], {
          type: "lead_email",
          title: "Follow-up email sent",
          body: `A follow-up email has been sent to ${leadName} by ${opts.actorName}.`,
          link: `/agent/calls?lead=${opts.leadId}`,
        });
      }
    }
  });

  await audit({
    actorId: opts.actorId,
    action: result.ok ? "lead_email_sent" : "lead_email_failed",
    module: "leads",
    entityType: "lead",
    entityId: opts.leadId,
    summary: `${result.ok ? "Sent" : "Failed to send"} a follow-up email to ${to}`,
    after: { subject, to, status, assignedAgent: row.agentName ?? null, campaign: row.source ?? null, ...(result.ok ? {} : { error: result.error }) },
  });

  return { status, to, error: result.ok ? undefined : result.error };
}

export type LeadEmail = {
  id: string;
  subject: string;
  toEmail: string;
  status: string;
  error: string | null;
  createdAt: Date;
  sentBy: string | null;
  assignedAgent: string | null;
};

/** Every follow-up email recorded against one lead, newest first. */
export async function leadEmailHistory(leadId: string, limit = 20): Promise<LeadEmail[]> {
  const sender = alias(users, "sender");
  const agent = alias(users, "agent_at_send");
  return db
    .select({
      id: leadEmails.id,
      subject: leadEmails.subject,
      toEmail: leadEmails.toEmail,
      status: leadEmails.status,
      error: leadEmails.error,
      createdAt: leadEmails.createdAt,
      sentBy: sender.name,
      assignedAgent: agent.name,
    })
    .from(leadEmails)
    .leftJoin(sender, eq(sender.id, leadEmails.sentBy))
    .leftJoin(agent, eq(agent.id, leadEmails.assignedAgentId))
    .where(eq(leadEmails.leadId, leadId))
    .orderBy(desc(leadEmails.createdAt))
    .limit(limit);
}

/** leadId -> when the last successful follow-up email went out, for list badges. */
export async function lastEmailByLead(leadIds: string[]) {
  if (!leadIds.length) return new Map<string, Date>();
  const rows = await db
    .select({ leadId: leadEmails.leadId, createdAt: leadEmails.createdAt })
    .from(leadEmails)
    .where(and(inArray(leadEmails.leadId, leadIds), eq(leadEmails.status, "sent")))
    .orderBy(desc(leadEmails.createdAt));
  const map = new Map<string, Date>();
  for (const r of rows) if (!map.has(r.leadId)) map.set(r.leadId, r.createdAt);
  return map;
}

export type EmailLogFilters = { q?: string; status?: string; page?: number };

/** Every follow-up email ever sent, for the Management record panel. */
export async function emailLog({ q = "", status = "", page = 1 }: EmailLogFilters) {
  const perPage = 50;
  const sender = alias(users, "log_sender");
  const agent = alias(users, "log_agent");
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const where = and(
    status === "sent" || status === "failed" ? eq(leadEmails.status, status) : undefined,
    q
      ? or(ilike(leadEmails.toEmail, like), ilike(leadEmails.subject, like), ilike(leads.company, like), ilike(leads.contactName, like))
      : undefined,
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: leadEmails.id,
        leadId: leadEmails.leadId,
        company: leads.company,
        contactName: leads.contactName,
        toEmail: leadEmails.toEmail,
        subject: leadEmails.subject,
        status: leadEmails.status,
        error: leadEmails.error,
        createdAt: leadEmails.createdAt,
        sentBy: sender.name,
        assignedAgent: agent.name,
        campaign: leadSources.name,
      })
      .from(leadEmails)
      .innerJoin(leads, eq(leads.id, leadEmails.leadId))
      .leftJoin(sender, eq(sender.id, leadEmails.sentBy))
      .leftJoin(agent, eq(agent.id, leadEmails.assignedAgentId))
      .leftJoin(leadSources, eq(leadSources.id, leadEmails.sourceId))
      .where(where)
      .orderBy(desc(leadEmails.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ total: sql<number>`count(*)::int` }).from(leadEmails).innerJoin(leads, eq(leads.id, leadEmails.leadId)).where(where),
  ]);
  return { rows, total, perPage };
}
