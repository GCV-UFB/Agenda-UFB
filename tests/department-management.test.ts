import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { departments, auditLog } from "../drizzle/schema";
import type { AdminScope } from "../server/db";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../server/db", () => ({ getDb: mocks.getDb }));
import { createDepartment, listDepartments, listManagedDepartments, setDepartmentActive } from "../server/services/gcv";

type Department = { id: number; name: string; code: string; active: "YES" | "NO" };
const primary: AdminScope = { role: "PRIMARY_ADMIN", canWrite: true, allDepartments: true, departmentIds: [] };
const actor = "primary@example.test";
const dialect = new MySqlDialect();
let state: { departments: Department[]; audit: unknown[]; dates: unknown[]; invitations: unknown[]; assignments: unknown[]; types: unknown[] };
let auditFailure = false;
let duplicateInsert = false;
const lock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks(); auditFailure = false; duplicateInsert = false;
  state = { departments: [{ id: 1, name: "Communication", code: "COMMUNICATION", active: "YES" }], audit: [], dates: [{ departmentId: 1, date: "2026-11-01" }], invitations: [{ departmentId: 1, status: "CONFIRMED" }], assignments: [{ departmentId: 1, adminProfileId: 7 }], types: [{ departmentId: 1, name: "Formation" }] };
  const database = {
    select: () => {
      let where: ReturnType<MySqlDialect["sqlToQuery"]> | undefined;
      let max: number | undefined;
      const query = {
        from: (table: unknown) => { expect(table).toBe(departments); return query; },
        where: (sql: Parameters<MySqlDialect["sqlToQuery"]>[0]) => { where = dialect.sqlToQuery(sql); return query; },
        limit: (n: number) => { max = n; return query; },
        orderBy: () => query,
        for: (mode: string) => { lock(mode); return query; },
        then: (resolve: (rows: Department[]) => unknown) => {
          let rows = state.departments;
          if (where?.sql.includes('`departments`.`id` = ?')) rows = rows.filter((row) => row.id === where?.params[0]);
          if (where?.sql.includes('`departments`.`active` = ?')) rows = rows.filter((row) => row.active === "YES");
          return Promise.resolve(resolve(structuredClone(max ? rows.slice(0, max) : rows)));
        },
      };
      return query;
    },
    insert: (table: unknown) => ({ values: async (value: Record<string, unknown>) => {
      if (table === auditLog) {
        if (auditFailure) throw new Error("Audit unavailable");
        state.audit.push(value); return [{ insertId: state.audit.length }];
      }
      expect(table).toBe(departments);
      if (duplicateInsert) throw { cause: { code: "ER_DUP_ENTRY" } };
      const id = state.departments.length + 1;
      state.departments.push({ id, ...value } as Department);
      return [{ insertId: id }];
    } }),
    update: (table: unknown) => ({ set: (values: { active: "YES" | "NO" }) => ({ where: async (sql: Parameters<MySqlDialect["sqlToQuery"]>[0]) => {
      expect(table).toBe(departments);
      const id = dialect.sqlToQuery(sql).params[0];
      state.departments = state.departments.map((row) => row.id === id ? { ...row, ...values } : row);
    } }) }),
  };
  mocks.getDb.mockResolvedValue({ ...database, transaction: async (run: (tx: typeof database) => Promise<unknown>) => {
    const before = structuredClone(state);
    try { return await run(database); } catch (error) { state = before; throw error; }
  } });
});

describe("Department lifecycle", () => {
  it("creates Trésorerie without changing existing departments or their activity", async () => {
    const before = structuredClone(state);
    const result = await createDepartment(" Trésorerie ", actor, primary);
    expect(result).toEqual({ id: 2, name: "Trésorerie", active: "YES" });
    expect(state.departments[1].code).toBe("TRESORERIE");
    expect(await listDepartments(primary)).toHaveLength(2);
    expect(state.departments[0]).toEqual(before.departments[0]);
    expect(state.audit).toEqual([expect.objectContaining({ action: "DEPARTMENT_CREATED", actor })]);
    expect(state.dates).toEqual(before.dates);
  });
  it.each(["communication", "  COMMUNICATION  ", "Communicátion"])("rejects duplicate names: %s", async (name) => {
    await expect(createDepartment(name, actor, primary)).rejects.toThrow("existe déjà");
    expect(state.departments).toHaveLength(1);
  });
  it("directs an existing retired department to restoration", async () => {
    state.departments[0].active = "NO";
    await expect(createDepartment("Communication", actor, primary)).rejects.toThrow("RÉTABLIR");
  });
  it("handles a database uniqueness race with a useful error", async () => {
    duplicateInsert = true;
    await expect(createDepartment("Trésorerie", actor, primary)).rejects.toThrow("existe déjà");
    expect(state.departments).toHaveLength(1);
  });
  it("retires a department from active choices, preserves all links, and restores the same identity", async () => {
    const before = structuredClone(state);
    await setDepartmentActive({ departmentId: 1, active: "NO" }, actor, primary);
    expect(lock).toHaveBeenCalledWith("update");
    expect(await listDepartments(primary)).toEqual([]);
    expect(await listManagedDepartments(primary)).toEqual([{ ...before.departments[0], active: "NO" }]);
    for (const key of ["dates", "invitations", "assignments", "types"] as const) expect(state[key]).toEqual(before[key]);
    await setDepartmentActive({ departmentId: 1, active: "YES" }, actor, primary);
    expect(state.departments).toEqual(before.departments);
    expect(state.audit).toEqual([
      expect.objectContaining({ action: "DEPARTMENT_RETIRED" }),
      expect.objectContaining({ action: "DEPARTMENT_RESTORED" }),
    ]);
  });
  it("does not duplicate audit entries on repeated retirement", async () => {
    await setDepartmentActive({ departmentId: 1, active: "NO" }, actor, primary);
    await setDepartmentActive({ departmentId: 1, active: "NO" }, actor, primary);
    expect(state.audit).toHaveLength(1);
  });
  it("rejects a missing department", async () => {
    await expect(setDepartmentActive({ departmentId: 999, active: "NO" }, actor, primary)).rejects.toThrow("introuvable");
  });
  it.each(["ADMIN", "READ_ONLY"] as const)("rejects %s even when the service is called directly", async (role) => {
    const scope = { ...primary, role };
    await expect(createDepartment("Trésorerie", actor, scope)).rejects.toThrow("administration générale");
    await expect(setDepartmentActive({ departmentId: 1, active: "NO" }, actor, scope)).rejects.toThrow("administration générale");
    expect(state.audit).toEqual([]);
  });
  it("rolls back creation and retirement if audit recording fails", async () => {
    const before = structuredClone(state); auditFailure = true;
    await expect(createDepartment("Trésorerie", actor, primary)).rejects.toThrow("Audit unavailable");
    expect(state).toEqual(before);
    await expect(setDepartmentActive({ departmentId: 1, active: "NO" }, actor, primary)).rejects.toThrow("Audit unavailable");
    expect(state).toEqual(before);
  });
});
