import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../server/_core/context";
import type { AdminScope } from "../server/db";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(), requests: vi.fn(async () => []), decide: vi.fn(), saveType: vi.fn(), deleteAdmin: vi.fn(async () => ({ deleted: true })), options: vi.fn(async () => ({ federations: ["FFN"] })),
}));
vi.mock("../server/db", () => ({ getAdminScope: mocks.scope }));
vi.mock("../server/services/gcv", () => ({
  listRequests: mocks.requests, decideRequest: mocks.decide, saveInterventionType: mocks.saveType, deleteAdminAccount: mocks.deleteAdmin, formOptions: mocks.options,
}));
import { appRouter } from "../server/routers";

const user = { id: 7, openId: "pilot-admin", email: "admin@example.test", name: "Pilot", loginMethod: "password", role: "admin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() } as const;
const ctx = { user, req: { headers: {} }, res: {} } as TrpcContext;
const readOnly: AdminScope = { role: "READ_ONLY", canWrite: false, allDepartments: false, departmentIds: [2] };
beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue(readOnly); });

describe("Administrator access through the actual router", () => {
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
