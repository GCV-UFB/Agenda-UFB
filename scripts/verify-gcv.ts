import { and, eq, inArray, or } from "drizzle-orm";
import { actionTokens, auditLog, dateSlots, emailOutbox, invitationRequests, reminderLog } from "../drizzle/schema";
import { getDb } from "../server/db";
import { ADMIN_EMAIL } from "../shared/gcv";
import { claimEmailOutboxMessage } from "../server/services/email";
import { gmailConnectionStatus } from "../server/services/gmail-smtp";
import { createInvitation, decideFromActionToken, decideRequest, listPublicBootstrap, setSlotStatus } from "../server/services/gcv";

function insertId(result: unknown) {
  const first = Array.isArray(result) ? result[0] : result;
  return Number((first as { insertId?: number } | undefined)?.insertId ?? 0);
}

function dateString(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function availableFixtureDates(db: NonNullable<Awaited<ReturnType<typeof getDb>>>) {
  let start = new Date("2098-01-01T12:00:00");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidates = Array.from({ length: 5 }, (_, index) => {
      const candidate = new Date(start);
      candidate.setDate(candidate.getDate() + index);
      return dateString(candidate);
    });
    const existing = await db.select({ date: dateSlots.date }).from(dateSlots).where(inArray(dateSlots.date, candidates));
    if (existing.length === 0) return candidates;
    start.setDate(start.getDate() + 7);
  }
  throw new Error("Impossible de réserver une série de dates de test isolées.");
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("DATABASE_URL indisponible");
  const dates = await availableFixtureDates(db);
  const requestedTestDate = "2026-10-03";
  let testedRequestedDate = false;
  if (requestedTestDate >= dateString(new Date())) {
    const existing = await db.select({ id: dateSlots.id }).from(dateSlots).where(eq(dateSlots.date, requestedTestDate)).limit(1);
    if (!existing.length) { dates[0] = requestedTestDate; testedRequestedDate = true; }
  }
  const slotIds: number[] = [];
  const requestIds: number[] = [];
  let outboxClaimId: number | null = null;
  try {
    for (const date of dates) {
      const inserted = await db.insert(dateSlots).values({
        date,
        departmentId: 1,
        federation: "FFN",
        status: "AVAILABLE",
      });
      const id = insertId(inserted);
      if (!id) throw new Error("Une date temporaire n’a pas pu être créée.");
      slotIds.push(id);
    }
    const publicHas = async (id: number) => (await listPublicBootstrap()).dates.some((slot) => slot.id === id);
    const readSlot = async (id: number) => (await db.select().from(dateSlots).where(eq(dateSlots.id, id)).limit(1))[0];
    const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
    const mailStatus = await gmailConnectionStatus();
    assert(!mailStatus.connected || mailStatus.configured, "GRAPH READINESS: an unconfigured tenant must never appear connected");
    const invite = async (dateSlotId: number, suffix: string) => {
      const outcome = await createInvitation({
        dateSlotId, federation: "FFN", church: `Église de test ${suffix}`,
        contactName: `Contact Test ${suffix}`, email: `test-${suffix}@example.invalid`,
        phone: "+33600000000", interventionType: "Prédication", consent: true, notify: false,
      });
      requestIds.push(outcome.requestId);
      return outcome;
    };

    // Test 1: submit a request, lock the slot and remove it from public availability.
    const first = await invite(slotIds[0], "confirm");
    assert((await readSlot(slotIds[0]))?.status === "PENDING_CONFIRMATION", "TEST 1: request did not lock the slot");
    assert(!(await publicHas(slotIds[0])), "TEST 1: pending slot remains public");

    // Test 2: a confirmation remains blocked and creates a consistent request/slot state.
    await decideRequest({ requestId: first.requestId, action: "CONFIRM", actor: "verification-script", notify: false });
    assert((await readSlot(slotIds[0]))?.status === "CONFIRMED", "TEST 2: confirm did not confirm the slot");
    assert(!(await publicHas(slotIds[0])), "TEST 2: confirmed slot remains public");

    // Test 3: release returns the date to the public list.
    const released = await invite(slotIds[1], "release");
    await decideRequest({ requestId: released.requestId, action: "RELEASE", actor: "verification-script", notify: false });
    assert((await readSlot(slotIds[1]))?.status === "AVAILABLE", "TEST 3: release did not restore availability");
    assert(await publicHas(slotIds[1]), "TEST 3: released slot did not return to the public list");

    // Test 4: concurrent submissions accept one request; competing admin decisions cannot overwrite it.
    const submissions = await Promise.allSettled(["race-a", "race-b"].map((suffix) => invite(slotIds[2], suffix)));
    const accepted = submissions.filter((item): item is PromiseFulfilledResult<Awaited<ReturnType<typeof invite>>> => item.status === "fulfilled");
    assert(accepted.length === 1, `TEST 4: expected one accepted reservation, received ${accepted.length}`);
    const requestId = accepted[0].value.requestId;
    const decisions = await Promise.allSettled([
      decideRequest({ requestId, action: "CONFIRM", actor: "verification-script", notify: false }),
      decideRequest({ requestId, action: "RELEASE", actor: "verification-script", notify: false }),
    ]);
    assert(decisions.filter((item) => item.status === "fulfilled").length === 1, "TEST 4: exactly one competing decision must succeed");
    const decided = (await db.select().from(invitationRequests).where(eq(invitationRequests.id, requestId)).limit(1))[0];
    const decidedSlot = await readSlot(slotIds[2]);
    assert((decided?.status === "CONFIRMED" && decidedSlot?.status === "CONFIRMED") || (decided?.status === "REFUSED" && decidedSlot?.status === "AVAILABLE"), "TEST 4: request and slot ended in contradictory states");

    // Tests 5 and 6: manual blocking hides a slot, then releasing it restores visibility.
    await setSlotStatus(slotIds[3], "UNAVAILABLE", "verification-script");
    assert(!(await publicHas(slotIds[3])), "TEST 5: blocked slot remains public");
    await setSlotStatus(slotIds[3], "AVAILABLE", "verification-script");
    assert(await publicHas(slotIds[3]), "TEST 6: released slot did not return to public visibility");

    // Competing one-use email action links must also produce only one valid decision.
    const tokenRequest = await invite(slotIds[4], "link-race");
    const tokenRows = await db.select({ html: emailOutbox.html }).from(emailOutbox).where(eq(emailOutbox.requestId, tokenRequest.requestId));
    const rawTokens = [...(tokenRows[0]?.html ?? "").matchAll(/\/api\/actions\/([A-Za-z0-9_-]+)/g)].map((match) => match[1]).slice(0, 2);
    assert(rawTokens.length === 2, "EMAIL ACTION RACE: expected two decision tokens in the outbox message");
    const outcomes = await Promise.all(rawTokens.map((token) => decideFromActionToken(token, false)));
    assert(outcomes.filter(Boolean).length === 1, "EMAIL ACTION RACE: competing links must produce one decision");
    const tokenDecision = (await db.select().from(invitationRequests).where(eq(invitationRequests.id, tokenRequest.requestId)).limit(1))[0];
    const tokenSlot = await readSlot(slotIds[4]);
    assert((tokenDecision?.status === "CONFIRMED" && tokenSlot?.status === "CONFIRMED") || (tokenDecision?.status === "REFUSED" && tokenSlot?.status === "AVAILABLE"), "EMAIL ACTION RACE: request and slot ended in contradictory states");

    const outboxFixture = await db.insert(emailOutbox).values({
      requestId: null,
      recipient: "outbox-race@example.invalid",
      replyTo: ADMIN_EMAIL,
      subject: "Test de claim atomique",
      html: "<p>Fixture temporaire — aucun envoi réel.</p>",
      status: "PENDING",
    });
    outboxClaimId = insertId(outboxFixture);
    assert(outboxClaimId > 0, "EMAIL OUTBOX RACE: could not create isolated fixture");
    const claims = await Promise.all([claimEmailOutboxMessage(outboxClaimId), claimEmailOutboxMessage(outboxClaimId)]);
    assert(claims.filter(Boolean).length === 1, "EMAIL OUTBOX RACE: exactly one concurrent worker must claim a message");
    const claimedMessage = (await db.select({ status: emailOutbox.status, attempts: emailOutbox.attempts }).from(emailOutbox).where(eq(emailOutbox.id, outboxClaimId)).limit(1))[0];
    assert(claimedMessage?.status === "SENDING" && claimedMessage.attempts === 1, "EMAIL OUTBOX RACE: claim state or attempt count is inconsistent");

    console.log(JSON.stringify({ ok: true, scenarios: [1, 2, 3, 4, 5, 6, "email-action-race", "email-outbox-claim-race", "graph-readiness-fail-closed"], requestedDate: testedRequestedDate ? requestedTestDate : "skipped (existing or no longer future)", fixtureDates: dates }));
  } finally {
    if (outboxClaimId) await db.delete(emailOutbox).where(eq(emailOutbox.id, outboxClaimId));
    if (requestIds.length) {
      await db.delete(reminderLog).where(inArray(reminderLog.requestId, requestIds));
      await db.delete(actionTokens).where(inArray(actionTokens.requestId, requestIds));
      await db.delete(emailOutbox).where(inArray(emailOutbox.requestId, requestIds));
      await db.delete(auditLog).where(inArray(auditLog.requestId, requestIds));
      await db.delete(invitationRequests).where(inArray(invitationRequests.id, requestIds));
    }
    if (slotIds.length) {
      await db.delete(auditLog).where(and(eq(auditLog.entityType, "date_slot"), inArray(auditLog.entityId, slotIds.map(String))));
      await db.delete(dateSlots).where(inArray(dateSlots.id, slotIds));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
