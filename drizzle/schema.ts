import {
  date,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const departments = mysqlTable(
  "departments",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 80 }).notNull().unique(),
    name: varchar("name", { length: 180 }).notNull(),
    active: mysqlEnum("active", ["YES", "NO"]).default("YES").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("departments_active_idx").on(table.active),
  ],
);

export const interventionTypes = mysqlTable(
  "intervention_types",
  {
    id: int("id").autoincrement().primaryKey(),
    departmentId: int("departmentId").notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    active: mysqlEnum("active", ["YES", "NO"]).default("YES").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("intervention_types_department_name_unique").on(
      table.departmentId,
      table.name,
    ),
    index("intervention_types_department_active_idx").on(
      table.departmentId,
      table.active,
    ),
  ],
);

export const dateSlots = mysqlTable(
  "date_slots",
  {
    id: int("id").autoincrement().primaryKey(),
    departmentId: int("departmentId").notNull(),
    interventionTypeId: int("interventionTypeId"),
    date: date("date", { mode: "string" }).notNull(),
    federation: varchar("federation", { length: 80 }).notNull(),
    status: mysqlEnum("status", [
      "AVAILABLE",
      "PENDING_CONFIRMATION",
      "CONFIRMED",
      "UNAVAILABLE",
    ])
      .default("AVAILABLE")
      .notNull(),
    internalNote: text("internalNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    uniqueIndex("date_slots_department_federation_date_type_unique").on(
      table.departmentId,
      table.federation,
      table.date,
      table.interventionTypeId,
    ),
    index("date_slots_status_date_idx").on(table.status, table.date),
    index("date_slots_department_status_date_idx").on(
      table.departmentId,
      table.status,
      table.date,
    ),
    index("date_slots_department_federation_status_date_idx").on(
      table.departmentId,
      table.federation,
      table.status,
      table.date,
    ),
  ],
);

export const invitationRequests = mysqlTable(
  "invitation_requests",
  {
    id: int("id").autoincrement().primaryKey(),
    submissionId: varchar("submissionId", { length: 64 }).notNull().unique(),
    dateSlotId: int("dateSlotId").notNull(),
    federation: varchar("federation", { length: 80 }).notNull(),
    church: varchar("church", { length: 180 }).notNull(),
    contactName: varchar("contactName", { length: 180 }).notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    phone: varchar("phone", { length: 80 }).notNull(),
    interventionType: varchar("interventionType", { length: 80 }),
    message: text("message"),
    desiredTime: varchar("desiredTime", { length: 40 }),
    churchAddress: text("churchAddress"),
    googleCalendarEventId: varchar("googleCalendarEventId", { length: 255 }),
    consentAt: timestamp("consentAt").notNull(),
    status: mysqlEnum("status", [
      "PENDING",
      "CONFIRMED",
      "REFUSED",
      "CANCELLED",
      "RESCHEDULED",
    ])
      .default("PENDING")
      .notNull(),
    submittedAt: timestamp("submittedAt").defaultNow().notNull(),
    decisionAt: timestamp("decisionAt"),
    decisionBy: varchar("decisionBy", { length: 160 }),
    decisionNote: text("decisionNote"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [
    index("invitation_requests_date_idx").on(table.dateSlotId),
    index("invitation_requests_status_idx").on(table.status, table.submittedAt),
    index("invitation_requests_federation_idx").on(table.federation),
    index("invitation_requests_church_idx").on(table.church),
  ],
);

export const adminProfiles = mysqlTable(
  "admin_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull().unique(),
    email: varchar("email", { length: 320 }).notNull().unique(),
    role: mysqlEnum("role", ["PRIMARY_ADMIN", "ADMIN", "READ_ONLY"])
      .default("ADMIN")
      .notNull(),
    active: mysqlEnum("active", ["YES", "NO"]).default("YES").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("admin_profiles_active_idx").on(table.active)],
);

export const auditLog = mysqlTable(
  "audit_log",
  {
    id: int("id").autoincrement().primaryKey(),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 80 }).notNull(),
    requestId: int("requestId"),
    actor: varchar("actor", { length: 320 }),
    details: text("details"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_request_idx").on(table.requestId),
    index("audit_log_created_idx").on(table.createdAt),
  ],
);

export const appSettings = mysqlTable("app_settings", {
  id: int("id").autoincrement().primaryKey(),
  settingKey: varchar("settingKey", { length: 120 }).notNull().unique(),
  settingValue: text("settingValue").notNull(),
  updatedBy: varchar("updatedBy", { length: 320 }),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const emailOutbox = mysqlTable(
  "email_outbox",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: int("requestId"),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    replyTo: varchar("replyTo", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 500 }).notNull(),
    html: text("html").notNull(),
    status: mysqlEnum("status", [
      "PENDING",
      "PREVIEW",
      "SENDING",
      "SENT",
      "FAILED",
    ])
      .default("PENDING")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    lastError: text("lastError"),
    sentAt: timestamp("sentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("email_outbox_status_idx").on(table.status, table.createdAt),
  ],
);

export const actionTokens = mysqlTable(
  "action_tokens",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: int("requestId").notNull(),
    action: mysqlEnum("action", ["CONFIRM", "RELEASE"]).notNull(),
    tokenHash: varchar("tokenHash", { length: 128 }).notNull().unique(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("action_tokens_request_idx").on(table.requestId, table.action),
  ],
);

export const microsoftOAuthStates = mysqlTable(
  "microsoft_oauth_states",
  {
    id: int("id").autoincrement().primaryKey(),
    stateHash: varchar("stateHash", { length: 64 }).notNull().unique(),
    verifierEncrypted: text("verifierEncrypted").notNull(),
    userId: int("userId").notNull(),
    platform: mysqlEnum("platform", ["web", "native"]).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [index("microsoft_oauth_expiry_idx").on(table.expiresAt)],
);

export const microsoftMailConnections = mysqlTable(
  "microsoft_mail_connections",
  {
    id: int("id").primaryKey(),
    mailboxEmail: varchar("mailboxEmail", { length: 320 }).notNull(),
    refreshTokenEncrypted: text("refreshTokenEncrypted").notNull(),
    connectedBy: varchar("connectedBy", { length: 80 }).notNull(),
    connectedAt: timestamp("connectedAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
);

export const googleMailConnections = mysqlTable("google_mail_connections", {
  id: int("id").primaryKey(),
  mailboxEmail: varchar("mailboxEmail", { length: 320 }).notNull(),
  refreshTokenEncrypted: text("refreshTokenEncrypted").notNull(),
  connectedBy: varchar("connectedBy", { length: 80 }).notNull(),
  connectedAt: timestamp("connectedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export const privacyRequests = mysqlTable("privacy_requests", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  requestType: mysqlEnum("requestType", ["ACCESS", "DELETE"]).notNull(),
  message: text("message"),
  status: mysqlEnum("status", ["NEW", "IN_PROGRESS", "COMPLETED"])
    .default("NEW")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export const reminderLog = mysqlTable(
  "reminder_log",
  {
    id: int("id").autoincrement().primaryKey(),
    requestId: int("requestId").notNull(),
    slotDate: date("slotDate", { mode: "string" }).notNull(),
    reminderKind: mysqlEnum("reminderKind", ["D30", "D7", "D1"]).notNull(),
    recipient: varchar("recipient", { length: 320 }).notNull(),
    sentAt: timestamp("sentAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("reminder_request_date_kind_recipient_unique").on(
      table.requestId,
      table.slotDate,
      table.reminderKind,
      table.recipient,
    ),
  ],
);

export const scheduledJobs = mysqlTable(
  "scheduled_jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    jobKey: varchar("jobKey", { length: 80 }).notNull().unique(),
    taskUid: varchar("taskUid", { length: 160 }).unique(),
    active: mysqlEnum("active", ["YES", "NO"]).default("YES").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [index("scheduled_jobs_active_idx").on(table.active)],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type DateSlot = typeof dateSlots.$inferSelect;
export type InvitationRequest = typeof invitationRequests.$inferSelect;
