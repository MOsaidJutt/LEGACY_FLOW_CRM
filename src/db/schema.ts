import {
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () =>
  ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v)),
});

/* ------------------------------------------------------------------ enums */

export const userStatus = pgEnum("user_status", ["active", "inactive"]);

/**
 * available  - in the central pool
 * assigned   - locked to an agent's working list (returns to pool on logout)
 * follow_up  - retained with the agent after a callback / email / qualified outcome
 * closed     - finished (e.g. not interested)
 * dnc        - on the internal do-not-call list
 */
export const leadStatus = pgEnum("lead_status", ["available", "assigned", "follow_up", "closed", "dnc"]);

/** What happens to a lead after an agent saves this disposition. */
export const dispositionAction = pgEnum("disposition_action", ["release", "retain", "close", "dnc"]);

export const importStatus = pgEnum("import_status", ["uploaded", "mapped", "imported", "cancelled"]);
export const rowDecision = pgEnum("row_decision", ["import", "reject", "keep_both", "update", "review"]);

export const leadRequestStatus = pgEnum("lead_request_status", [
  "pending",
  "approved",
  "rejected",
  "auto_approved",
  "cancelled",
]);

export const assignmentAction = pgEnum("assignment_action", [
  "assigned",
  "released",
  "transferred",
  "returned_on_logout",
  "returned_on_timeout",
]);

export const callbackStatus = pgEnum("callback_status", ["pending", "done", "cancelled"]);
export const presenceState = pgEnum("presence_state", ["active", "idle", "break", "offline"]);
export const leaveStatus = pgEnum("leave_status", ["pending", "approved", "rejected", "cancelled"]);
export const conversationKind = pgEnum("conversation_kind", ["direct", "group"]);
export const reviewStatus = pgEnum("review_status", ["draft", "approved"]);

/* ------------------------------------------------------------------ people & access */

export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
});

export const shifts = pgTable("shifts", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  /** 0 = Sunday ... 6 = Saturday, in the business time zone */
  days: jsonb("days").$type<number[]>().notNull().default([1, 2, 3, 4, 5]),
  graceMinutes: integer("grace_minutes").notNull().default(10),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 200 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    status: userStatus("status").notNull().default("active"),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    shiftId: uuid("shift_id").references(() => shifts.id, { onDelete: "set null" }),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    /** sha256 of the cookie token; the raw token never touches the database */
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    endedAt: ts("ended_at"),
    endReason: varchar("end_reason", { length: 30 }),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const groups = pgTable("groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  description: text("description"),
  createdAt: createdAt(),
});

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);

/* ------------------------------------------------------------------ leads */

export const leadSources = pgTable("lead_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull().unique(),
  description: text("description"),
  createdAt: createdAt(),
});

/** CRM lead fields. Core fields map to lead columns; the rest live in leads.extra. */
export const leadFields = pgTable("lead_fields", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 60 }).notNull().unique(),
  label: varchar("label", { length: 80 }).notNull(),
  type: varchar("type", { length: 20 }).notNull().default("text"),
  isCore: boolean("is_core").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: createdAt(),
});

export const dispositions = pgTable("dispositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 40 }).notNull().unique(),
  label: varchar("label", { length: 60 }).notNull(),
  description: text("description"),
  action: dispositionAction("action").notNull(),
  requiresCallback: boolean("requires_callback").notNull().default(false),
  /** neutral | success | warning | danger | info */
  tone: varchar("tone", { length: 12 }).notNull().default("neutral"),
  isSystem: boolean("is_system").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(100),
  createdAt: createdAt(),
});

export const imports = pgTable("imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileName: varchar("file_name", { length: 255 }).notNull(),
  uploadedBy: uuid("uploaded_by")
    .notNull()
    .references(() => users.id),
  sourceId: uuid("source_id").references(() => leadSources.id),
  status: importStatus("status").notNull().default("uploaded"),
  headers: jsonb("headers").$type<string[]>().notNull().default([]),
  /** uploaded header -> lead field key ("" = ignore column) */
  mapping: jsonb("mapping").$type<Record<string, string>>().notNull().default({}),
  stats: jsonb("stats").$type<ImportStats>().notNull().default({} as ImportStats),
  createdAt: createdAt(),
  importedAt: ts("imported_at"),
});

export type ImportStats = {
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  missingRows: number;
  invalidPhoneRows: number;
  readyRows: number;
  importedRows?: number;
  updatedRows?: number;
  rejectedRows?: number;
  reviewRows?: number;
};

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => leadSources.id),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    company: varchar("company", { length: 255 }),
    contactName: varchar("contact_name", { length: 255 }),
    title: varchar("title", { length: 255 }),
    phone: varchar("phone", { length: 60 }),
    phoneE164: varchar("phone_e164", { length: 20 }),
    email: varchar("email", { length: 255 }),
    website: varchar("website", { length: 255 }),
    city: varchar("city", { length: 120 }),
    state: varchar("state", { length: 60 }),
    industry: varchar("industry", { length: 120 }),
    extra: jsonb("extra").$type<Record<string, string>>().notNull().default({}),
    status: leadStatus("status").notNull().default("available"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    assignedAt: ts("assigned_at"),
    lastDispositionId: uuid("last_disposition_id").references(() => dispositions.id),
    lastCalledAt: ts("last_called_at"),
    callCount: integer("call_count").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_assigned_idx").on(t.assignedTo, t.status),
    index("leads_phone_idx").on(t.phoneE164),
    index("leads_email_idx").on(t.email),
    index("leads_source_idx").on(t.sourceId),
  ],
);

export const importRows = pgTable(
  "import_rows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    importId: uuid("import_id")
      .notNull()
      .references(() => imports.id, { onDelete: "cascade" }),
    rowNumber: integer("row_number").notNull(),
    raw: jsonb("raw").$type<Record<string, string>>().notNull(),
    values: jsonb("values").$type<Record<string, string>>().notNull().default({}),
    /** missing_phone | missing_contact | invalid_phone | invalid_email | duplicate_in_file | duplicate_existing */
    issues: jsonb("issues").$type<string[]>().notNull().default([]),
    matchLeadId: uuid("match_lead_id").references(() => leads.id, { onDelete: "set null" }),
    matchReason: varchar("match_reason", { length: 60 }),
    decision: rowDecision("decision").notNull().default("import"),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  },
  (t) => [index("import_rows_import_idx").on(t.importId, t.rowNumber)],
);

export const leadRequests = pgTable(
  "lead_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    requestedQty: integer("requested_qty").notNull(),
    approvedQty: integer("approved_qty"),
    assignedQty: integer("assigned_qty").notNull().default(0),
    status: leadRequestStatus("status").notNull().default("pending"),
    note: text("note"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    decidedAt: ts("decided_at"),
    decidedBy: uuid("decided_by").references(() => users.id),
  },
  (t) => [index("lead_requests_status_idx").on(t.status, t.expiresAt), index("lead_requests_agent_idx").on(t.agentId)],
);

export const leadAssignments = pgTable(
  "lead_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: assignmentAction("action").notNull(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    requestId: uuid("request_id").references(() => leadRequests.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("lead_assignments_lead_idx").on(t.leadId), index("lead_assignments_user_idx").on(t.userId)],
);

/** Unified lead timeline (imports, assignments, calls, notes, callbacks, edits). */
export const leadActivities = pgTable(
  "lead_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    type: varchar("type", { length: 40 }).notNull(),
    summary: text("summary").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.createdAt)],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id),
    phone: varchar("phone", { length: 60 }),
    /** dialer | url | clipboard */
    method: varchar("method", { length: 20 }).notNull(),
    startedAt: ts("started_at").notNull().defaultNow(),
    endedAt: ts("ended_at"),
    durationSec: integer("duration_sec"),
    dispositionId: uuid("disposition_id").references(() => dispositions.id),
    notes: text("notes"),
    externalId: varchar("external_id", { length: 120 }),
    recordingUrl: text("recording_url"),
    createdAt: createdAt(),
  },
  (t) => [index("calls_agent_idx").on(t.agentId, t.startedAt), index("calls_lead_idx").on(t.leadId)],
);

export const callbacks = pgTable(
  "callbacks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dueAt: ts("due_at").notNull(),
    status: callbackStatus("status").notNull().default("pending"),
    note: text("note"),
    remindedAt: ts("reminded_at"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("callbacks_agent_idx").on(t.agentId, t.status, t.dueAt)],
);

export const dncNumbers = pgTable("dnc_numbers", {
  phoneE164: varchar("phone_e164", { length: 20 }).primaryKey(),
  reason: text("reason"),
  leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

/* ------------------------------------------------------------------ monitoring */

/** One row per user: current presence, updated by heartbeats. */
export const presence = pgTable("presence", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  state: presenceState("state").notNull().default("offline"),
  since: ts("since").notNull().defaultNow(),
  lastHeartbeatAt: ts("last_heartbeat_at"),
  lastWebActivityAt: ts("last_web_activity_at"),
  lastDesktopActivityAt: ts("last_desktop_activity_at"),
  desktopApp: varchar("desktop_app", { length: 200 }),
  breakType: varchar("break_type", { length: 40 }),
  sessionId: varchar("session_id", { length: 64 }),
});

/** Closed-open time segments used for active / idle / break / screen-time reporting. */
export const presenceSegments = pgTable(
  "presence_segments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    state: presenceState("state").notNull(),
    breakType: varchar("break_type", { length: 40 }),
    startedAt: ts("started_at").notNull(),
    endedAt: ts("ended_at"),
  },
  (t) => [index("presence_segments_user_idx").on(t.userId, t.startedAt)],
);

export const activityEvents = pgTable(
  "activity_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: varchar("session_id", { length: 64 }),
    type: varchar("type", { length: 40 }).notNull(),
    summary: text("summary"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    source: varchar("source", { length: 12 }).notNull().default("web"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_events_user_idx").on(t.userId, t.createdAt)],
);

export const desktopDevices = pgTable("desktop_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  lastSeenAt: ts("last_seen_at"),
  createdAt: createdAt(),
  revokedAt: ts("revoked_at"),
});

/* ------------------------------------------------------------------ settings & audit */

export const settings = pgTable("settings", {
  key: varchar("key", { length: 80 }).primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 60 }).notNull(),
    module: varchar("module", { length: 30 }).notNull(),
    entityType: varchar("entity_type", { length: 40 }),
    entityId: varchar("entity_id", { length: 80 }),
    summary: text("summary"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    ip: varchar("ip", { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_module_idx").on(t.module, t.createdAt),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ communication */

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  mime: varchar("mime", { length: 120 }).notNull(),
  size: integer("size").notNull(),
  data: bytea("data").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: conversationKind("kind").notNull(),
  title: varchar("title", { length: 120 }),
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
  /** For direct conversations: "<smallerUserId>:<largerUserId>" so each pair has one thread. */
  directKey: varchar("direct_key", { length: 80 }).unique(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  lastMessageAt: ts("last_message_at"),
});

export const conversationMembers = pgTable(
  "conversation_members",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadAt: ts("last_read_at"),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] }), index("conversation_members_user_idx").on(t.userId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderId: uuid("sender_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    fileId: uuid("file_id").references(() => files.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

export const announcements = pgTable("announcements", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: varchar("title", { length: 160 }).notNull(),
  body: text("body").notNull(),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  /** null = everyone */
  groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
  requiresAck: boolean("requires_ack").notNull().default(false),
  createdAt: createdAt(),
});

export const announcementAcks = pgTable(
  "announcement_acks",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ackedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: varchar("type", { length: 40 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    body: text("body"),
    link: varchar("link", { length: 300 }),
    readAt: ts("read_at"),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/* ------------------------------------------------------------------ HR */

export const employeeProfiles = pgTable("employee_profiles", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  employeeCode: varchar("employee_code", { length: 40 }).unique(),
  phone: varchar("phone", { length: 40 }),
  personalEmail: varchar("personal_email", { length: 200 }),
  joiningDate: date("joining_date"),
  jobTitle: varchar("job_title", { length: 120 }),
  department: varchar("department", { length: 120 }),
  address: text("address"),
  emergencyContact: text("emergency_contact"),
  notes: text("notes"),
  updatedAt: updatedAt(),
});

export const hrDocuments = pgTable(
  "hr_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: varchar("category", { length: 60 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id),
    notes: text("notes"),
    expiresOn: date("expires_on"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("hr_documents_user_idx").on(t.userId)],
);

export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  daysPerYear: integer("days_per_year"),
  active: boolean("active").notNull().default(true),
});

export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaveTypeId: uuid("leave_type_id")
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    reason: text("reason"),
    status: leaveStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: ts("decided_at"),
    comment: text("comment"),
    createdAt: createdAt(),
  },
  (t) => [index("leave_requests_user_idx").on(t.userId, t.startDate)],
);

export const holidays = pgTable("holidays", {
  id: uuid("id").primaryKey().defaultRandom(),
  date: date("date").notNull().unique(),
  name: varchar("name", { length: 120 }).notNull(),
});

export const employeeEvents = pgTable(
  "employee_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** warning | review | change | note */
    kind: varchar("kind", { length: 20 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    details: text("details"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("employee_events_user_idx").on(t.userId, t.createdAt)],
);

/* ------------------------------------------------------------------ performance & reports */

export const performanceReviews = pgTable(
  "performance_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodType: varchar("period_type", { length: 12 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    metrics: jsonb("metrics").$type<Record<string, number>>().notNull().default({}),
    managementScore: integer("management_score"),
    comment: text("comment"),
    status: reviewStatus("status").notNull().default("draft"),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("performance_reviews_period_uq").on(t.userId, t.periodType, t.periodStart)],
);

export const scoreChanges = pgTable("score_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  reviewId: uuid("review_id")
    .notNull()
    .references(() => performanceReviews.id, { onDelete: "cascade" }),
  oldScore: integer("old_score"),
  newScore: integer("new_score"),
  reason: text("reason").notNull(),
  changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: varchar("type", { length: 20 }).notNull(),
    title: varchar("title", { length: 200 }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    filters: jsonb("filters").$type<Record<string, unknown>>().notNull().default({}),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    generatedBy: uuid("generated_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    createdAt: createdAt(),
  },
  (t) => [index("reports_created_idx").on(t.createdAt)],
);
