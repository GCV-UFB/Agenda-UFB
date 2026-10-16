import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { googleOAuthConfig } from "../server/services/google-config";

beforeEach(() => {
  vi.stubEnv("GOOGLE_CLIENT_ID", "pilot-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "test-only-secret");
  vi.stubEnv("GMAIL_USER", "pilot@example.test");
  vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  vi.stubEnv("PUBLIC_APP_URL", "https://pilot.example.test");
  vi.stubEnv("PUBLIC_API_URL", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Google configuration belongs to the UFB deployment", () => {
  it("uses this pilot's public callback", () => {
    expect(googleOAuthConfig()).toMatchObject({ configured: true, redirectUri: "https://pilot.example.test/api/google/oauth/callback" });
  });
  it("uses the configured separate API origin", () => {
    vi.stubEnv("PUBLIC_API_URL", "https://api.pilot.example.test");
    expect(googleOAuthConfig().redirectUri).toBe("https://api.pilot.example.test/api/google/oauth/callback");
  });
  it("never falls back to the old GCV deployment", () => {
    vi.stubEnv("PUBLIC_APP_URL", "");
    expect(googleOAuthConfig()).toMatchObject({ configured: false, redirectUri: null });
  });
  it.each(["http://pilot.example.test", "javascript:alert(1)", "https://user:password@example.test"])("rejects an unsafe origin: %s", (origin) => {
    vi.stubEnv("PUBLIC_APP_URL", origin);
    expect(googleOAuthConfig().configured).toBe(false);
  });
  it("permits loopback for local authorization", () => {
    vi.stubEnv("PUBLIC_APP_URL", "http://localhost:3000");
    expect(googleOAuthConfig().configured).toBe(true);
  });
  it.each(["", "short", "z".repeat(64)])("requires a usable encryption key", (key) => {
    vi.stubEnv("GOOGLE_TOKEN_ENCRYPTION_KEY", key);
    expect(googleOAuthConfig().configured).toBe(false);
  });
});
