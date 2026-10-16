import { describe, it, expect, vi } from "vitest";
vi.mock("../server/_core/env", () => ({ ENV: { cookieSecret: "test-only-secret-with-more-than-32-characters", appId: "ufb-test", oAuthServerUrl: "" } }));
import { sdk } from "../server/_core/sdk";
import { SESSION_COOKIE_SUFFIX } from "../shared/const";

describe("Sessions cannot cross between GCV and UFB", () => {
  it("uses a separate UFB cookie namespace", () => {
    expect(SESSION_COOKIE_SUFFIX).toContain("ufb");
    expect(SESSION_COOKIE_SUFFIX).not.toBe("040120187494442");
  });
  it("rejects a correctly signed token belonging to another application", async () => {
    const token = await sdk.signSession({ openId: "test-admin", name: "Test", appId: "old-gcv" });
    expect(await sdk.verifySession(token)).toBeNull();
  });
  it("accepts a valid UFB session", async () => {
    const token = await sdk.createSessionToken("test-admin", { name: "Test" });
    expect(await sdk.verifySession(token)).toMatchObject({ openId: "test-admin", appId: "ufb-test" });
  });
  it("rejects an expired session", async () => {
    const token = await sdk.createSessionToken("test-admin", { name: "Test", expiresInMs: -1_000 });
    expect(await sdk.verifySession(token)).toBeNull();
  });
});
