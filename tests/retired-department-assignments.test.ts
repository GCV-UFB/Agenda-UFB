import { beforeEach, describe, expect, it, vi } from "vitest";
import { adminDepartments, adminProfiles, departments, users } from "../drizzle/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), writes: vi.fn(), query: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
vi.mock("../server/_core/password", () => ({ hashPassword: vi.fn(async () => "test-hash") }));
import { createAdminAccount, updateAdminAccount } from "../server/services/gcv";

let results: unknown[][];
const dialect = new MySqlDialect();
beforeEach(() => {
  vi.clearAllMocks(); results = [];
  const tx = {
    select: () => {
      let table: unknown;
      const query = {
        from: (value: unknown) => { table = value; return query; },
        where: (sql: Parameters<MySqlDialect["sqlToQuery"]>[0]) => { mocks.query(table, dialect.sqlToQuery(sql)); return query; },
        limit: () => query,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(resolve(results.shift() ?? [])),
      };
      return query;
    },
    update: (table: unknown) => ({ set: (value: unknown) => ({ where: async () => { mocks.writes("update", table, value); } }) }),
    delete: (table: unknown) => ({ where: async () => { mocks.writes("delete", table); } }),
    insert: (table: unknown) => ({ values: async (value: unknown) => { mocks.writes("insert", table, value); return [{ insertId: 1 }]; } }),
  };
  mocks.getDb.mockResolvedValue({ transaction: (fn: (db: typeof tx) => unknown) => fn(tx) });
});
const update = { adminProfileId: 7, name: "Jacques", email: "jacques@example.test", role: "ADMIN" as const, active: "YES" as const, departmentIds: [18], actor: "primary@example.test" };
describe("Retired department assignments", () => {
  it("allows an existing assignment to be retained when editing a responsible account", async () => {
    results = [[{ profileId: 7, userId: 9, email: update.email, currentRole: "ADMIN" }], [{ id: 7 }], [{ id: 18, active: "NO" }], [{ departmentId: 18 }]];
    await updateAdminAccount(update);
    expect(mocks.writes).toHaveBeenCalledWith("update", users, expect.objectContaining({ name: "Jacques" }));
    expect(mocks.writes).toHaveBeenCalledWith("insert", adminDepartments, [{ adminProfileId: 7, departmentId: 18 }]);
  });
  it("rejects new assignments to a retired department before changing the user", async () => {
    results = [[{ profileId: 7, userId: 9, email: update.email, currentRole: "ADMIN" }], [{ id: 7 }], [{ id: 18, active: "NO" }], []];
    await expect(updateAdminAccount(update)).rejects.toThrow("ne peut pas être attribué");
    expect(mocks.writes).not.toHaveBeenCalled();
  });
  it("still requires active departments when creating a new responsible account", async () => {
    results = [[], []];
    await expect(createAdminAccount({ name: "Jean", email: "jean@example.test", password: "long-test-password", role: "READ_ONLY", departmentIds: [18], actor: update.actor })).rejects.toThrow("invalides ou inactifs");
    expect(mocks.query).toHaveBeenCalledWith(adminProfiles, expect.anything());
    expect(mocks.query).toHaveBeenCalledWith(departments, expect.objectContaining({ params: [18, "YES"] }));
    expect(mocks.writes).not.toHaveBeenCalled();
  });
});
