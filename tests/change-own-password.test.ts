import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { adminCredentials, adminProfiles, auditLog } from "../drizzle/schema";
import { hashPassword, verifyPassword } from "../server/_core/password";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), lock: vi.fn(), query: vi.fn(), write: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
import { changeOwnPassword } from "../server/services/account";

const oldPassword = "Current-password-123";
const newPassword = "Personal-password-456";
const dialect = new MySqlDialect();
let originalHash: string;
let account: { userId: number; profileId: number; email: string; active: "YES" | "NO"; passwordHash: string; failedAttempts: number; lockedUntil: Date | null; passwordChangedAt?: Date };
let missingCredentials = false;
let auditFails = false;
let audit: unknown[];
beforeAll(async () => { originalHash = await hashPassword(oldPassword); });
beforeEach(() => {
  vi.clearAllMocks(); missingCredentials = false; auditFails = false; audit = [];
  account = { userId: 7, profileId: 12, email: "reader@example.test", active: "YES", passwordHash: originalHash, failedAttempts: 0, lockedUntil: null };
  let condition: ReturnType<MySqlDialect["sqlToQuery"]>;
  const query = {
    from: (table: unknown) => { expect(table).toBe(adminProfiles); return query; },
    innerJoin: () => query,
    where: (sql: Parameters<MySqlDialect["sqlToQuery"]>[0]) => { condition = dialect.sqlToQuery(sql); mocks.query(condition); return query; },
    limit: () => query,
    for: async (mode: string) => {
      mocks.lock(mode);
      return !missingCredentials && condition.params[0] === account.userId && account.active === "YES" ? [structuredClone(account)] : [];
    },
  };
  const tx = {
    select: () => query,
    update: (table: unknown) => ({ set: (values: Partial<typeof account>) => ({ where: async (sql: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
      expect(table).toBe(adminCredentials);
      expect(dialect.sqlToQuery(sql).params).toEqual([12]);
      mocks.write(table, values);
      Object.assign(account, values);
      return [{ affectedRows: 1 }];
    } }) }),
    insert: (table: unknown) => ({ values: async (value: unknown) => {
      expect(table).toBe(auditLog);
      if (auditFails) throw new Error("Audit unavailable");
      audit.push(value);
    } }),
  };
  mocks.getDb.mockResolvedValue({ transaction: async (fn: (db: typeof tx) => Promise<unknown>) => {
    const snapshot = structuredClone({ account, audit });
    try { return await fn(tx); } catch (error) { account = snapshot.account; audit = snapshot.audit; throw error; }
  } });
});

const change = (currentPassword = oldPassword, next = newPassword, userId = 7) => changeOwnPassword({ userId, currentPassword, newPassword: next });
describe("Change own password", () => {
  it("replaces the credential hash, accepts the new password and rejects the old one", async () => {
    await expect(change()).resolves.toEqual({ success: true });
    expect(mocks.lock).toHaveBeenCalledWith("update");
    expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ params: [7, "YES"] }));
    expect(account.passwordHash).not.toBe(originalHash);
    expect(account.passwordHash).not.toBe(newPassword);
    expect(await verifyPassword(newPassword, account.passwordHash)).toBe(true);
    expect(await verifyPassword(oldPassword, account.passwordHash)).toBe(false);
    expect(account.passwordChangedAt).toBeInstanceOf(Date);
    expect(audit).toEqual([{ action: "ADMIN_PASSWORD_CHANGED", entityType: "admin", entityId: "12", actor: account.email, details: null }]);
    for (const secret of [oldPassword, newPassword, account.passwordHash]) expect(JSON.stringify(audit)).not.toContain(secret);
    expect(account.userId).toBe(7);
    expect(account.active).toBe("YES");
  });
  it("rejects a wrong current password and commits its failure counter", async () => {
    await expect(change("wrong-password")).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Le mot de passe actuel est incorrect." });
    expect(account.failedAttempts).toBe(1);
    expect(account.passwordHash).toBe(originalHash);
    expect(audit).toEqual([]);
  });
  it("locks password attempts for 15 minutes after five failures", async () => {
    account.failedAttempts = 4;
    await expect(change("wrong-password")).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(account.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
    expect(account.passwordHash).toBe(originalHash);
    expect(account.failedAttempts).toBe(0);
  });
  it("honors an existing lock even with the correct password", async () => {
    account.lockedUntil = new Date(Date.now() + 60000);
    await expect(change()).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("allows a valid change after an expired lock and clears failed attempts", async () => {
    account.lockedUntil = new Date(Date.now() - 1000); account.failedAttempts = 2;
    await change();
    expect(account.lockedUntil).toBeNull(); expect(account.failedAttempts).toBe(0);
  });
  it("rejects reusing the current password", async () => {
    await expect(change(oldPassword, oldPassword)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rechecks that the account remains active", async () => {
    account.active = "NO";
    await expect(change()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("does not change another user's account", async () => {
    await expect(change(oldPassword, newPassword, 99)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("rejects an account without local credentials", async () => {
    missingCredentials = true;
    await expect(change()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rolls back the password if recording its audit event fails", async () => {
    auditFails = true;
    await expect(change()).rejects.toThrow("Audit unavailable");
    expect(account.passwordHash).toBe(originalHash);
    expect(audit).toEqual([]);
  });
  it.each(["short", "x".repeat(201)])("validates password length in the service too", async (value) => {
    await expect(change(oldPassword, value)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
