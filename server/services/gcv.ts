import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  like,
  lt,
  or,
} from "drizzle-orm";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  actionTokens,
  adminCredentials,
  adminDepartments,
  adminProfiles,
  appSettings,
  auditLog,
  dateSlots,
  departments,
  emailOutbox,
  interventionTypes,
  invitationRequests,
  privacyRequests,
  reminderLog,
  scheduledJobs,
  users,
} from "../../drizzle/schema";
import {
  DEFAULT_EMAIL_TEMPLATES,
  ADMIN_EMAIL,
  DEFAULT_FIELDS,
  FEDERATIONS,
  isoDate,
  toFrenchDate,
  type SlotStatus,
} from "../../shared/gcv";
import { getDb, type AdminScope } from "../db";
import { hashPassword } from "../_core/password";
function departmentScopeCondition(
  scope: AdminScope,
  column: typeof dateSlots.departmentId | typeof invitationRequests.departmentId | typeof departments.id | typeof interventionTypes.departmentId,
) {
  if (scope.allDepartments) return undefined;
  if (!scope.departmentIds.length) return eq(column, -1);
  return inArray(column, scope.departmentIds);
}

function assertDepartmentAccess(
  scope: AdminScope,
  departmentId: number,
) {
  if (scope.allDepartments) return;

  if (!scope.departmentIds.includes(departmentId)) {
    throw new Error("Vous n’êtes pas autorisé à administrer ce département.");
  }
}

import { deliverOutbox, emailShell } from "./email";
import { gmailConnectionStatus } from "./gmail-smtp";
import {
  createGcvCalendarEvent,
  deleteGcvCalendarEvent,
  updateGcvCalendarEvent,
  type GcvCalendarInvitation,
} from "./google-calendar";

const SETTING_DEFAULTS: Record<string, unknown> = {
  federations: FEDERATIONS,
  fields: DEFAULT_FIELDS,
  reminders: { enabled: true, recipient: ADMIN_EMAIL, includeRequester: false },
  retention: { months: 36 },
  emailTemplates: DEFAULT_EMAIL_TEMPLATES,
};

// Drizzle transaction and connection objects share this operational surface but do not
// share the driver's private $client field in their public TypeScript declarations.
type DbLike = any;
type RequestWithSlot = {
  request: typeof invitationRequests.$inferSelect;
  slot: typeof dateSlots.$inferSelect;
  department?: typeof departments.$inferSelect | null;
};

export class SlotTakenError extends Error {
  constructor() {
    super("Cette date vient d’être réservée par une autre personne. Merci de choisir une autre date disponible.");
  }
}

function today() {
  return isoDate(new Date());
}

function resultRows(result: unknown): number {
  const first = Array.isArray(result) ? result[0] : result;
  return Number((first as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

function insertId(result: unknown): number {
  const first = Array.isArray(result) ? result[0] : result;
  return Number((first as { insertId?: number } | undefined)?.insertId ?? 0);
}

async function outboxStatus(id: number): Promise<"PENDING" | "PREVIEW" | "SENDING" | "SENT" | "FAILED"> {
  if (!id) return "PENDING";
  const db = await requireDb();
  const rows = await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, id)).limit(1);
  return rows[0]?.status ?? "PENDING";
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function esc(value: string | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

function renderSubject(template: string, values: Record<string, string>) {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key] ?? "").slice(0, 500);
}

function renderTemplate(template: string, values: Record<string, string>) {
  const text = template.replace(/\{\{([a-z_]+)\}\}/g, (_match, key: string) => values[key] ?? "");
  return `<p>${esc(text).replace(/\r?\n/g, "<br/>")}</p>`;
}

function configuredTemplates(configuration: Record<string, unknown>) {
  const value = configuration.emailTemplates;
  return { ...DEFAULT_EMAIL_TEMPLATES, ...(value && typeof value === "object" ? value : {}) } as Record<keyof typeof DEFAULT_EMAIL_TEMPLATES, string>;
}

function publicBaseUrl() {
  return (process.env.PUBLIC_APP_URL || process.env.EXPO_WEB_PREVIEW_URL || "").replace(/\/$/, "");
}

function publicApiBaseUrl() {
  return (
    process.env.PUBLIC_API_URL ||
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.EXPO_WEB_PREVIEW_URL ||
    ""
  ).replace(/\/$/, "");
}

function actionHref(token: string) {
  return `${publicApiBaseUrl()}/api/actions/${encodeURIComponent(token)}`;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("La base de données n’est pas disponible.");
  return db;
}

async function recordAudit(
  tx: DbLike,
  action: string,
  entityType: string,
  entityId: string | number,
  actor: string | null | undefined,
  details?: unknown,
  requestId?: number,
) {
  await tx.insert(auditLog).values({
    action,
    entityType,
    entityId: String(entityId),
    actor: actor ?? null,
    requestId: requestId ?? null,
    details: details ? JSON.stringify(details) : null,
  });
}

async function createToken(tx: DbLike, requestId: number, action: "CONFIRM" | "RELEASE") {
  const raw = randomBytes(32).toString("base64url");
  await tx.insert(actionTokens).values({
    requestId,
    action,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
  });
  return raw;
}

async function getSettingsMap() {
  const db = await requireDb();
  const rows = await db.select().from(appSettings);
  const values: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    try {
      values[row.settingKey] = JSON.parse(row.settingValue);
    } catch {
      values[row.settingKey] = row.settingValue;
    }
  }
  return values;
}

export async function formOptions() {
  const values = await getSettingsMap();
  return { federations: Array.isArray(values.federations) ? values.federations as string[] : [...FEDERATIONS] };
}

export async function listPublicBootstrap() {
  const db = await requireDb();
  const slots = await db
    .select({ id: dateSlots.id, date: dateSlots.date, departmentId: dateSlots.departmentId, federation: dateSlots.federation })
    .from(dateSlots)
    .innerJoin(departments, and(eq(dateSlots.departmentId, departments.id), eq(departments.active, "YES")))
    .where(and(eq(dateSlots.status, "AVAILABLE"), gte(dateSlots.date, today())))
    .orderBy(asc(dateSlots.date));
  const departmentRows = await db
    .select()
    .from(departments)
    .where(eq(departments.active, "YES"))
    .orderBy(asc(departments.name));

  const interventionTypeRows = await db
    .select()
    .from(interventionTypes)
    .where(eq(interventionTypes.active, "YES"))
    .orderBy(asc(interventionTypes.name));

  const settings = await getSettingsMap();
  const mail = await gmailConnectionStatus();

  return {
    dates: slots,
    departments: departmentRows,
    interventionTypes: interventionTypeRows,
    federations: Array.isArray(settings.federations) ? settings.federations : FEDERATIONS,
    fields: settings.fields ?? DEFAULT_FIELDS,
    emailReady: mail.configured && mail.connected,
  };
}

async function departmentNotificationRecipients(db: DbLike, departmentId: number): Promise<string[]> {
  const admins: { email: string }[] = await db
    .select({ email: adminProfiles.email })
    .from(adminProfiles)
    .leftJoin(adminDepartments, and(eq(adminDepartments.adminProfileId, adminProfiles.id), eq(adminDepartments.departmentId, departmentId)))
    .where(and(eq(adminProfiles.active, "YES"), or(
      eq(adminProfiles.role, "PRIMARY_ADMIN"),
      and(eq(adminProfiles.role, "ADMIN"), eq(adminDepartments.departmentId, departmentId)),
    )));
  // Preserve the pilot's central mailbox and notify the authorized department managers.
  return [...new Set([ADMIN_EMAIL, ...admins.map((admin) => admin.email.trim().toLowerCase())])];
}

export async function createInvitation(input: {
  dateSlotId: number;
  federation: string;
  church: string;
  contactName: string;
  email: string;
  phone: string;
  interventionTypeId: number;
  message?: string | null;
  desiredTime?: string | null;
  churchAddress?: string | null;
  consent: true;
  notify?: boolean;
  }) {
  if (input.consent !== true) throw new Error("Votre consentement est requis pour envoyer cette demande.");
  const mail = input.notify === false
    ? { configured: false, connected: false }
    : await gmailConnectionStatus();
  const shouldNotify = process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED === "true" && input.notify !== false && mail.configured && mail.connected;
  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations) ? configuration.federations as string[] : [...FEDERATIONS];
  if (!federations.includes(input.federation)) throw new Error("Veuillez choisir une fédération disponible.");
  const fieldSettings = { ...DEFAULT_FIELDS, ...(configuration.fields && typeof configuration.fields === "object" ? configuration.fields : {}) } as Record<string, { visible?: boolean; required?: boolean }>;
  const extraValues: Record<string, unknown> = {
    message: input.message,
    desiredTime: input.desiredTime,
    churchAddress: input.churchAddress,
  };
  const fieldLabels: Record<string, string> = { interventionType: "Type d’intervention", message: "Message", desiredTime: "Heure souhaitée", churchAddress: "Adresse de l’église" };
  for (const [key, value] of Object.entries(extraValues)) {
    const rules = fieldSettings[key];
    if (rules?.visible !== false && rules?.required && !String(value ?? "").trim()) throw new Error(`${fieldLabels[key]} est obligatoire.`);
  }
  const storedField = (key: string, value: string | null | undefined) => fieldSettings[key]?.visible === false ? null : value?.trim() || null;
  const message = storedField("message", input.message);
  const desiredTime = storedField("desiredTime", input.desiredTime);
  const churchAddress = storedField("churchAddress", input.churchAddress);
  const db = await requireDb();
  const outcome = await db.transaction(async (tx) => {
    const slotRows = await tx.select().from(dateSlots).where(eq(dateSlots.id, input.dateSlotId)).limit(1);
    const slot = slotRows[0];
    if (
      !slot ||
      slot.status !== "AVAILABLE" ||
      slot.date < today() ||
      slot.federation !== input.federation
    ) throw new SlotTakenError();

    const department = (await tx.select().from(departments).where(and(eq(departments.id, slot.departmentId), eq(departments.active, "YES"))).limit(1))[0];
    if (!department) throw new Error("Le département sélectionné n’est plus disponible.");

    const interventionTypeRows = await tx
      .select()
      .from(interventionTypes)
      .where(
        and(
          eq(interventionTypes.id, input.interventionTypeId),
          eq(interventionTypes.departmentId, slot.departmentId),
          eq(interventionTypes.active, "YES"),
        ),
      )
      .limit(1);

    const selectedInterventionType = interventionTypeRows[0];

    if (!selectedInterventionType) {
      throw new Error(
        "Le type d’intervention sélectionné n’est pas disponible pour ce département.",
      );
    }

    const interventionType = selectedInterventionType.name;

    const locked = await tx
      .update(dateSlots)
      .set({ status: "PENDING_CONFIRMATION", updatedAt: new Date() })
      .where(and(
        eq(dateSlots.id, input.dateSlotId),
        eq(dateSlots.status, "AVAILABLE"),
        eq(dateSlots.federation, input.federation),
      ));
    if (resultRows(locked) !== 1) throw new SlotTakenError();

    const submissionId = `UFB-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const inserted = await tx.insert(invitationRequests).values({
      submissionId,
      dateSlotId: input.dateSlotId,
      departmentId: slot.departmentId,
      interventionTypeId: selectedInterventionType.id,
      federation: input.federation,
      church: input.church,
      contactName: input.contactName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      interventionType,
      message,
      desiredTime,
      churchAddress,
      consentAt: new Date(),
      status: "PENDING",
    });
    const requestId = insertId(inserted);
    const confirmToken = await createToken(tx as DbLike, requestId, "CONFIRM");
    const releaseToken = await createToken(tx as DbLike, requestId, "RELEASE");
    const dateLabel = toFrenchDate(slot.date);
    const templates = configuredTemplates(configuration);
    const values = { departement: department.name, date: dateLabel, federation: input.federation, eglise: input.church, contact: input.contactName, email: input.email, telephone: input.phone, type: interventionType ?? "—", heure: desiredTime ?? "—", adresse: churchAddress ?? "—", message: message ?? "—", identifiant: submissionId, prenom: input.contactName.split(/\s+/)[0] || input.contactName, lien_agenda: publicBaseUrl() };
    const requestSubject = renderSubject(templates.requestSubject, values);
    const requestBody = renderTemplate(templates.requestBody, values);
    const recipients = await departmentNotificationRecipients(tx as DbLike, slot.departmentId);
    const adminOutboxIds: number[] = [];
    for (const recipient of shouldNotify ? recipients : []) {
    const adminMail = await tx.insert(emailOutbox).values({
      requestId,
      recipient,
      replyTo: ADMIN_EMAIL,
      subject: `${department.code} — ${requestSubject}`.slice(0, 500),
      html: emailShell(
        "Nouvelle demande d’intervention UFB",
        `<p><strong>Département : ${esc(department.name)}</strong></p>${requestBody}<p><a href="${actionHref(confirmToken)}" style="display:inline-block;background:#176b9b;color:#fff;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">CONFIRMER L’INVITATION</a></p><p><a href="${actionHref(releaseToken)}" style="display:inline-block;background:#a55f08;color:#fff;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">LIBÉRER / REFUSER</a></p>`,
      ),
      status: "PENDING",
    });
    adminOutboxIds.push(insertId(adminMail));
    }
    await recordAudit(tx as DbLike, "REQUEST_CREATED", "invitation_request", requestId, input.email, { submissionId, date: slot.date }, requestId);
    return { requestId, submissionId, date: slot.date, church: input.church, adminOutboxIds };
  });
  if (shouldNotify && outcome.adminOutboxIds.length) await deliverOutbox(outcome.adminOutboxIds);
  const { adminOutboxIds, ...publicOutcome } = outcome;
  const statuses = shouldNotify ? await Promise.all(adminOutboxIds.map(outboxStatus)) : [];
  const adminEmailStatus = statuses.length && statuses.every((value) => value === "SENT")
    ? "SENT" as const : statuses.includes("FAILED") ? "FAILED" as const : "PENDING" as const;
  return { ...publicOutcome, adminEmailStatus };
}

async function requestWithSlot(db: DbLike, requestId: number): Promise<RequestWithSlot | null> {
  const rows = await db
    .select({ request: invitationRequests, slot: dateSlots, department: departments })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .leftJoin(departments, eq(invitationRequests.departmentId, departments.id))
    .where(eq(invitationRequests.id, requestId))
    .limit(1);
  return rows[0] ?? null;
}

function calendarInvitation(request: RequestWithSlot): GcvCalendarInvitation {
  return {
    departmentName: request.department?.name,
    submissionId: request.request.submissionId,
    date: request.slot.date,
    federation: request.request.federation,
    church: request.request.church,
    contactName: request.request.contactName,
    email: request.request.email,
    phone: request.request.phone,
    interventionType: request.request.interventionType,
    desiredTime: request.request.desiredTime,
    churchAddress: request.request.churchAddress,
    message: request.request.message,
  };
}

async function syncConfirmedCalendarEvent(request: RequestWithSlot, actor: string) {
  if (!process.env.GOOGLE_CALENDAR_ID?.trim()) return null;
  const db = await requireDb();

  try {
    let eventId = request.request.googleCalendarEventId;

    if (eventId) {
      await updateGcvCalendarEvent(eventId, calendarInvitation(request));

      await recordAudit(
        db,
        "GOOGLE_CALENDAR_EVENT_UPDATED",
        "invitation_request",
        request.request.id,
        actor,
        { eventId, date: request.slot.date },
        request.request.id,
      );

      return eventId;
    }

    eventId = await createGcvCalendarEvent(calendarInvitation(request));

    await db
      .update(invitationRequests)
      .set({
        googleCalendarEventId: eventId,
        updatedAt: new Date(),
      })
      .where(and(
        eq(invitationRequests.id, request.request.id),
        eq(invitationRequests.status, "CONFIRMED"),
      ));

    await recordAudit(
      db,
      "GOOGLE_CALENDAR_EVENT_CREATED",
      "invitation_request",
      request.request.id,
      actor,
      { eventId, date: request.slot.date },
      request.request.id,
    );

    return eventId;
  } catch (error) {
    console.error("[Google Calendar] synchronization failed", error);

    try {
      await recordAudit(
        db,
        "GOOGLE_CALENDAR_SYNC_FAILED",
        "invitation_request",
        request.request.id,
        actor,
        {
          date: request.slot.date,
          error: error instanceof Error ? error.message : String(error),
        },
        request.request.id,
      );
    } catch (auditError) {
      console.error("[Google Calendar] audit failure", auditError);
    }

    return null;
  }
}

async function removeConfirmedCalendarEvent(request: RequestWithSlot, actor: string) {
  const eventId = request.request.googleCalendarEventId;

  if (!eventId) return;

  const db = await requireDb();

  try {
    await deleteGcvCalendarEvent(eventId);

    await db
      .update(invitationRequests)
      .set({
        googleCalendarEventId: null,
        updatedAt: new Date(),
      })
      .where(eq(invitationRequests.id, request.request.id));

    await recordAudit(
      db,
      "GOOGLE_CALENDAR_EVENT_DELETED",
      "invitation_request",
      request.request.id,
      actor,
      { eventId, date: request.slot.date },
      request.request.id,
    );
  } catch (error) {
    console.error("[Google Calendar] deletion failed", error);

    try {
      await recordAudit(
        db,
        "GOOGLE_CALENDAR_SYNC_FAILED",
        "invitation_request",
        request.request.id,
        actor,
        {
          operation: "DELETE",
          eventId,
          error: error instanceof Error ? error.message : String(error),
        },
        request.request.id,
      );
    } catch (auditError) {
      console.error("[Google Calendar] audit failure", auditError);
    }
  }
}

async function queueDecisionEmail(request: RequestWithSlot, outcome: "CONFIRMED" | "REFUSED" | "CANCELLED" | "RESCHEDULED" | "UPDATED") {
  if (process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED !== "true") {
    return "PENDING" as const;
  }
  const db = await requireDb();
  const configuration = await getSettingsMap();
  const templates = configuredTemplates(configuration);
  const dateLabel = toFrenchDate(request.slot.date);
  const values = {
    departement: request.department?.name ?? `Département #${request.request.departmentId}`,
    date: dateLabel,
    federation: request.request.federation,
    eglise: request.request.church,
    contact: request.request.contactName,
    email: request.request.email,
    telephone: request.request.phone,
    type: request.request.interventionType ?? "—",
    heure: request.request.desiredTime ?? "—",
    adresse: request.request.churchAddress ?? "—",
    message: request.request.message ?? "—",
    identifiant: request.request.submissionId,
    prenom: request.request.contactName.split(/\s+/)[0] || request.request.contactName,
    lien_agenda: publicBaseUrl(),
  };
  const templateKeys: Record<typeof outcome, [keyof typeof DEFAULT_EMAIL_TEMPLATES, keyof typeof DEFAULT_EMAIL_TEMPLATES]> = {
    CONFIRMED: ["confirmationSubject", "confirmationBody"],
    REFUSED: ["refusalSubject", "refusalBody"],
    CANCELLED: ["cancellationSubject", "cancellationBody"],
    RESCHEDULED: ["rescheduleSubject", "rescheduleBody"],
    UPDATED: ["updateSubject", "updateBody"],
  };
  const [subjectKey, bodyKey] = templateKeys[outcome];
  const subject = renderSubject(templates[subjectKey], values);
  const body = renderTemplate(templates[bodyKey], values);
  const inserted = await db.insert(emailOutbox).values({
    requestId: request.request.id,
    recipient: request.request.email,
    replyTo: ADMIN_EMAIL,
    subject,
    html: emailShell(subject, body),
    status: "PENDING",
  });
  const id = insertId(inserted);
  await deliverOutbox(id ? [id] : undefined);
  return outboxStatus(id);
}

export async function decideRequest(input: {
  requestId: number;
  action: "CONFIRM" | "RELEASE";
  actor: string;
  note?: string;
  notify?: boolean;
  scope: AdminScope;
}) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const joined = await requestWithSlot(tx as DbLike, input.requestId);
    if (!joined || joined.request.status !== "PENDING" || joined.slot.status !== "PENDING_CONFIRMATION") {
      throw new Error("Cette demande n’est plus en attente de confirmation.");
    }

    assertDepartmentAccess(input.scope, joined.request.departmentId);

    if (joined.slot.departmentId !== joined.request.departmentId) {
      throw new Error("Le département de la demande ne correspond pas à celui de la date.");
    }
    const outcome = input.action === "CONFIRM" ? "CONFIRMED" : "REFUSED";
    const requestChanged = await tx
      .update(invitationRequests)
      .set({ status: outcome, decisionAt: new Date(), decisionBy: input.actor, decisionNote: input.note ?? null })
      .where(and(eq(invitationRequests.id, input.requestId), eq(invitationRequests.status, "PENDING")));
    if (resultRows(requestChanged) !== 1) throw new Error("Cette demande n’est plus en attente de confirmation.");
    const slotChanged = await tx
      .update(dateSlots)
      .set({ status: input.action === "CONFIRM" ? "CONFIRMED" : "AVAILABLE", updatedAt: new Date() })
      .where(and(eq(dateSlots.id, joined.slot.id), eq(dateSlots.status, "PENDING_CONFIRMATION")));
    if (resultRows(slotChanged) !== 1) throw new Error("Le statut de cette date a changé. Vérifiez l’agenda avant de réessayer.");
    await recordAudit(tx as DbLike, input.action === "CONFIRM" ? "REQUEST_CONFIRMED" : "REQUEST_RELEASED", "invitation_request", input.requestId, input.actor, { date: joined.slot.date }, input.requestId);
    return { ...joined, request: { ...joined.request, status: outcome }, slot: { ...joined.slot, status: input.action === "CONFIRM" ? "CONFIRMED" : "AVAILABLE" } } as RequestWithSlot;
  });
  if (input.action === "CONFIRM" && input.notify !== false) {
    await syncConfirmedCalendarEvent(changed, input.actor);
  }
  const emailStatus = input.notify === false ? "PENDING" as const : await queueDecisionEmail(changed, input.action === "CONFIRM" ? "CONFIRMED" : "REFUSED");
  return { ...changed, emailStatus };
}

export async function decideFromActionToken(rawToken: string, notify = true) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const tokenRows = await tx
      .select()
      .from(actionTokens)
      .where(eq(actionTokens.tokenHash, hashToken(rawToken)))
      .limit(1);
    const token = tokenRows[0];
    if (!token || token.usedAt || token.expiresAt < new Date()) return null;
    const claimed = await tx
      .update(actionTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(actionTokens.id, token.id), isNull(actionTokens.usedAt), gte(actionTokens.expiresAt, new Date())));
    if (resultRows(claimed) !== 1) return null;
    const joined = await requestWithSlot(tx as DbLike, token.requestId);
    if (!joined || joined.request.status !== "PENDING" || joined.slot.status !== "PENDING_CONFIRMATION") return null;
    const confirming = token.action === "CONFIRM";
    const requestChanged = await tx.update(invitationRequests).set({
      status: confirming ? "CONFIRMED" : "REFUSED",
      decisionAt: new Date(),
      decisionBy: "email-action",
    }).where(and(eq(invitationRequests.id, joined.request.id), eq(invitationRequests.status, "PENDING")));
    if (resultRows(requestChanged) !== 1) return null;
    const slotChanged = await tx.update(dateSlots).set({ status: confirming ? "CONFIRMED" : "AVAILABLE", updatedAt: new Date() })
      .where(and(eq(dateSlots.id, joined.slot.id), eq(dateSlots.status, "PENDING_CONFIRMATION")));
    if (resultRows(slotChanged) !== 1) throw new Error("Le statut de la date a changé pendant la décision.");
    await recordAudit(tx as DbLike, confirming ? "REQUEST_CONFIRMED" : "REQUEST_RELEASED", "invitation_request", joined.request.id, "email-action", { source: "email" }, joined.request.id);
    const updated = await requestWithSlot(tx as DbLike, joined.request.id);
    if (!updated) throw new Error("La demande n’est plus disponible.");
    return { confirmed: confirming, data: updated };
  });
  if (changed) {
    if (changed.confirmed && notify) {
      await syncConfirmedCalendarEvent(changed.data, "email-action");
    }
    const emailStatus = notify ? await queueDecisionEmail(changed.data, changed.confirmed ? "CONFIRMED" : "REFUSED") : "PENDING" as const;
    return { ...changed, emailStatus };
  }
  return null;
}

export async function listRequests(
  input: { departmentId?: number; status?: string[]; search?: string; federation?: string; month?: string; year?: string },
  scope: AdminScope,
) {
  const db = await requireDb();
  const conditions: any[] = [];
  const scopeCondition = departmentScopeCondition(scope, invitationRequests.departmentId);
  if (scopeCondition) conditions.push(scopeCondition);
  if (input.departmentId !== undefined) conditions.push(eq(invitationRequests.departmentId, input.departmentId));
  if (input.status?.length) conditions.push(inArray(invitationRequests.status, input.status as any));
  if (input.federation) conditions.push(eq(invitationRequests.federation, input.federation));
  if (input.year) conditions.push(like(dateSlots.date, `${input.year}-%`));
  if (input.month) conditions.push(like(dateSlots.date, `${input.month}%`));
  if (input.search) {
    const term = `%${input.search.trim()}%`;
    conditions.push(or(like(invitationRequests.church, term), like(invitationRequests.contactName, term), like(invitationRequests.email, term)));
  }
  return db
    .select({ request: invitationRequests, slot: dateSlots, department: departments })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .leftJoin(departments, eq(invitationRequests.departmentId, departments.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(dateSlots.date), desc(invitationRequests.submittedAt));
}

export async function listCalendar(
  input: { departmentId?: number; month?: string; status?: SlotStatus; federation?: string } | undefined,
  scope: AdminScope,
) {
  const db = await requireDb();
  const conditions: any[] = [];
  const scopeCondition = departmentScopeCondition(scope, dateSlots.departmentId);
  if (scopeCondition) conditions.push(scopeCondition);
  if (input?.departmentId !== undefined) conditions.push(eq(dateSlots.departmentId, input.departmentId));
  if (input?.month) conditions.push(like(dateSlots.date, `${input.month}%`));
  if (input?.status) conditions.push(eq(dateSlots.status, input.status));
  const rows = await db
    .select({ slot: dateSlots, request: invitationRequests, department: departments })
    .from(dateSlots)
    .leftJoin(invitationRequests, and(eq(invitationRequests.dateSlotId, dateSlots.id), inArray(invitationRequests.status, ["PENDING", "CONFIRMED"])))
    .leftJoin(departments, eq(dateSlots.departmentId, departments.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(dateSlots.date));
  return input?.federation
    ? rows.filter((row) => (row.slot.federation ?? row.request?.federation) === input.federation)
    : rows;
}

export async function dashboard(scope: AdminScope) {
  const db = await requireDb();

  const slotScope = departmentScopeCondition(scope, dateSlots.departmentId);
  const requestScope = departmentScopeCondition(scope, invitationRequests.departmentId);

  const slots = await db
    .select()
    .from(dateSlots)
    .where(slotScope)
    .orderBy(asc(dateSlots.date));

  const pendingConditions: any[] = [eq(invitationRequests.status, "PENDING")];
  if (requestScope) pendingConditions.push(requestScope);

  const confirmedConditions: any[] = [eq(invitationRequests.status, "CONFIRMED")];
  if (requestScope) confirmedConditions.push(requestScope);

  const pending = await db
    .select()
    .from(invitationRequests)
    .where(and(...pendingConditions));

  const confirmed = await db
    .select()
    .from(invitationRequests)
    .where(and(...confirmedConditions));
  const now = today();
  const upcoming = confirmed.map((request) => ({ request, slot: slots.find((item) => item.id === request.dateSlotId) }))
    .filter((item): item is { request: typeof confirmed[number]; slot: typeof slots[number] } => Boolean(item.slot && item.slot.status === "CONFIRMED" && item.slot.date >= now))
    .sort((left, right) => left.slot.date.localeCompare(right.slot.date));
  const next = upcoming[0]?.slot ?? null;
  const perFederation = { FFN: 0, FFS: 0, FBL: 0 } as Record<string, number>;
  const perMonth: Record<string, number> = {};
  for (const request of confirmed) {
    perFederation[request.federation] = (perFederation[request.federation] ?? 0) + 1;
    const slot = slots.find((item) => item.id === request.dateSlotId);
    if (slot) perMonth[slot.date.slice(0, 7)] = (perMonth[slot.date.slice(0, 7)] ?? 0) + 1;
  }
  return {
    available: slots.filter((slot) => slot.status === "AVAILABLE" && slot.date >= now).length,
    pending: pending.length,
    confirmed: confirmed.length,
    unavailable: slots.filter((slot) => slot.status === "UNAVAILABLE").length,
    next,
    upcoming: upcoming.slice(0, 5),
    yearlyInterventions: confirmed.filter((request) => {
      const slot = slots.find((item) => item.id === request.dateSlotId);
      return slot?.date.startsWith(String(new Date().getFullYear()));
    }).length,
    perFederation,
    perMonth,
  };
}

export async function listDepartments(scope: AdminScope) {
  const db = await requireDb();

  const conditions: any[] = [
    eq(departments.active, "YES"),
  ];

  const scopeCondition = departmentScopeCondition(scope, departments.id);
  if (scopeCondition) conditions.push(scopeCondition);

  return db
    .select()
    .from(departments)
    .where(and(...conditions))
    .orderBy(asc(departments.name));
}

function requireDepartmentManager(scope: AdminScope) {
  if (scope.role !== "PRIMARY_ADMIN" || !scope.canWrite) {
    throw new Error("Seule l’administration générale UFB peut gérer les départements.");
  }
}

export async function listManagedDepartments(scope: AdminScope) {
  requireDepartmentManager(scope);
  const db = await requireDb();
  return db.select().from(departments).orderBy(asc(departments.name));
}

function normalizedDepartmentName(name: string) {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr-FR").replace(/\s+/g, " ").trim();
}

export async function createDepartment(nameInput: string, actor: string, scope: AdminScope) {
  requireDepartmentManager(scope);
  const name = nameInput.replace(/\s+/g, " ").trim();
  if (!name || name.length > 180) throw new Error("Indiquez un nom de département de 1 à 180 caractères.");
  const key = normalizedDepartmentName(name);
  const readableCode = key.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const suffix = createHash("sha256").update(key).digest("hex").slice(0, 8).toUpperCase();
  const code = !readableCode ? `DEPARTEMENT_${suffix}`
    : readableCode.length > 80 ? `${readableCode.slice(0, 71)}_${suffix}` : readableCode;
  const db = await requireDb();
  try {
    return await db.transaction(async (tx) => {
      const existing = await tx.select({ name: departments.name, active: departments.active }).from(departments);
      const duplicate = existing.find((department) => normalizedDepartmentName(department.name) === key);
      if (duplicate) throw new Error(duplicate.active === "YES"
        ? "Ce département existe déjà."
        : "Ce département a été retiré. Utilisez RÉTABLIR pour le réactiver.");
      const id = insertId(await tx.insert(departments).values({ code, name, active: "YES" }));
      if (!id) throw new Error("Le département n’a pas pu être créé.");
      await recordAudit(tx as DbLike, "DEPARTMENT_CREATED", "department", id, actor, { name, code });
      return { id, name, active: "YES" as const };
    });
  } catch (error) {
    if ((error as { code?: string; cause?: { code?: string } })?.code === "ER_DUP_ENTRY" ||
        (error as { cause?: { code?: string } })?.cause?.code === "ER_DUP_ENTRY") {
      throw new Error("Ce département existe déjà. Actualisez la liste.");
    }
    throw error;
  }
}

export async function setDepartmentActive(input: { departmentId: number; active: "YES" | "NO" }, actor: string, scope: AdminScope) {
  requireDepartmentManager(scope);
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const department = (await tx.select().from(departments)
      .where(eq(departments.id, input.departmentId)).limit(1).for("update"))[0];
    if (!department) throw new Error("Département introuvable. Actualisez la liste.");
    if (department.active === input.active) return { id: department.id, active: department.active };
    // Keep the department's identity, assignments, dates and requests so that
    // retiring it never deletes history or creates orphaned references.
    await tx.update(departments).set({ active: input.active }).where(eq(departments.id, department.id));
    await recordAudit(tx as DbLike, input.active === "YES" ? "DEPARTMENT_RESTORED" : "DEPARTMENT_RETIRED", "department", department.id, actor, { name: department.name });
    return { id: department.id, active: input.active };
  });
}

export async function listInterventionTypes(
  departmentId: number | undefined,
  scope: AdminScope,
  includeInactive = false,
) {
  const db = await requireDb();

  if (departmentId) {
    assertDepartmentAccess(scope, departmentId);
  }

  const conditions: any[] = [];
  if (!includeInactive) conditions.push(eq(interventionTypes.active, "YES"));

  const scopeCondition = departmentScopeCondition(
    scope,
    interventionTypes.departmentId,
  );

  if (scopeCondition) conditions.push(scopeCondition);

  if (departmentId) {
    conditions.push(
      eq(interventionTypes.departmentId, departmentId),
    );
  }

  return db
    .select()
    .from(interventionTypes)
    .where(and(...conditions))
    .orderBy(asc(interventionTypes.name));
}

export async function saveInterventionType(input: { id?: number; departmentId: number; name: string; active: "YES" | "NO" }, actor: string, scope: AdminScope) {
  assertDepartmentAccess(scope, input.departmentId);
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error("Indiquez un nom de 1 à 80 caractères.");
  const db = await requireDb();
  try {
    return await db.transaction(async (tx) => {
      const department = (await tx.select({ id: departments.id }).from(departments).where(and(eq(departments.id, input.departmentId), eq(departments.active, "YES"))).limit(1))[0];
      if (!department) throw new Error("Le département est introuvable ou inactif.");
      let id = input.id;
      if (id !== undefined) {
        const result = await tx.update(interventionTypes).set({ name, active: input.active, updatedAt: new Date() }).where(and(eq(interventionTypes.id, id), eq(interventionTypes.departmentId, input.departmentId)));
        if (resultRows(result) !== 1) throw new Error("Le type d’intervention est introuvable dans ce département.");
      } else {
        id = insertId(await tx.insert(interventionTypes).values({ departmentId: input.departmentId, name, active: input.active }));
        if (!id) throw new Error("Le type d’intervention n’a pas pu être enregistré.");
      }
      await recordAudit(tx as DbLike, "INTERVENTION_TYPE_SAVED", "intervention_type", id, actor, { departmentId: input.departmentId, name, active: input.active });
      return { id };
    });
  } catch (error) {
    if ((error as { code?: string })?.code === "ER_DUP_ENTRY") throw new Error("Ce type d’intervention existe déjà dans ce département.");
    throw error;
  }
}

export async function createSlots(
  dates: string[],
  departmentId: number,
  federation: string,
  actor: string,
  scope: AdminScope,
  initialStatus: SlotStatus = "AVAILABLE",
) {
  assertDepartmentAccess(scope, departmentId);

  const db = await requireDb();

  const department = (
    await db
      .select({ id: departments.id })
      .from(departments)
      .where(
        and(
          eq(departments.id, departmentId),
          eq(departments.active, "YES"),
        ),
      )
      .limit(1)
  )[0];

  if (!department) {
    throw new Error("Le département sélectionné est introuvable ou inactif.");
  }

  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations)
    ? configuration.federations as string[]
    : [...FEDERATIONS];

  if (!federations.includes(federation)) {
    throw new Error("Veuillez choisir une fédération disponible.");
  }

  let created = 0;
  let skipped = 0;
  for (const value of [...new Set(dates)].sort()) {
    try {
      const inserted = await db.insert(dateSlots).values({
        date: value,
        departmentId,
        federation,
        status: initialStatus,
      });
      const id = insertId(inserted);
      await recordAudit(db, "DATE_CREATED", "date_slot", id, actor, {
        date: value,
        departmentId,
        federation,
        status: initialStatus,
      });
      created += 1;
    } catch {
      skipped += 1;
    }
  }
  return { created, skipped };
}

export async function setSlotStatus(
  slotId: number,
  status: SlotStatus,
  actor: string,
  scope: AdminScope,
  note?: string,
) {
  const db = await requireDb();
  const slot = (await db.select().from(dateSlots).where(eq(dateSlots.id, slotId)).limit(1))[0];
  if (!slot) throw new Error("Date introuvable.");

  assertDepartmentAccess(scope, slot.departmentId);
  if (status !== "AVAILABLE" && status !== "UNAVAILABLE") throw new Error("Les statuts d’invitation sont gérés par les actions de réservation.");
  if (["PENDING_CONFIRMATION", "CONFIRMED"].includes(slot.status) && ["AVAILABLE", "UNAVAILABLE"].includes(status)) {
    throw new Error("Utilisez l’action sur la réservation pour libérer ou annuler cette date.");
  }
  const changed = await db.update(dateSlots).set({ status, internalNote: note ?? slot.internalNote, updatedAt: new Date() })
    .where(and(eq(dateSlots.id, slotId), eq(dateSlots.status, slot.status)));
  if (resultRows(changed) !== 1) throw new Error("Le statut de cette date a changé. Actualisez l’agenda.");
  await recordAudit(db, status === "UNAVAILABLE" ? "DATE_BLOCKED" : "DATE_UPDATED", "date_slot", slotId, actor, { before: slot.status, after: status });
  return { ...slot, status };
}

export async function setSlotFederation(
  slotId: number,
  federation: string,
  actor: string,
  scope: AdminScope,
) {
  const db = await requireDb();

  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations)
    ? configuration.federations as string[]
    : [...FEDERATIONS];

  if (!federations.includes(federation)) {
    throw new Error("Veuillez choisir une fédération disponible.");
  }

  const slot = (await db.select().from(dateSlots).where(eq(dateSlots.id, slotId)).limit(1))[0];
  if (!slot) throw new Error("Date introuvable.");

  assertDepartmentAccess(scope, slot.departmentId);

  if (slot.status !== "AVAILABLE" && slot.status !== "UNAVAILABLE") {
    throw new Error("La fédération ne peut être modifiée que pour une date disponible ou bloquée.");
  }

  const previousFederation = slot.federation;

  const changed = await db
    .update(dateSlots)
    .set({ federation, updatedAt: new Date() })
    .where(and(eq(dateSlots.id, slotId), eq(dateSlots.status, slot.status)));

  if (resultRows(changed) !== 1) {
    throw new Error("La date a changé. Actualisez l’agenda.");
  }

  await recordAudit(
    db,
    "DATE_FEDERATION_UPDATED",
    "date_slot",
    slotId,
    actor,
    { date: slot.date, before: previousFederation, after: federation }
  );

  return { ...slot, federation };
}

export async function removeEmptySlot(
  slotId: number,
  actor: string,
  scope: AdminScope,
) {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const slot = (await tx.select().from(dateSlots).where(eq(dateSlots.id, slotId)).limit(1))[0];
    if (!slot) throw new Error("Date introuvable.");

    assertDepartmentAccess(scope, slot.departmentId);
    if (slot.status === "PENDING_CONFIRMATION" || slot.status === "CONFIRMED") throw new Error("Une date associée à une invitation active ne peut pas être supprimée.");
    const relatedRequests = await tx.select({ id: invitationRequests.id }).from(invitationRequests)
      .where(eq(invitationRequests.dateSlotId, slotId));
    if (relatedRequests.length) throw new Error("Cette date possède un historique d’invitation. Conservez-la dans l’agenda au lieu de supprimer son historique.");
    const deleted = await tx.delete(dateSlots).where(and(eq(dateSlots.id, slotId), eq(dateSlots.status, slot.status)));
    if (resultRows(deleted) !== 1) throw new Error("La date a changé. Actualisez l’agenda.");
    await recordAudit(tx as DbLike, "DATE_REMOVED", "date_slot", slotId, actor, { date: slot.date, status: slot.status });
  });
  return { removed: true };
}

export async function updateInvitationDetails(input: {
  requestId: number;
  federation: string;
  church: string;
  contactName: string;
  email: string;
  phone: string;
  interventionType: string;
  message?: string | null;
  desiredTime?: string | null;
  churchAddress?: string | null;
  actor: string;
  scope: AdminScope;
}) {
  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations) ? configuration.federations as string[] : [...FEDERATIONS];
  if (!federations.includes(input.federation)) throw new Error("Veuillez choisir une fédération disponible.");
  const db = await requireDb();
  const updated = await db.transaction(async (tx) => {
    const current = await requestWithSlot(tx as DbLike, input.requestId);
    if (!current || !["PENDING", "CONFIRMED"].includes(current.request.status)) throw new Error("Seule une demande active peut être modifiée.");

    assertDepartmentAccess(input.scope, current.request.departmentId);

    if (current.slot.departmentId !== current.request.departmentId) {
      throw new Error("Le département de la demande ne correspond pas à celui de la date.");
    }

    const changed = await tx.update(invitationRequests).set({
      federation: input.federation.trim(), church: input.church.trim(), contactName: input.contactName.trim(),
      email: input.email.trim().toLowerCase(), phone: input.phone.trim(), interventionType: input.interventionType.trim(),
      message: input.message?.trim() || null, desiredTime: input.desiredTime?.trim() || null, churchAddress: input.churchAddress?.trim() || null,
    }).where(and(eq(invitationRequests.id, input.requestId), eq(invitationRequests.status, current.request.status), eq(invitationRequests.dateSlotId, current.slot.id)));
    if (resultRows(changed) !== 1) throw new Error("Cette demande vient d’être modifiée. Actualisez la liste.");
    const result = await requestWithSlot(tx as DbLike, input.requestId);
    if (!result) throw new Error("La demande n’est plus disponible.");
    await recordAudit(tx as DbLike, "INVITATION_DETAILS_UPDATED", "invitation_request", input.requestId, input.actor, { fields: ["federation", "church", "contactName", "email", "phone", "interventionType", "message", "desiredTime", "churchAddress"] }, input.requestId);
    return result;
  });
  if (updated.request.status === "CONFIRMED") {
    await syncConfirmedCalendarEvent(updated, input.actor);
  }
  const emailStatus = await queueDecisionEmail(updated, "UPDATED");
  return { ...updated, emailStatus };
}

export async function cancelInvitation(input: {
  requestId: number;
  disposition: "AVAILABLE" | "UNAVAILABLE";
  actor: string;
  note?: string;
  scope: AdminScope;
}) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const joined = await requestWithSlot(tx as DbLike, input.requestId);
    if (!joined || joined.request.status !== "CONFIRMED") throw new Error("Seule une invitation confirmée peut être annulée.");

    assertDepartmentAccess(input.scope, joined.request.departmentId);

    if (joined.slot.departmentId !== joined.request.departmentId) {
      throw new Error("Le département de la demande ne correspond pas à celui de la date.");
    }

    const requestChanged = await tx.update(invitationRequests).set({ status: "CANCELLED", decisionAt: new Date(), decisionBy: input.actor, decisionNote: input.note ?? null })
      .where(and(eq(invitationRequests.id, input.requestId), eq(invitationRequests.status, "CONFIRMED")));
    if (resultRows(requestChanged) !== 1) throw new Error("Cette invitation vient d’être modifiée. Actualisez la liste.");
    const slotChanged = await tx.update(dateSlots).set({ status: input.disposition, updatedAt: new Date() })
      .where(and(eq(dateSlots.id, joined.slot.id), eq(dateSlots.status, "CONFIRMED")));
    if (resultRows(slotChanged) !== 1) throw new Error("Le statut de la date a changé. Actualisez l’agenda.");
    await recordAudit(tx as DbLike, "INVITATION_CANCELLED", "invitation_request", input.requestId, input.actor, { disposition: input.disposition }, input.requestId);
    return { ...joined, request: { ...joined.request, status: "CANCELLED" } } as RequestWithSlot;
  });
  await removeConfirmedCalendarEvent(changed, input.actor);
  await queueDecisionEmail(changed, "CANCELLED");
  return changed;
}

export async function rescheduleInvitation(input: {
  requestId: number;
  newSlotId: number;
  oldDisposition: "AVAILABLE" | "UNAVAILABLE";
  actor: string;
  scope: AdminScope;
}) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const current = await requestWithSlot(tx as DbLike, input.requestId);
    if (!current || current.request.status !== "CONFIRMED") throw new Error("Invitation introuvable ou non confirmée.");

    assertDepartmentAccess(input.scope, current.request.departmentId);

    if (current.slot.departmentId !== current.request.departmentId) {
      throw new Error("Le département de la demande ne correspond pas à celui de la date actuelle.");
    }

    const newSlot = (
      await tx
        .select()
        .from(dateSlots)
        .where(eq(dateSlots.id, input.newSlotId))
        .limit(1)
    )[0];

    if (!newSlot) {
      throw new Error("La nouvelle date est introuvable.");
    }

    assertDepartmentAccess(input.scope, newSlot.departmentId);

    if (newSlot.departmentId !== current.request.departmentId) {
      throw new Error("Une invitation ne peut pas être déplacée vers un autre département.");
    }

    if (newSlot.date < today()) throw new Error("La nouvelle date doit être aujourd’hui ou dans le futur.");

    if (newSlot.federation !== current.request.federation) {
      throw new Error("Une invitation ne peut pas être déplacée vers une date réservée à une autre fédération.");
    }

    const claimed = await tx.update(dateSlots).set({ status: "CONFIRMED", updatedAt: new Date() }).where(and(eq(dateSlots.id, input.newSlotId), eq(dateSlots.status, "AVAILABLE")));
    if (resultRows(claimed) !== 1) throw new SlotTakenError();
    const requestChanged = await tx.update(invitationRequests).set({ dateSlotId: input.newSlotId, decisionAt: new Date(), decisionBy: input.actor })
      .where(and(eq(invitationRequests.id, input.requestId), eq(invitationRequests.status, "CONFIRMED"), eq(invitationRequests.dateSlotId, current.slot.id)));
    if (resultRows(requestChanged) !== 1) throw new Error("Cette invitation vient d’être modifiée. Actualisez la liste.");
    const oldSlotChanged = await tx.update(dateSlots).set({ status: input.oldDisposition, updatedAt: new Date() })
      .where(and(eq(dateSlots.id, current.slot.id), eq(dateSlots.status, "CONFIRMED")));
    if (resultRows(oldSlotChanged) !== 1) throw new Error("Le statut de l’ancienne date a changé. Actualisez l’agenda.");
    const moved = await requestWithSlot(tx as DbLike, input.requestId);
    await recordAudit(tx as DbLike, "INVITATION_RESCHEDULED", "invitation_request", input.requestId, input.actor, { oldDate: current.slot.date, newDate: moved?.slot.date }, input.requestId);
    return moved!;
  });
  await syncConfirmedCalendarEvent(changed, input.actor);
  await queueDecisionEmail(changed, "RESCHEDULED");
  return changed;
}

export async function settings() {
  return getSettingsMap();
}

export async function updateSetting(key: string, value: unknown, actor: string) {
  const db = await requireDb();
  let safeValue = value;
  if (key === "federations") {
    if (!Array.isArray(value) || !value.length || value.length > 50 || value.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 80)) throw new Error("Indique entre 1 et 50 noms de fédération de 80 caractères maximum.");
    safeValue = [...new Set(value.map((item: string) => item.trim()))];
  } else if (key === "fields") {
    if (!value || typeof value !== "object") throw new Error("Les réglages des champs sont invalides.");
    const incoming = value as Record<string, unknown>;
    const normalized: Record<string, { visible: boolean; required: boolean }> = {};
    for (const field of Object.keys(DEFAULT_FIELDS)) {
      if (field === "interventionType") { normalized[field] = { visible: true, required: true }; continue; }
      const rule = incoming[field] as Record<string, unknown> | undefined;
      if (!rule || typeof rule.visible !== "boolean" || typeof rule.required !== "boolean" || (rule.required && !rule.visible)) throw new Error(`Le réglage du champ ${field} est invalide.`);
      normalized[field] = { visible: rule.visible, required: rule.required };
    }
    safeValue = normalized;
  } else if (key === "reminders") {
    const input = value as { enabled?: unknown; includeRequester?: unknown } | null;
    if (!input || typeof input.enabled !== "boolean" || typeof input.includeRequester !== "boolean") throw new Error("Les préférences de rappel sont invalides.");
    safeValue = { enabled: input.enabled, recipient: ADMIN_EMAIL, includeRequester: input.includeRequester };
  } else if (key === "retention") {
    const months = Number((value as { months?: unknown } | null)?.months);
    if (!Number.isInteger(months) || months < 1 || months > 120) throw new Error("La durée de conservation doit être comprise entre 1 et 120 mois.");
    safeValue = { months };
  } else if (key === "emailTemplates") {
    if (!value || typeof value !== "object") throw new Error("Les modèles d’e-mail sont invalides.");
    const incoming = value as Record<string, unknown>;
    const normalized: Record<string, string> = {};
    for (const [templateKey, fallback] of Object.entries(DEFAULT_EMAIL_TEMPLATES)) {
      const text = incoming[templateKey];
      const maxLength = templateKey.endsWith("Subject") ? 500 : 6000;
      if (typeof text !== "string" || text.length > maxLength) throw new Error(`Le modèle ${templateKey} est vide ou trop long.`);
      normalized[templateKey] = text.trim() || fallback;
    }
    safeValue = normalized;
  }
  const settingValue = JSON.stringify(safeValue);
  await db.insert(appSettings).values({ settingKey: key, settingValue, updatedBy: actor }).onDuplicateKeyUpdate({ set: { settingValue, updatedBy: actor, updatedAt: new Date() } });
  await recordAudit(db, "SETTING_UPDATED", "setting", key, actor, { key });
  return settings();
}

export async function listAudit(limit = 100) {
  const db = await requireDb();
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(Math.min(limit, 250));
}

export async function createPrivacyRequest(input: { email: string; requestType: "ACCESS" | "DELETE"; message?: string }) {
  const db = await requireDb();
  await db.insert(privacyRequests).values({ email: input.email.toLowerCase(), requestType: input.requestType, message: input.message?.trim() || null });
  await recordAudit(db, "PRIVACY_REQUEST_CREATED", "privacy_request", input.email, input.email, { requestType: input.requestType });
  return { ok: true };
}

export async function exportInvitationRows(
  filters: { departmentId?: number; status?: string[]; federation?: string; month?: string; year?: string; search?: string },
  scope: AdminScope,
) {
  const rows = await listRequests(filters, scope);
  return rows.map(({ request, slot, department }) => ({
    "Département": department?.name ?? `Département #${request.departmentId}`,
    "Date": slot.date,
    "Statut date": slot.status,
    "Statut demande": request.status,
    "Fédération": request.federation,
    "Église": request.church,
    "Contact": request.contactName,
    "E-mail": request.email,
    "Téléphone": request.phone,
    "Type d’intervention": request.interventionType,
    "Message": request.message ?? "",
    "Identifiant": request.submissionId,
    "Soumis le": request.submittedAt.toISOString(),
    "Décision le": request.decisionAt?.toISOString() ?? "",
  }));
}

export async function runReminders() {
  if (process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED !== "true") {
    return { queued: 0, disabled: true };
  }
  const settingValues = await getSettingsMap();
  const reminderSettings = settingValues.reminders as { enabled?: boolean; recipient?: string; includeRequester?: boolean };
  if (!reminderSettings?.enabled) return { queued: 0, disabled: true };
  const db = await requireDb();
  const templates = configuredTemplates(settingValues);
  const rows = await db
    .select({ request: invitationRequests, slot: dateSlots, department: departments })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .leftJoin(departments, eq(invitationRequests.departmentId, departments.id))
    .where(eq(invitationRequests.status, "CONFIRMED"));
  let queued = 0;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const row of rows) {
    const targetUtc = Date.parse(`${row.slot.date}T00:00:00.000Z`);
    const days = Math.round((targetUtc - todayUtc) / 86_400_000);
    const kind = days === 30 ? "D30" : days === 7 ? "D7" : days === 1 ? "D1" : null;
    if (!kind) continue;
    const recipients = await departmentNotificationRecipients(db, row.request.departmentId);
    if (reminderSettings.includeRequester) recipients.push(row.request.email);
    const uniqueRecipients = [...new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean))];
    const values = {
      departement: row.department?.name ?? `Département #${row.request.departmentId}`,
      date: toFrenchDate(row.slot.date),
      federation: row.request.federation,
      eglise: row.request.church,
      contact: row.request.contactName,
      email: row.request.email,
      telephone: row.request.phone,
      type: row.request.interventionType ?? "—",
      heure: row.request.desiredTime ?? "—",
      adresse: row.request.churchAddress ?? "—",
      message: row.request.message ?? "—",
      identifiant: row.request.submissionId,
      prenom: row.request.contactName.split(/\s+/)[0] || row.request.contactName,
      lien_agenda: publicBaseUrl(),
    };
    for (const recipient of uniqueRecipients) {
      try {
        const insertedId = await db.transaction(async (tx: DbLike) => {
          await tx.insert(reminderLog).values({ requestId: row.request.id, slotDate: row.slot.date, reminderKind: kind, recipient });
          const subject = renderSubject(templates.reminderSubject, values);
          const body = renderTemplate(templates.reminderBody, values);
          const inserted = await tx.insert(emailOutbox).values({ requestId: row.request.id, recipient, replyTo: ADMIN_EMAIL, subject, html: emailShell(subject, body), status: "PENDING" });
          return insertId(inserted);
        });
        if (insertedId) queued += 1;
      } catch (error) {
        const duplicate = (error as { code?: string; cause?: { code?: string } } | null)?.code === "ER_DUP_ENTRY"
          || (error as { cause?: { code?: string } } | null)?.cause?.code === "ER_DUP_ENTRY";
        if (!duplicate) throw error;
      }
    }
  }
  await deliverOutbox();
  return { queued, disabled: false };
}

export async function scheduledWorkStatus() {
  const db = await requireDb();
  const row = (await db.select({ taskUid: scheduledJobs.taskUid, active: scheduledJobs.active }).from(scheduledJobs)
    .where(eq(scheduledJobs.jobKey, "reminders")).limit(1))[0];
  return { configured: Boolean(row?.taskUid), active: row?.active === "YES" };
}

export async function listAdmins() {
  const db = await requireDb();

  const admins = await db
    .select({ profile: adminProfiles, user: users })
    .from(adminProfiles)
    .innerJoin(users, eq(adminProfiles.userId, users.id))
    .orderBy(asc(adminProfiles.email));

  const assignments = await db
    .select({
      adminProfileId: adminDepartments.adminProfileId,
      departmentId: departments.id,
      departmentCode: departments.code,
      departmentName: departments.name,
    })
    .from(adminDepartments)
    .innerJoin(
      departments,
      eq(adminDepartments.departmentId, departments.id),
    )
    .orderBy(asc(departments.name));

  return admins.map((admin) => ({
    ...admin,
    allDepartments: admin.profile.role === "PRIMARY_ADMIN",
    departments: assignments
      .filter(
        (assignment) =>
          assignment.adminProfileId === admin.profile.id,
      )
      .map((assignment) => ({
        id: assignment.departmentId,
        code: assignment.departmentCode,
        name: assignment.departmentName,
      })),
  }));
}

export async function createAdminAccount(input: {
  name: string;
  email: string;
  password: string;
  role: "PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY";
  departmentIds: number[];
  actor: string;
}) {
  const db = await requireDb();

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const departmentIds = [...new Set(input.departmentIds)];

  if (!name) throw new Error("Le nom est obligatoire.");
  if (!email || !email.includes("@")) {
    throw new Error("L’adresse e-mail est invalide.");
  }
  if (input.role !== "PRIMARY_ADMIN" && !departmentIds.length) {
    throw new Error("Sélectionnez au moins un département.");
  }

  const passwordHash = await hashPassword(input.password);

  return db.transaction(async (tx) => {
    const existingProfile = await tx
      .select({ id: adminProfiles.id })
      .from(adminProfiles)
      .where(eq(adminProfiles.email, email))
      .limit(1);

    if (existingProfile.length) {
      throw new Error("Un compte administrateur existe déjà avec cette adresse e-mail.");
    }

    if (input.role !== "PRIMARY_ADMIN") {
      const validDepartments = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(
          and(
            inArray(departments.id, departmentIds),
            eq(departments.active, "YES"),
          ),
        );

      if (validDepartments.length !== departmentIds.length) {
        throw new Error("Un ou plusieurs départements sélectionnés sont invalides ou inactifs.");
      }
    }

    const openId = `ufb-admin-${randomUUID()}`;

    const userInsert = await tx.insert(users).values({
      openId,
      name,
      email,
      loginMethod: "password",
      role: "admin",
    });

    const userId = insertId(userInsert);
    if (!userId) {
      throw new Error("Impossible de créer l’utilisateur.");
    }

    const profileInsert = await tx.insert(adminProfiles).values({
      userId,
      email,
      role: input.role,
      active: "YES",
    });

    const adminProfileId = insertId(profileInsert);
    if (!adminProfileId) {
      throw new Error("Impossible de créer le profil administrateur.");
    }

    await tx.insert(adminCredentials).values({
      adminProfileId,
      passwordHash,
      failedAttempts: 0,
      lockedUntil: null,
    });

    if (input.role !== "PRIMARY_ADMIN") {
      await tx.insert(adminDepartments).values(
        departmentIds.map((departmentId) => ({
          adminProfileId,
          departmentId,
        })),
      );
    }

    await recordAudit(
      tx as DbLike,
      "ADMIN_ACCOUNT_CREATED",
      "admin",
      adminProfileId,
      input.actor,
      {
        email,
        role: input.role,
        departmentIds,
      },
    );

    return {
      id: adminProfileId,
      userId,
      name,
      email,
      role: input.role,
      active: "YES" as const,
      departmentIds,
    };
  });
}

export async function deleteAdminAccount(input: {
  adminProfileId: number;
  actorUserId: number;
  actor: string;
}) {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    // Serialize deletions of general administrators, and recheck the actor's
    // access inside the transaction before removing any account data.
    const profiles = await tx.select().from(adminProfiles)
      .where(or(eq(adminProfiles.role, "PRIMARY_ADMIN"), eq(adminProfiles.id, input.adminProfileId)))
      .orderBy(asc(adminProfiles.id)).for("update");
    const actor = profiles.find((profile) => profile.userId === input.actorUserId);
    if (!actor || actor.role !== "PRIMARY_ADMIN" || actor.active !== "YES") {
      throw new Error("Seule l’administration générale UFB peut supprimer un utilisateur.");
    }
    const account = profiles.find((profile) => profile.id === input.adminProfileId);
    if (!account) throw new Error("Compte utilisateur introuvable. Actualisez la liste.");
    if (account.role === "PRIMARY_ADMIN" && account.active === "YES" &&
        !profiles.some((profile) => profile.id !== account.id && profile.role === "PRIMARY_ADMIN" && profile.active === "YES")) {
      throw new Error("Impossible de supprimer le dernier administrateur général UFB actif.");
    }
    if (account.userId === input.actorUserId) {
      throw new Error("Vous ne pouvez pas supprimer votre propre compte.");
    }

    await tx.delete(adminCredentials).where(eq(adminCredentials.adminProfileId, account.id));
    await tx.delete(adminDepartments).where(eq(adminDepartments.adminProfileId, account.id));
    await tx.delete(adminProfiles).where(eq(adminProfiles.id, account.id));
    await tx.delete(users).where(eq(users.id, account.userId));
    await recordAudit(tx as DbLike, "ADMIN_ACCOUNT_DELETED", "admin", account.id, input.actor, {
      email: account.email,
      role: account.role,
      userId: account.userId,
    });
    return { deleted: true as const, id: account.id };
  });
}

export async function updateAdminAccount(input: {
  adminProfileId: number;
  name: string;
  email: string;
  role: "PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY";
  active: "YES" | "NO";
  departmentIds: number[];
  actor: string;
}) {
  const db = await requireDb();

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const departmentIds = [...new Set(input.departmentIds)];

  if (!name) {
    throw new Error("Le nom est obligatoire.");
  }

  if (!email || !email.includes("@")) {
    throw new Error("Une adresse e-mail valide est obligatoire.");
  }

  if (input.role !== "PRIMARY_ADMIN" && !departmentIds.length) {
    throw new Error("Sélectionnez au moins un département.");
  }

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        profileId: adminProfiles.id,
        userId: adminProfiles.userId,
        email: adminProfiles.email,
        currentRole: adminProfiles.role,
      })
      .from(adminProfiles)
      .where(eq(adminProfiles.id, input.adminProfileId))
      .limit(1);

    const account = existing[0];

    if (!account) {
      throw new Error("Compte administrateur introuvable.");
    }

    if (
      account.currentRole === "PRIMARY_ADMIN" &&
      (input.role !== "PRIMARY_ADMIN" || input.active !== "YES")
    ) {
      const activePrimaryAdmins = await tx
        .select({ id: adminProfiles.id })
        .from(adminProfiles)
        .where(
          and(
            eq(adminProfiles.role, "PRIMARY_ADMIN"),
            eq(adminProfiles.active, "YES"),
          ),
        );

      const otherActivePrimaryAdmins = activePrimaryAdmins.filter(
        (profile) => profile.id !== input.adminProfileId,
      );

      if (otherActivePrimaryAdmins.length === 0) {
        throw new Error(
          "Impossible de retirer ou désactiver le dernier administrateur général UFB actif.",
        );
      }
    }

    const emailOwner = await tx
      .select({ id: adminProfiles.id })
      .from(adminProfiles)
      .where(eq(adminProfiles.email, email))
      .limit(1);

    if (emailOwner[0] && emailOwner[0].id !== input.adminProfileId) {
      throw new Error(
        "Cette adresse e-mail est déjà utilisée par un autre administrateur.",
      );
    }

    if (input.role !== "PRIMARY_ADMIN") {
      const validDepartments = await tx
        .select({ id: departments.id, active: departments.active })
        .from(departments)
        .where(
          inArray(departments.id, departmentIds),
        );

      if (validDepartments.length !== departmentIds.length) {
        throw new Error(
          "Un ou plusieurs départements sélectionnés sont invalides ou inactifs.",
        );
      }

      // Existing assignments to retired departments remain editable so that
      // changing a user's name or password does not remove historical access.
      const retiredIds = validDepartments.filter((department) => department.active !== "YES").map((department) => department.id);
      if (retiredIds.length) {
        const retainedAssignments = await tx.select({ departmentId: adminDepartments.departmentId }).from(adminDepartments)
          .where(and(eq(adminDepartments.adminProfileId, input.adminProfileId), inArray(adminDepartments.departmentId, retiredIds)));
        if (retainedAssignments.length !== retiredIds.length) throw new Error("Un département retiré ne peut pas être attribué à un nouveau responsable.");
      }
    }

    await tx
      .update(users)
      .set({
        name,
        email,
        role: "admin",
      })
      .where(eq(users.id, account.userId));

    await tx
      .update(adminProfiles)
      .set({
        email,
        role: input.role,
        active: input.active,
      })
      .where(eq(adminProfiles.id, input.adminProfileId));

    await tx
      .delete(adminDepartments)
      .where(eq(adminDepartments.adminProfileId, input.adminProfileId));

    if (input.role !== "PRIMARY_ADMIN") {
      await tx.insert(adminDepartments).values(
        departmentIds.map((departmentId) => ({
          adminProfileId: input.adminProfileId,
          departmentId,
        })),
      );
    }

    await recordAudit(
      tx as DbLike,
      "ADMIN_ACCOUNT_UPDATED",
      "admin",
      input.adminProfileId,
      input.actor,
      {
        previousEmail: account.email,
        email,
        role: input.role,
        active: input.active,
        departmentIds,
      },
    );

    return {
      id: input.adminProfileId,
      userId: account.userId,
      name,
      email,
      role: input.role,
      active: input.active,
      departmentIds,
    };
  });
}

export async function resetAdminPassword(input: {
  adminProfileId: number;
  newPassword: string;
  actor: string;
}) {
  const db = await requireDb();

  const passwordHash = await hashPassword(input.newPassword);

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({
        profileId: adminProfiles.id,
        email: adminProfiles.email,
        role: adminProfiles.role,
      })
      .from(adminProfiles)
      .where(eq(adminProfiles.id, input.adminProfileId))
      .limit(1);

    const account = existing[0];

    if (!account) {
      throw new Error("Compte administrateur introuvable.");
    }

    const updateResult = await tx
      .update(adminCredentials)
      .set({
        passwordHash,
        failedAttempts: 0,
        lockedUntil: null,
        passwordChangedAt: new Date(),
      })
      .where(
        eq(
          adminCredentials.adminProfileId,
          input.adminProfileId,
        ),
      );

    if (resultRows(updateResult) !== 1) {
      throw new Error(
        "Les identifiants de ce compte administrateur sont introuvables.",
      );
    }

    await recordAudit(
      tx as DbLike,
      "ADMIN_PASSWORD_RESET",
      "admin",
      input.adminProfileId,
      input.actor,
      {
        email: account.email,
      },
    );

    return {
      success: true as const,
      adminProfileId: input.adminProfileId,
    };
  });
}
