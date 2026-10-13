import { describe, expect, it } from "vitest";
import {
  createManusOAuthState,
  matchesManusOAuthNonce,
  parseManusOAuthState,
} from "../server/_core/manus-oauth-state";

describe("Manus OAuth Web state", () => {
  it("encodes an absolute callback and a per-attempt nonce in the documented state format", () => {
    const redirectUri = "https://gcvagenda-zwszekmw.manus.space/api/oauth/callback";
    const result = createManusOAuthState(redirectUri);

    expect(parseManusOAuthState(result.state)).toEqual({
      redirectUri,
      nonce: result.nonce,
    });
    expect(result.nonce).toHaveLength(43);
  });

  it("rejects a relative callback or a state without a nonce", () => {
    const relative = Buffer.from(
      JSON.stringify({ redirectUri: "/api/oauth/callback", nonce: "nonce" }),
    ).toString("base64");
    const missingNonce = Buffer.from(
      JSON.stringify({ redirectUri: "https://example.test/api/oauth/callback" }),
    ).toString("base64");

    expect(parseManusOAuthState(relative)).toBeNull();
    expect(parseManusOAuthState(missingNonce)).toBeNull();
  });

  it("matches the callback nonce to the HttpOnly cookie value and rejects missing or changed values", () => {
    expect(matchesManusOAuthNonce("same-nonce", "same-nonce")).toBe(true);
    expect(matchesManusOAuthNonce("state-nonce", "different-nonce")).toBe(false);
    expect(matchesManusOAuthNonce("state-nonce", undefined)).toBe(false);
  });
});
