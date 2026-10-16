import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { adminCredentials, adminDepartments, adminProfiles, auditLog, users } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
import { deleteAdminAccount } from "../server/services/gcv";

type Profile = { id: number; userId: number; email: string; role: "PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY"; active: "YES" | "NO" };
const actor: Profile = { id: 1, userId: 7, email: "primary@example.test", role: "PRIMARY_ADMIN", active: "YES" };
const target: Profile = { id: 12, userId: 25, email: "test.lecture@agenda-ufb.local", role: "READ_ONLY", active: "NO" };
const dialect = new MySqlDialect();
let state: { profiles: Profile[]; credentials: { adminProfileId: number }[]; assignments: { adminProfileId: number; departmentId: number }[]; users: { id: number }[]; audit: unknown[]; invitations: { id: number }[]; dates: { id: number }[] };
let failAudit = false;
const lock = vi.fn();
const deletedTables = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  failAudit = false;
  state = { profiles: [{ ...actor }, { ...target }], credentials: [{ adminProfileId: 1 }, { adminProfileId: 12 }], assignments: [{ adminProfileId: 12, departmentId: 2 }], users: [{ id: 7 }, { id: 25 }], audit: [], invitations: [{ id: 55 }], dates: [{ id: 60 }] };
  const query = {
    from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
    for: vi.fn(async (mode: string) => { lock(mode); return state.profiles; }),
  };
  const tx = {
    select: () => query,
    delete: (table: unknown) => ({ where: async (condition: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
      deletedTables(table);
      const id = dialect.sqlToQuery(condition).params[0];
      if (table === adminCredentials) state.credentials = state.credentials.filter((row) => row.adminProfileId !== id);
      else if (table === adminDepartments) state.assignments = state.assignments.filter((row) => row.adminProfileId !== id);
      else if (table === adminProfiles) state.profiles = state.profiles.filter((row) => row.id !== id);
      else if (table === users) state.users = state.users.filter((row) => row.id !== id);
      else throw new Error("Unexpected table deletion");
    } }),
    insert: (table: unknown) => ({ values: async (value: unknown) => {
      expect(table).toBe(auditLog);
      if (failAudit) throw new Error("Audit unavailable");
      state.audit.push(value);
    } }),
  };
  mocks.getDb.mockResolvedValue({ transaction: async (run: (connection: typeof tx) => Promise<unknown>) => {
    const before = structuredClone(state);
    try { return await run(tx); } catch (error) { state = before; throw error; }
  } });
});

const remove = () => deleteAdminAccount({ adminProfileId: target.id, actorUserId: actor.userId, actor: actor.email });
describe("Delete an application user", () => {
  it("removes a disabled read-only account, credentials and assignments but preserves agenda records", async () => {
    await expect(remove()).resolves.toEqual({ deleted: true, id: 12 });
    expect(lock).toHaveBeenCalledWith("update");
    expect(state.profiles).toEqual([actor]);
    expect(state.credentials).toEqual([{ adminProfileId: 1 }]);
    expect(state.assignments).toEqual([]);
    expect(state.users).toEqual([{ id: 7 }]);
    expect(state.invitations).toEqual([{ id: 55 }]);
    expect(state.dates).toEqual([{ id: 60 }]);
    expect(state.audit).toEqual([expect.objectContaining({ action: "ADMIN_ACCOUNT_DELETED", entityId: "12", actor: actor.email })]);
  });
  it.each(["ADMIN", "READ_ONLY", "PRIMARY_ADMIN"] as const)("deletes another %s account while retaining the acting general administrator", async (role) => {
    state.profiles[1] = { ...target, role, active: "YES" };
    await remove();
    expect(state.profiles).toEqual([actor]);
  });
  it("rejects a missing or already deleted account", async () => {
    state.profiles = [actor];
    await expect(remove()).rejects.toThrow("introuvable");
    expect(deletedTables).not.toHaveBeenCalled();
  });
  it("prevents deleting the last active general administrator", async () => {
    await expect(deleteAdminAccount({ adminProfileId: actor.id, actorUserId: actor.userId, actor: actor.email })).rejects.toThrow("dernier administrateur général");
    expect(deletedTables).not.toHaveBeenCalled();
  });
  it("prevents self-deletion even when another general administrator exists", async () => {
    state.profiles[1] = { ...target, role: "PRIMARY_ADMIN", active: "YES" };
    await expect(deleteAdminAccount({ adminProfileId: actor.id, actorUserId: actor.userId, actor: actor.email })).rejects.toThrow("propre compte");
    expect(deletedTables).not.toHaveBeenCalled();
  });
  it.each([{ ...actor, active: "NO" }, { ...actor, role: "ADMIN" }])("rechecks the actor inside the transaction", async (account) => {
    state.profiles[0] = account as Profile;
    await expect(remove()).rejects.toThrow("Seule l’administration générale");
    expect(deletedTables).not.toHaveBeenCalled();
  });
  it("rolls back all account deletions if recording the audit fails", async () => {
    const before = structuredClone(state);
    failAudit = true;
    await expect(remove()).rejects.toThrow("Audit unavailable");
    expect(state).toEqual(before);
  });
});
