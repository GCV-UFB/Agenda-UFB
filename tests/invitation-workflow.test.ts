import { beforeEach, describe, expect, it, vi } from "vitest";
import { appSettings, dateSlots, departments, interventionTypes, adminProfiles, emailOutbox, invitationRequests } from "../drizzle/schema";

const mock = vi.hoisted(() => ({ getDb: vi.fn(), mail: vi.fn(), deliver: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mock.getDb }));
vi.mock("../server/services/gmail-smtp", () => ({ gmailConnectionStatus: mock.mail }));
vi.mock("../server/services/email", () => ({ deliverOutbox: mock.deliver, emailShell: (_title: string, body: string) => body }));
vi.mock("../server/services/google-calendar", () => ({ createGcvCalendarEvent: vi.fn(), updateGcvCalendarEvent: vi.fn(), deleteGcvCalendarEvent: vi.fn() }));
import { appRouter } from "../server/routers";
import type { TrpcContext } from "../server/_core/context";
import { createInvitation, listPublicBootstrap, saveInterventionType } from "../server/services/gcv";

let activeDepartment = true;
let slot = { id: 1, departmentId: 2, federation: "FFN", date: "2098-01-03", status: "AVAILABLE" };
let affectedRows = 1;
let inserts: { table: unknown; value: Record<string, unknown> }[] = [];
let selections: { table: unknown; fields: unknown }[] = [];
const input = { dateSlotId: 1, federation: "FFN", church: "Église test", contactName: "Contact test", email: "requester@example.test", phone: "+33000000000", interventionTypeId: 3, consent: true as const, notify: false };

beforeEach(() => {
  vi.clearAllMocks();
  activeDepartment = true; affectedRows = 1; inserts = []; selections = [];
  slot = { id: 1, departmentId: 2, federation: "FFN", date: "2098-01-03", status: "AVAILABLE" };
  mock.mail.mockResolvedValue({ configured: true, connected: true });
  function rows(table: unknown) {
    if (table === appSettings) return [];
    if (table === dateSlots) return [slot];
    if (table === departments) return activeDepartment ? [{ id: 2, name: "Jeunesse", code: "JEUNESSE" }] : [];
    if (table === interventionTypes) return [{ id: 3, departmentId: 2, name: "Formation" }];
    if (table === adminProfiles) return [{ email: "manager@example.test" }, { email: "MANAGER@example.test" }];
    return [];
  }
  const db = {
    select: (fields?: unknown) => ({ from: (table: unknown) => {
      selections.push({ table, fields });
      const q = { where: () => q, innerJoin: () => q, leftJoin: () => q, orderBy: () => Promise.resolve(rows(table)), limit: (n: number) => Promise.resolve(rows(table).slice(0, n)), then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows(table)).then(resolve) };
      return q;
    } }),
    update: () => ({ set: () => ({ where: async () => [{ affectedRows }] }) }),
    insert: (table: unknown) => ({ values: async (value: Record<string, unknown>) => { inserts.push({ table, value }); return [{ insertId: inserts.length }]; } }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db),
  };
  mock.getDb.mockResolvedValue(db);
});

describe("Invitation submission", () => {
  it("does not expose internal slot notes through the public bootstrap", async () => {
    await listPublicBootstrap();
    const fields = selections.find((selection) => selection.table === dateSlots)?.fields;
    expect(Object.keys(fields as object).sort()).toEqual(["date", "departmentId", "federation", "id"]);
  });
  it("accepts submissions when email is unavailable without queuing notifications", async () => {
    mock.mail.mockResolvedValue({ configured: false, connected: false });
    const outcome = await createInvitation({ ...input, notify: true });
    expect(outcome.submissionId).toMatch(/^UFB-/);
    expect(inserts.some((entry) => entry.table === invitationRequests)).toBe(true);
    expect(inserts.some((entry) => entry.table === emailOutbox)).toBe(false);
    expect(mock.deliver).not.toHaveBeenCalled();
  });
  it("ignores a public notify parameter and accepts requests without email", async () => {
    mock.mail.mockResolvedValue({ configured: false, connected: false });
    const ctx = { user: null, req: { headers: {} }, res: {} } as TrpcContext;
    const outcome = await appRouter.createCaller(ctx).public.submitRequest(input);
    expect(outcome.submissionId).toMatch(/^UFB-/);
    expect(mock.mail).toHaveBeenCalled();
    expect(inserts.some((entry) => entry.table === invitationRequests)).toBe(true);
    expect(inserts.some((entry) => entry.table === emailOutbox)).toBe(false);
    expect(mock.deliver).not.toHaveBeenCalled();
  });
  it("rejects a slot from a different federation", async () => {
    slot.federation = "FFS";
    await expect(createInvitation(input)).rejects.toThrow("réservée");
    expect(inserts).toEqual([]);
  });
  it("rejects an inactive department before creating a request", async () => {
    activeDepartment = false;
    await expect(createInvitation(input)).rejects.toThrow("département sélectionné");
    expect(inserts).toEqual([]);
  });
  it("rejects an already claimed slot before creating a request or email", async () => {
    affectedRows = 0;
    await expect(createInvitation(input)).rejects.toThrow("réservée");
    expect(inserts).toEqual([]);
  });
  it("records pilot submissions without creating email notifications", async () => {
    const outcome = await createInvitation(input);
    expect(outcome.submissionId).toMatch(/^UFB-/);
    expect(inserts.filter((entry) => entry.table === emailOutbox)).toEqual([]);
    expect(inserts.find((entry) => entry.table === invitationRequests)?.value).toMatchObject({ departmentId: 2, interventionTypeId: 3, status: "PENDING" });
    expect(mock.deliver).not.toHaveBeenCalled();
  });
});


describe("Intervention type management", () => {
  const scope = { role: "ADMIN" as const, canWrite: true, allDepartments: false, departmentIds: [2] };
  it("rejects edits outside the administrator's departments before contacting the database", async () => {
    await expect(saveInterventionType({ departmentId: 9, name: "Formation", active: "YES" }, "test-admin", scope)).rejects.toThrow("pas autorisé");
    expect(mock.getDb).not.toHaveBeenCalled();
  });
  it("creates a type in the permitted department without sending emails", async () => {
    await saveInterventionType({ departmentId: 2, name: "Formation", active: "YES" }, "test-admin", scope);
    expect(inserts.find((entry) => entry.table === interventionTypes)?.value).toMatchObject({ departmentId: 2, name: "Formation", active: "YES" });
    expect(mock.deliver).not.toHaveBeenCalled();
  });
  it("rejects an update that does not match a type in this department", async () => {
    affectedRows = 0;
    await expect(saveInterventionType({ id: 99, departmentId: 2, name: "Formation", active: "NO" }, "test-admin", scope)).rejects.toThrow("introuvable dans ce département");
    expect(inserts).toEqual([]);
  });
});
