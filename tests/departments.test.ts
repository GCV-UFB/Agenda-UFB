import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { groupSlotsByDate } from "../shared/calendar";
import type { AdminScope } from "../server/db";
import { departments } from "../drizzle/schema";

const { query, database } = vi.hoisted(() => {
  const query = {
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockResolvedValue([]),
  };
  return { query, database: { select: vi.fn((_fields: unknown) => query) } };
});
vi.mock("../server/db", () => ({ getDb: vi.fn(async () => database) }));
import { listCalendar, listRequests } from "../server/services/gcv";

const primary: AdminScope = { role: "PRIMARY_ADMIN", allDepartments: true, departmentIds: [], canWrite: true };
const restricted: AdminScope = { role: "ADMIN", allDepartments: false, departmentIds: [2, 3], canWrite: true };
const dialect = new MySqlDialect();
function condition() {
  const sql = query.where.mock.calls.at(-1)?.[0];
  return sql ? dialect.sqlToQuery(sql) : { sql: "", params: [] };
}
beforeEach(() => {
  vi.clearAllMocks();
  query.orderBy.mockResolvedValue([]);
});

describe.each([
  ["Agenda", listCalendar, "date_slots"],
  ["Demandes", listRequests, "invitation_requests"],
] as const)("Department filtering in %s", (_label, list, table) => {
  it("combines the selected department with the administrator's scope", async () => {
    await list({ departmentId: 9, month: "2026-10", federation: "FFN" }, restricted);
    const where = condition();
    expect(where.sql).toContain(`\`${table}\`.\`departmentId\` in (?, ?)`);
    expect(where.sql).toContain(`\`${table}\`.\`departmentId\` = ?`);
    expect(where.sql).toContain(" and ");
    expect(where.params).toEqual(expect.arrayContaining([2, 3, 9, "2026-10%"]));
  });

  it("keeps the scope when all authorized departments are selected", async () => {
    await list({}, { ...restricted, role: "READ_ONLY", canWrite: false });
    expect(condition().params).toEqual([2, 3]);
  });

  it("returns no accessible rows when the administrator has no assignments", async () => {
    await list({ departmentId: 9 }, { ...restricted, departmentIds: [] });
    expect(condition().params).toEqual([-1, 9]);
  });

  it("filters primary administrators and includes the department identity", async () => {
    await list({ departmentId: 2 }, primary);
    expect(condition().params).toEqual([2]);
    expect(database.select.mock.calls[0]?.[0]).toHaveProperty("department", departments);
    expect(query.leftJoin.mock.calls.some(([table]) => table === departments)).toBe(true);
  });
});

describe("Calendar dates shared by departments and federations", () => {
  it("preserves every slot, including different statuses and departments on the same day", () => {
    const entries = [
      { slot: { id: 1, date: "2026-10-17", departmentId: 2, federation: "FFN", status: "AVAILABLE" } },
      { slot: { id: 2, date: "2026-10-17", departmentId: 3, federation: "FFN", status: "CONFIRMED" } },
      { slot: { id: 3, date: "2026-10-17", departmentId: 2, federation: "FFS", status: "UNAVAILABLE" } },
      { slot: { id: 4, date: "2026-10-18", departmentId: 2, federation: "FFN", status: "AVAILABLE" } },
    ];
    const result = groupSlotsByDate(entries);
    expect(result.get("2026-10-17")).toEqual(entries.slice(0, 3));
    expect(result.get("2026-10-18")).toEqual([entries[3]]);
    expect(entries).toHaveLength(4);
  });

  it("handles an empty agenda", () => {
    expect(groupSlotsByDate([]).size).toBe(0);
  });
});
