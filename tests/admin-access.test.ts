import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import type { AdminScope } from "../server/db";

const mocks = vi.hoisted(() => ({
  managedDepartments: vi.fn(async () => []), createDepartment: vi.fn(), setDepartmentActive: vi.fn(),
  scope: vi.fn(), requests: vi.fn(async () => []), decide: vi.fn(), saveType: vi.fn(), deleteAdmin: vi.fn(async () => ({ deleted: true })), options: vi.fn(async () => ({ federations: ["FFN"] })),
}));
vi.mock("../server/db", () => ({ getAdminScope: mocks.scope }));
vi.mock("../server/services/gcv", () => ({
  listManagedDepartments: mocks.managedDepartments, createDepartment: mocks.createDepartment, setDepartmentActive: mocks.setDepartmentActive,
  listRequests: mocks.requests, decideRequest: mocks.decide, saveInterventionType: mocks.saveType, deleteAdminAccount: mocks.deleteAdmin, formOptions: mocks.options,
}));
import { appRouter } from "../server/routers";

const user = { id: 7, openId: "pilot-admin", email: "admin@example.test", name: "Pilot", loginMethod: "password", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as const;
const ctx = { user, req: { headers: {} }, res: {} } as TrpcContext;
const readOnly: AdminScope = { role: "READ_ONLY", canWrite: false, allDepartments: false, departmentIds: [2] };
beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue(readOnly); });

describe("Administrator access through the actual router", () => {
  it.each([null, readOnly, { ...readOnly, role: "ADMIN", canWrite: true }])("restricts department management to general administrators: %s", async (scope) => {
    mocks.scope.mockResolvedValue(scope);
    const caller = appRouter.createCaller(ctx).admin;
    await expect(caller.managedDepartments()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.createDepartment({ name: "Trésorerie" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.setDepartmentActive({ departmentId: 18, active: "NO" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.createDepartment).not.toHaveBeenCalled();
    expect(mocks.setDepartmentActive).not.toHaveBeenCalled();
  });
  it("allows the general administrator to create, retire and restore a department", async () => {
    const scope = { role: "PRIMARY_ADMIN", canWrite: true, allDepartments: true, departmentIds: [] };
    mocks.scope.mockResolvedValue(scope);
    const caller = appRouter.createCaller(ctx).admin;
    await caller.managedDepartments();
    await caller.createDepartment({ name: " Trésorerie " });
    await caller.setDepartmentActive({ departmentId: 18, active: "NO" });
    await caller.setDepartmentActive({ departmentId: 18, active: "YES" });
    expect(mocks.managedDepartments).toHaveBeenCalledWith(scope);
    expect(mocks.createDepartment).toHaveBeenCalledWith("Trésorerie", user.email, scope);
    expect(mocks.setDepartmentActive).toHaveBeenCalledWith({ departmentId: 18, active: "NO" }, user.email, scope);
    expect(mocks.setDepartmentActive).toHaveBeenCalledWith({ departmentId: 18, active: "YES" }, user.email, scope);
  });
  it.each(["", "  ", "x".repeat(181)])("rejects an invalid department name", async (name) => {
    mocks.scope.mockResolvedValue({ role: "PRIMARY_ADMIN", canWrite: true, allDepartments: true, departmentIds: [] });
    await expect(appRouter.createCaller(ctx).admin.createDepartment({ name })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.createDepartment).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated department changes", async () => {
    const caller = appRouter.createCaller({ ...ctx, user: null }).admin;
    await expect(caller.createDepartment({ name: "Trésorerie" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(caller.setDepartmentActive({ departmentId: 18, active: "NO" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("rejects unauthenticated reads", async () => {
    await expect(appRouter.createCaller({ ...ctx, user: null }).admin.requests({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.requests).not.toHaveBeenCalled();
  });
  it("rejects inactive or unassigned accounts", async () => {
    mocks.scope.mockResolvedValue(null);
    await expect(appRouter.createCaller(ctx).admin.requests({})).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("passes the server's scope to department-filtered reads", async () => {
    await appRouter.createCaller(ctx).admin.requests({ departmentId: 9 });
    expect(mocks.requests).toHaveBeenCalledWith({ departmentId: 9 }, readOnly);
  });
  it("allows read-only users to load the form's federation options", async () => {
    await expect(appRouter.createCaller(ctx).admin.formOptions()).resolves.toEqual({ federations: ["FFN"] });
  });
  it("rejects read-only decisions before any service mutation", async () => {
    await expect(appRouter.createCaller(ctx).admin.decide({ requestId: 1, action: "CONFIRM" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it("does not allow a read-only user to create or change intervention types", async () => {
    await expect(appRouter.createCaller(ctx).admin.saveInterventionType({ departmentId: 2, name: "Formation", active: "YES" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.saveType).not.toHaveBeenCalled();
  });
  it("rejects access to global settings for department administrators", async () => {
    mocks.scope.mockResolvedValue({ ...readOnly, role: "ADMIN", canWrite: true });
    await expect(appRouter.createCaller(ctx).admin.settings()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each([null, readOnly, { ...readOnly, role: "ADMIN", canWrite: true }])("rejects user deletion without general administrator access: %s", async (scope) => {
    mocks.scope.mockResolvedValue(scope);
    await expect(appRouter.createCaller(ctx).admin.deleteAdmin({ adminProfileId: 12 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.deleteAdmin).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated user deletion", async () => {
    await expect(appRouter.createCaller({ ...ctx, user: null }).admin.deleteAdmin({ adminProfileId: 12 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mocks.deleteAdmin).not.toHaveBeenCalled();
  });
  it("uses the authenticated actor for general administrator deletion", async () => {
    mocks.scope.mockResolvedValue({ role: "PRIMARY_ADMIN", canWrite: true, allDepartments: true, departmentIds: [] });
    await appRouter.createCaller(ctx).admin.deleteAdmin({ adminProfileId: 12 });
    expect(mocks.deleteAdmin).toHaveBeenCalledWith({ adminProfileId: 12, actorUserId: user.id, actor: user.email });
  });
  it.each([0, -1, 1.5])("rejects invalid account identifiers for deletion: %s", async (adminProfileId) => {
    mocks.scope.mockResolvedValue({ role: "PRIMARY_ADMIN", canWrite: true, allDepartments: true, departmentIds: [] });
    await expect(appRouter.createCaller(ctx).admin.deleteAdmin({ adminProfileId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mocks.deleteAdmin).not.toHaveBeenCalled();
  });
  it.each([0, -1, 1.5])("rejects invalid department identifiers: %s", async (departmentId) => {
    await expect(appRouter.createCaller(ctx).admin.requests({ departmentId })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
