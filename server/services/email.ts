import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { emailOutbox } from "../../drizzle/schema";
import { ADMIN_EMAIL } from "../../shared/gcv";
import { getDb } from "../db";
import { gmailConnectionStatus, sendGmailMail } from "./gmail-smtp";

export function emailNotificationsEnabled() {
  return process.env.UFB_EMAIL_NOTIFICATIONS_ENABLED === "true";
}

type OutboxDraft = { requestId?: number; recipient: string; subject: string; html: string };
type EmailDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function affectedRows(result: unknown) {
  const first = Array.isArray(result) ? result[0] : result;
  return Number((first as { affectedRows?: number } | undefined)?.affectedRows ?? 0);
}

async function claimOutboxMessage(db: EmailDb, id: number) {
  const result = await db.update(emailOutbox)
    .set({ status: "SENDING", attempts: sql`${emailOutbox.attempts} + 1` })
    .where(and(eq(emailOutbox.id, id), inArray(emailOutbox.status, ["PENDING", "PREVIEW"])));
  return affectedRows(result) === 1;
}

/** Atomically claim a test or operational row without contacting the SMTP service. */
export async function claimEmailOutboxMessage(id: number) {
  if (!emailNotificationsEnabled()) {
    return false;
  }
  const db = await getDb();
  return db ? claimOutboxMessage(db, id) : false;
}

export async function queueEmail(draft: OutboxDraft) {
  if (!emailNotificationsEnabled()) {
    throw new Error("Les notifications par e-mail sont désactivées pendant la phase pilote.");
  }
  const db = await getDb();
  if (!db) throw new Error("Base de données indisponible");
  const result = await db.insert(emailOutbox).values({
    requestId: draft.requestId ?? null,
    recipient: draft.recipient,
    replyTo: ADMIN_EMAIL,
    subject: draft.subject,
    html: draft.html,
    status: "PENDING",
  });
  return Number((result as any)[0]?.insertId ?? 0);
}

export async function deliverOutbox(ids?: number[]) {
  if (!emailNotificationsEnabled()) {
    return { delivered: 0, preview: 0 };
  }
  const db = await getDb();
  if (!db) return { delivered: 0, preview: 0 };
  const predicates = ids?.length
    ? and(inArray(emailOutbox.id, ids), eq(emailOutbox.status, "PENDING"))
    : eq(emailOutbox.status, "PENDING");
  const messages = await db.select().from(emailOutbox).where(predicates);
  const status = await gmailConnectionStatus();
  if (!status.configured || !status.connected) {
    if (messages.length) {
      await db.update(emailOutbox).set({ status: "PREVIEW" }).where(predicates);
    }
    return { delivered: 0, preview: messages.length };
  }

  let delivered = 0;
  for (const message of messages) {
    // Only one worker can change this row from PENDING/PREVIEW to SENDING. A heartbeat retry
    // or concurrent API request sees zero affected rows and must not contact the SMTP service.
    if (!(await claimOutboxMessage(db, message.id))) continue;
    try {
      await sendGmailMail({ to: message.recipient, subject: message.subject, html: message.html });
      const completed = await db.update(emailOutbox)
        .set({ status: "SENT", sentAt: new Date(), lastError: null })
        .where(and(eq(emailOutbox.id, message.id), eq(emailOutbox.status, "SENDING")));
      if (affectedRows(completed) === 1) delivered += 1;
    } catch (error) {
      await db.update(emailOutbox).set({
        status: "FAILED",
        lastError: (() => {
          if (!(error instanceof Error)) return "Gmail API error";
          const e = error as Error & {
            code?: string;
            errno?: string | number;
            syscall?: string;
            address?: string;
            port?: number;
            command?: string;
            response?: string;
            responseCode?: number;
          };
          return [
            e.message,
            e.code && `code=${e.code}`,
            e.errno != null && `errno=${e.errno}`,
            e.syscall && `syscall=${e.syscall}`,
            e.address && `address=${e.address}`,
            e.port != null && `port=${e.port}`,
            e.command && `command=${e.command}`,
            e.responseCode != null && `responseCode=${e.responseCode}`,
            e.response && `response=${e.response}`,
          ].filter(Boolean).join(" | ").slice(0, 1000);
        })(),
      }).where(and(eq(emailOutbox.id, message.id), eq(emailOutbox.status, "SENDING")));
    }
  }
  return { delivered, preview: 0 };
}

export async function listEmailOutbox(limit = 30) {
  const db = await getDb();
  if (!db) throw new Error("Base de données indisponible");
  return db.select({
    id: emailOutbox.id,
    requestId: emailOutbox.requestId,
    recipient: emailOutbox.recipient,
    subject: emailOutbox.subject,
    status: emailOutbox.status,
    attempts: emailOutbox.attempts,
    lastError: emailOutbox.lastError,
    sentAt: emailOutbox.sentAt,
    createdAt: emailOutbox.createdAt,
  }).from(emailOutbox).orderBy(desc(emailOutbox.createdAt)).limit(Math.max(1, Math.min(100, limit)));
}

export async function retryEmailOutbox(id: number) {
  if (!emailNotificationsEnabled()) {
    throw new Error("Les notifications par e-mail sont désactivées pendant la phase pilote.");
  }
  const db = await getDb();
  if (!db) throw new Error("Base de données indisponible");
  const result = await db.update(emailOutbox).set({ status: "PENDING", lastError: null })
    .where(and(eq(emailOutbox.id, id), eq(emailOutbox.status, "FAILED")));
  if (affectedRows(result) !== 1) {
    throw new Error("Seuls les messages en échec peuvent être retentés.");
  }
  await deliverOutbox([id]);
  const status = (await db.select({ status: emailOutbox.status }).from(emailOutbox).where(eq(emailOutbox.id, id)).limit(1))[0]?.status;
  return { status: status ?? "PENDING" };
}

export function emailShell(title: string, body: string) {
  const safeTitle = title.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f4f7fa;font-family:Arial,sans-serif;color:#17324b"><div style="max-width:640px;margin:28px auto;background:#fff;border-radius:16px;padding:32px"><div style="font-weight:700;color:#123a5a;letter-spacing:.04em">GCV-UFB</div><h1 style="font-size:24px">${safeTitle}</h1>${body}<p style="margin-top:28px">Gestion Chrétienne de la Vie<br/>Union Franco-Belge<br/><a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p></div></body></html>`;
}

export function actionButton(label: string, href: string, tone: "primary" | "warning") {
  const color = tone === "primary" ? "#176b9b" : "#a55f08";
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;padding:14px 18px;border-radius:8px;font-weight:700">${label}</a></p>`;
}
