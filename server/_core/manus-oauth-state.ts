import { randomBytes, timingSafeEqual } from "node:crypto";

export const MANUS_OAUTH_STATE_COOKIE = "gcv_manus_oauth_state";
export const MANUS_OAUTH_STATE_TTL_MS = 5 * 60 * 1000;

export type ManusOAuthState = {
  redirectUri: string;
  nonce: string;
};

export function createManusOAuthState(redirectUri: string): {
  state: string;
  nonce: string;
} {
  const nonce = randomBytes(32).toString("base64url");
  const payload: ManusOAuthState = { redirectUri, nonce };
  return {
    state: Buffer.from(JSON.stringify(payload), "utf8").toString("base64"),
    nonce,
  };
}

export function parseManusOAuthState(state: string): ManusOAuthState | null {
  try {
    const decoded = Buffer.from(state, "base64").toString("utf8");
    const payload: unknown = JSON.parse(decoded);
    if (!payload || typeof payload !== "object") return null;
    const candidate = payload as Record<string, unknown>;
    if (typeof candidate.redirectUri !== "string" || typeof candidate.nonce !== "string") {
      return null;
    }
    const redirect = new URL(candidate.redirectUri);
    if (redirect.protocol !== "https:" && redirect.protocol !== "http:") return null;
    if (!candidate.nonce || candidate.nonce.length > 256) return null;
    return { redirectUri: redirect.toString(), nonce: candidate.nonce };
  } catch {
    return null;
  }
}

export function matchesManusOAuthNonce(stateNonce: string, cookieNonce: string | undefined): boolean {
  if (!cookieNonce) return false;
  const stateBytes = Buffer.from(stateNonce, "utf8");
  const cookieBytes = Buffer.from(cookieNonce, "utf8");
  return stateBytes.length === cookieBytes.length && timingSafeEqual(stateBytes, cookieBytes);
}
