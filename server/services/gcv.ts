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
  adminProfiles,
  appSettings,
  auditLog,
  dateSlots,
  emailOutbox,
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
  INTERVENTION_TYPES,
  isoDate,
  toFrenchDate,
  type SlotStatus,
} from "../../shared/gcv";
import { getDb } from "../db";
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

export async function listPublicBootstrap() {
  const db = await requireDb();
  const slots = await db
    .select()
    .from(dateSlots)
    .where(and(eq(dateSlots.status, "AVAILABLE"), gte(dateSlots.date, today())))
    .orderBy(asc(dateSlots.date));
  const settings = await getSettingsMap();
  const mail = await gmailConnectionStatus();
  return {
    dates: slots,
    federations: Array.isArray(settings.federations) ? settings.federations : FEDERATIONS,
    fields: settings.fields ?? DEFAULT_FIELDS,
    interventionTypes: INTERVENTION_TYPES,
    emailReady: mail.configured && mail.connected,
  };
}

export async function createInvitation(input: {
  dateSlotId: number;
  federation: string;
  church: string;
  contactName: string;
  email: string;
  phone: string;
  interventionType?: string | null;
  message?: string | null;
  desiredTime?: string | null;
  churchAddress?: string | null;
  consent: true;
  notify?: boolean;
  }) {
  if (input.consent !== true) throw new Error("Votre consentement est requis pour envoyer cette demande.");
  if (input.notify !== false) {
    const mail = await gmailConnectionStatus();
    if (!mail.configured || !mail.connected) {
      throw new Error("Le formulaire est temporairement indisponible : le service d’envoi Gmail de la GCV-UFB doit être configuré afin que l’équipe reçoive les demandes.");
    }
  }
  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations) ? configuration.federations as string[] : [...FEDERATIONS];
  if (!federations.includes(input.federation)) throw new Error("Veuillez choisir une fédération disponible.");
  const fieldSettings = { ...DEFAULT_FIELDS, ...(configuration.fields && typeof configuration.fields === "object" ? configuration.fields : {}) } as Record<string, { visible?: boolean; required?: boolean }>;
  const extraValues: Record<string, unknown> = {
    interventionType: input.interventionType,
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
  const interventionType = storedField("interventionType", input.interventionType);
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

    const locked = await tx
      .update(dateSlots)
      .set({ status: "PENDING_CONFIRMATION", updatedAt: new Date() })
      .where(and(
        eq(dateSlots.id, input.dateSlotId),
        eq(dateSlots.status, "AVAILABLE"),
        eq(dateSlots.federation, input.federation),
      ));
    if (resultRows(locked) !== 1) throw new SlotTakenError();

    const submissionId = `GCV-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const inserted = await tx.insert(invitationRequests).values({
      submissionId,
      dateSlotId: input.dateSlotId,
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
    const values = { date: dateLabel, federation: input.federation, eglise: input.church, contact: input.contactName, email: input.email, telephone: input.phone, type: interventionType ?? "—", heure: desiredTime ?? "—", adresse: churchAddress ?? "—", message: message ?? "—", identifiant: submissionId, prenom: input.contactName.split(/\s+/)[0] || input.contactName, lien_agenda: publicBaseUrl() };
    const requestSubject = renderSubject(templates.requestSubject, values);
    const requestBody = renderTemplate(templates.requestBody, values);
    const adminMail = await tx.insert(emailOutbox).values({
      requestId,
      recipient: ADMIN_EMAIL,
      replyTo: ADMIN_EMAIL,
      subject: requestSubject,
      html: emailShell(
        "Nouvelle demande d’invitation GCV",
        `${requestBody}<p><a href="${actionHref(confirmToken)}" style="display:inline-block;background:#176b9b;color:#fff;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">CONFIRMER L’INVITATION</a></p><p><a href="${actionHref(releaseToken)}" style="display:inline-block;background:#a55f08;color:#fff;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">LIBÉRER / REFUSER</a></p>`,
      ),
      status: "PENDING",
    });
    await recordAudit(tx as DbLike, "REQUEST_CREATED", "invitation_request", requestId, input.email, { submissionId, date: slot.date }, requestId);
    return { requestId, submissionId, date: slot.date, church: input.church, adminOutboxId: insertId(adminMail) };
  });
  if (input.notify !== false) await deliverOutbox(outcome.adminOutboxId ? [outcome.adminOutboxId] : undefined);
  const { adminOutboxId, ...publicOutcome } = outcome;
  return { ...publicOutcome, adminEmailStatus: input.notify === false ? "PENDING" as const : await outboxStatus(adminOutboxId) };
}

async function requestWithSlot(db: DbLike, requestId: number): Promise<RequestWithSlot | null> {
  const rows = await db
    .select({ request: invitationRequests, slot: dateSlots })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .where(eq(invitationRequests.id, requestId))
    .limit(1);
  return rows[0] ?? null;
}

function calendarInvitation(request: RequestWithSlot): GcvCalendarInvitation {
  return {
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
  const db = await requireDb();
  const configuration = await getSettingsMap();
  const templates = configuredTemplates(configuration);
  const dateLabel = toFrenchDate(request.slot.date);
  const values = {
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
}) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const joined = await requestWithSlot(tx as DbLike, input.requestId);
    if (!joined || joined.request.status !== "PENDING" || joined.slot.status !== "PENDING_CONFIRMATION") {
      throw new Error("Cette demande n’est plus en attente de confirmation.");
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
  if (input.action === "CONFIRM") {
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
    if (changed.confirmed) {
      await syncConfirmedCalendarEvent(changed.data, "email-action");
    }
    const emailStatus = notify ? await queueDecisionEmail(changed.data, changed.confirmed ? "CONFIRMED" : "REFUSED") : "PENDING" as const;
    return { ...changed, emailStatus };
  }
  return null;
}

export async function listRequests(input: { status?: string[]; search?: string; federation?: string; month?: string; year?: string }) {
  const db = await requireDb();
  const conditions: any[] = [];
  if (input.status?.length) conditions.push(inArray(invitationRequests.status, input.status as any));
  if (input.federation) conditions.push(eq(invitationRequests.federation, input.federation));
  if (input.year) conditions.push(like(dateSlots.date, `${input.year}-%`));
  if (input.month) conditions.push(like(dateSlots.date, `${input.month}%`));
  if (input.search) {
    const term = `%${input.search.trim()}%`;
    conditions.push(or(like(invitationRequests.church, term), like(invitationRequests.contactName, term), like(invitationRequests.email, term)));
  }
  return db
    .select({ request: invitationRequests, slot: dateSlots })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(dateSlots.date), desc(invitationRequests.submittedAt));
}

export async function listCalendar(input?: { month?: string; status?: SlotStatus; federation?: string }) {
  const db = await requireDb();
  const conditions: any[] = [];
  if (input?.month) conditions.push(like(dateSlots.date, `${input.month}%`));
  if (input?.status) conditions.push(eq(dateSlots.status, input.status));
  const rows = await db
    .select({ slot: dateSlots, request: invitationRequests })
    .from(dateSlots)
    .leftJoin(invitationRequests, and(eq(invitationRequests.dateSlotId, dateSlots.id), inArray(invitationRequests.status, ["PENDING", "CONFIRMED"])))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(dateSlots.date));
  return input?.federation
    ? rows.filter((row) => (row.slot.federation ?? row.request?.federation) === input.federation)
    : rows;
}

export async function dashboard() {
  const db = await requireDb();
  const slots = await db.select().from(dateSlots).orderBy(asc(dateSlots.date));
  const pending = await db.select().from(invitationRequests).where(eq(invitationRequests.status, "PENDING"));
  const confirmed = await db.select().from(invitationRequests).where(eq(invitationRequests.status, "CONFIRMED"));
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

export async function createSlots(dates: string[], federation: string, actor: string, initialStatus: SlotStatus = "AVAILABLE") {
  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations)
    ? configuration.federations as string[]
    : [...FEDERATIONS];

  if (!federations.includes(federation)) {
    throw new Error("Veuillez choisir une fédération disponible.");
  }

  const db = await requireDb();
  let created = 0;
  let skipped = 0;
  for (const value of [...new Set(dates)].sort()) {
    try {
      const inserted = await db.insert(dateSlots).values({
        date: value,
        federation,
        status: initialStatus,
      });
      const id = insertId(inserted);
      await recordAudit(db, "DATE_CREATED", "date_slot", id, actor, {
        date: value,
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

export async function setSlotStatus(slotId: number, status: SlotStatus, actor: string, note?: string) {
  const db = await requireDb();
  const slot = (await db.select().from(dateSlots).where(eq(dateSlots.id, slotId)).limit(1))[0];
  if (!slot) throw new Error("Date introuvable.");
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

export async function setSlotFederation(slotId: number, federation: string, actor: string) {
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

export async function removeEmptySlot(slotId: number, actor: string) {
  const db = await requireDb();
  await db.transaction(async (tx) => {
    const slot = (await tx.select().from(dateSlots).where(eq(dateSlots.id, slotId)).limit(1))[0];
    if (!slot) throw new Error("Date introuvable.");
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
}) {
  const configuration = await getSettingsMap();
  const federations: string[] = Array.isArray(configuration.federations) ? configuration.federations as string[] : [...FEDERATIONS];
  if (!federations.includes(input.federation)) throw new Error("Veuillez choisir une fédération disponible.");
  const db = await requireDb();
  const updated = await db.transaction(async (tx) => {
    const current = await requestWithSlot(tx as DbLike, input.requestId);
    if (!current || !["PENDING", "CONFIRMED"].includes(current.request.status)) throw new Error("Seule une demande active peut être modifiée.");
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

export async function cancelInvitation(input: { requestId: number; disposition: "AVAILABLE" | "UNAVAILABLE"; actor: string; note?: string }) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const joined = await requestWithSlot(tx as DbLike, input.requestId);
    if (!joined || joined.request.status !== "CONFIRMED") throw new Error("Seule une invitation confirmée peut être annulée.");
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

export async function rescheduleInvitation(input: { requestId: number; newSlotId: number; oldDisposition: "AVAILABLE" | "UNAVAILABLE"; actor: string }) {
  const db = await requireDb();
  const changed = await db.transaction(async (tx) => {
    const current = await requestWithSlot(tx as DbLike, input.requestId);
    if (!current || current.request.status !== "CONFIRMED") throw new Error("Invitation introuvable ou non confirmée.");
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

export async function exportInvitationRows(filters: { status?: string[]; federation?: string; month?: string; year?: string; search?: string }) {
  const rows = await listRequests(filters);
  return rows.map(({ request, slot }) => ({
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
  const settingValues = await getSettingsMap();
  const reminderSettings = settingValues.reminders as { enabled?: boolean; recipient?: string; includeRequester?: boolean };
  if (!reminderSettings?.enabled) return { queued: 0, disabled: true };
  const db = await requireDb();
  const templates = configuredTemplates(settingValues);
  const rows = await db
    .select({ request: invitationRequests, slot: dateSlots })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .where(eq(invitationRequests.status, "CONFIRMED"));
  let queued = 0;
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (const row of rows) {
    const targetUtc = Date.parse(`${row.slot.date}T00:00:00.000Z`);
    const days = Math.round((targetUtc - todayUtc) / 86_400_000);
    const kind = days === 30 ? "D30" : days === 7 ? "D7" : days === 1 ? "D1" : null;
    if (!kind) continue;
    const recipients = [reminderSettings.recipient || ADMIN_EMAIL];
    if (reminderSettings.includeRequester) recipients.push(row.request.email);
    const uniqueRecipients = [...new Set(recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean))];
    const values = {
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
  return db.select({ profile: adminProfiles, user: users }).from(adminProfiles).innerJoin(users, eq(adminProfiles.userId, users.id)).orderBy(asc(adminProfiles.email));
}
