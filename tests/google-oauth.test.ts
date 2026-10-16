import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";

const mock = vi.hoisted(() => ({
  authenticate: vi.fn(), scope: vi.fn(), save: vi.fn(), getToken: vi.fn(), verify: vi.fn(), authUrl: vi.fn(),
}));
vi.mock("../server/_core/env", () => ({ ENV: { cookieSecret: "test-only-secret-with-more-than-32-characters" } }));
vi.mock("../server/_core/sdk", () => ({ sdk: { authenticateRequest: mock.authenticate } }));
vi.mock("../server/db", () => ({ getAdminScope: mock.scope }));
vi.mock("../server/services/google-mail-token", () => ({ saveGoogleRefreshToken: mock.save }));
vi.mock("googleapis", () => ({ google: { auth: { OAuth2: vi.fn(function () {
  return { getToken: mock.getToken, verifyIdToken: mock.verify, generateAuthUrl: mock.authUrl };
}) } } }));
import { createGoogleState, validGoogleState, registerGoogleOAuthRoutes } from "../server/routes/google-oauth";

const user = { id: 7, email: "admin@example.test", openId: "pilot-primary" };
type Handler = (req: Request, res: Response) => Promise<void>;
const handlers = new Map<string, Handler>();
registerGoogleOAuthRoutes({ get: (path: string, handler: Handler) => handlers.set(path, handler) } as unknown as Express);

async function callback(state: string, cookie = state) {
  const res = { setHeader: vi.fn(), clearCookie: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn(), redirect: vi.fn() };
  await handlers.get("/api/google/oauth/callback")!({ query: { state, code: "test-code" }, headers: { cookie: `ufb_google_oauth_state=${encodeURIComponent(cookie)}` } } as unknown as Request, res as unknown as Response);
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.authenticate.mockResolvedValue(user);
  mock.scope.mockResolvedValue({ role: "PRIMARY_ADMIN" });
  mock.getToken.mockResolvedValue({ tokens: { id_token: "test-identity", refresh_token: "test-refresh", scope: "openid email https://www.googleapis.com/auth/gmail.send" } });
  mock.verify.mockResolvedValue({ getPayload: () => ({ email: "pilot@example.test", email_verified: true }) });
  vi.stubEnv("PUBLIC_APP_URL", "https://pilot.example.test"); vi.stubEnv("PUBLIC_API_URL", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-client"); vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-secret");
  vi.stubEnv("GMAIL_USER", "pilot@example.test"); vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "b".repeat(64));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("Google authorization for Agenda UFB", () => {
  it("binds an expiring state to the initiating administrator", () => {
    vi.useFakeTimers();
    const state = createGoogleState(user.openId);
    expect(validGoogleState(state, user.openId)).toBe(true);
    expect(validGoogleState(state, "another-admin")).toBe(false);
    expect(validGoogleState(`${state}tampered`, user.openId)).toBe(false);
    vi.advanceTimersByTime(600_001);
    expect(validGoogleState(state, user.openId)).toBe(false);
  });
  it("requires a matching browser state cookie before contacting Google", async () => {
    const res = await callback(createGoogleState(user.openId), "wrong-cookie");
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mock.getToken).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated callbacks", async () => {
    mock.authenticate.mockRejectedValue(new Error("not signed in"));
    expect((await callback(createGoogleState(user.openId))).status).toHaveBeenCalledWith(401);
    expect(mock.getToken).not.toHaveBeenCalled();
  });
  it("rejects department administrators", async () => {
    mock.scope.mockResolvedValue({ role: "ADMIN" });
    expect((await callback(createGoogleState(user.openId))).status).toHaveBeenCalledWith(403);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it.each([
    { email: "wrong@example.test", email_verified: true },
    { email: "pilot@example.test", email_verified: false },
  ])("refuses a mismatched or unverified Google mailbox", async (identity) => {
    mock.verify.mockResolvedValue({ getPayload: () => identity });
    expect((await callback(createGoogleState(user.openId))).status).toHaveBeenCalledWith(403);
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("verifies the identity token and saves only the configured account", async () => {
    const res = await callback(createGoogleState(user.openId));
    expect(mock.verify).toHaveBeenCalledWith({ idToken: "test-identity", audience: "test-client" });
    expect(mock.save).toHaveBeenCalledWith({ refreshToken: "test-refresh", mailboxEmail: "pilot@example.test", connectedBy: user.openId });
    expect(res.redirect).toHaveBeenCalledWith("https://pilot.example.test/admin/settings?google=connected");
  });
});
