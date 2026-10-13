import { and, desc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { actionTokens, appSettings, auditLog, dateSlots, emailOutbox, invitationRequests, privacyRequests, reminderLog } from "../../drizzle/schema";
import { getDb } from "../db";
import { emailShell } from "./email";

const CLOSED_REQUEST_STATUSES = ["CONFIRMED", "REFUSED", "CANCELLED", "RESCHEDULED"] as const;

function affectedRows(result: unknown) {
  const first = Array.isArray(result) ? result[0] : result;
  return Number((first as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("La base de données n’est pas disponible.");
  return db;
}

async function audit(db: any, action: string, id: number | string, actor: string, details?: unknown) {
  await db.insert(auditLog).values({
    action,
    entityType: "privacy_request",
    entityId: String(id),
    actor,
    details: details ? JSON.stringify(details) : null,
  });
}

export async function listPrivacyRequests() {
  const db = await requireDb();
  return db.select().from(privacyRequests).orderBy(desc(privacyRequests.createdAt)).limit(250);
}

export async function privacyRequestDetails(requestId: number) {
  const db = await requireDb();
  const request = (await db.select().from(privacyRequests).where(eq(privacyRequests.id, requestId)).limit(1))[0];
  if (!request) throw new Error("Cette demande de confidentialité est introuvable.");
  const records = await db.select({ request: invitationRequests, slot: dateSlots })
    .from(invitationRequests)
    .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
    .where(eq(invitationRequests.email, request.email));
  return { request, records };
}

export async function setPrivacyRequestStatus(input: { requestId: number; status: "NEW" | "IN_PROGRESS"; actor: string }) {
  const db = await requireDb();
  const updated = await db.update(privacyRequests)
    .set({ status: input.status, completedAt: null })
    .where(eq(privacyRequests.id, input.requestId));
  if (affectedRows(updated) !== 1) throw new Error("Cette demande de confidentialité est introuvable.");
  await audit(db, "PRIVACY_REQUEST_UPDATED", input.requestId, input.actor, { status: input.status });
  return { updated: true };
}

async function anonymizeOne(tx: any, requestId: number, originalEmail: string) {
  const current = (await tx.select().from(invitationRequests).where(eq(invitationRequests.id, requestId)).limit(1))[0];
  if (!current || current.status === "PENDING") return false;
  const changed = await tx.update(invitationRequests).set({
    church: "Église anonymisée",
    contactName: "Contact anonymisé",
    email: `archive-${requestId}@example.invalid`,
    phone: "",
    message: null,
    desiredTime: null,
    churchAddress: null,
    decisionNote: null,
  }).where(and(eq(invitationRequests.id, requestId), inArray(invitationRequests.status, CLOSED_REQUEST_STATUSES)));
  if (affectedRows(changed) !== 1) return false;
  await tx.update(emailOutbox).set({
    recipient: `archive-${requestId}@example.invalid`,
    subject: "Archive GCV anonymisée",
    html: emailShell("Archive anonymisée", "Les renseignements personnels de cette invitation ont été anonymisés conformément à la politique de conservation."),
    lastError: null,
  }).where(eq(emailOutbox.requestId, requestId));
  await tx.delete(actionTokens).where(eq(actionTokens.requestId, requestId));
  await tx.update(reminderLog).set({
    recipient: `archive-${requestId}@example.invalid`,
  }).where(eq(reminderLog.requestId, requestId));
  await tx.update(auditLog).set({ details: null })
    .where(eq(auditLog.requestId, requestId));
  await tx.update(auditLog).set({ actor: "Données anonymisées" })
    .where(and(eq(auditLog.requestId, requestId), eq(auditLog.actor, originalEmail)));
  return true;
}

export async function completePrivacyRequest(requestId: number, actor: string) {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const privacy = (await tx.select().from(privacyRequests).where(eq(privacyRequests.id, requestId)).limit(1))[0];
    if (!privacy) throw new Error("Cette demande de confidentialité est introuvable.");
    let anonymized = 0;
    if (privacy.requestType === "DELETE") {
      const active = await tx.select({ id: invitationRequests.id })
        .from(invitationRequests)
        .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
        .where(and(
          eq(invitationRequests.email, privacy.email),
          or(eq(invitationRequests.status, "PENDING"), and(eq(invitationRequests.status, "CONFIRMED"), gte(dateSlots.date, new Date().toISOString().slice(0, 10)))),
        ));
      if (active.length) throw new Error("Cette adresse possède une demande en attente ou une intervention future. Traitez ou annulez d’abord l’invitation active.");
      const records = await tx.select({ id: invitationRequests.id }).from(invitationRequests).where(eq(invitationRequests.email, privacy.email));
      for (const record of records) if (await anonymizeOne(tx, record.id, privacy.email)) anonymized += 1;
    }
    const updated = await tx.update(privacyRequests).set({
      status: "COMPLETED",
      completedAt: new Date(),
      ...(privacy.requestType === "DELETE" ? { email: `privacy-${requestId}@example.invalid`, message: null } : {}),
    }).where(and(eq(privacyRequests.id, requestId), eq(privacyRequests.status, privacy.status)));
    if (affectedRows(updated) !== 1) throw new Error("Cette demande de confidentialité vient d’être modifiée. Actualisez la liste.");
    await audit(tx, "PRIVACY_REQUEST_COMPLETED", requestId, actor, { requestType: privacy.requestType, anonymized });
    return { completed: true, anonymized };
  });
}

export async function anonymizeExpiredRequests(actor: string) {
  const db = await requireDb();
  const settings = await db.select().from(appSettings);
  let months = 36;
  const stored = settings.find((setting) => setting.settingKey === "retention");
  if (stored) {
    try { months = Number((JSON.parse(stored.settingValue) as { months?: number }).months) || 36; } catch { months = 36; }
  }
  months = Math.max(1, Math.min(120, Math.floor(months)));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const result = await db.transaction(async (tx) => {
    const eligible = await tx.select({ id: invitationRequests.id, email: invitationRequests.email })
      .from(invitationRequests)
      .innerJoin(dateSlots, eq(invitationRequests.dateSlotId, dateSlots.id))
      .where(and(
        lt(invitationRequests.submittedAt, cutoff),
        lt(dateSlots.date, new Date().toISOString().slice(0, 10)),
        inArray(invitationRequests.status, CLOSED_REQUEST_STATUSES),
      )).limit(250);
    let count = 0;
    for (const request of eligible) if (await anonymizeOne(tx, request.id, request.email)) count += 1;
    await tx.insert(auditLog).values({
      action: "RETENTION_ANONYMIZATION_RUN",
      entityType: "privacy",
      entityId: "retention",
      actor,
      details: JSON.stringify({ anonymized: count, months, cutoff: cutoff.toISOString() }),
    });
    return count;
  });
  return { anonymized: result, months };
}
