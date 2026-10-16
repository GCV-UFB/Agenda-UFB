import * as Linking from "expo-linking";
import Constants from "expo-constants";
import * as ReactNative from "react-native";

// Extract scheme from bundle ID (last segment timestamp, prefixed with "manus")
// e.g., "space.manus.my.app.t20240115103045" -> "manus20240115103045"
const bundleId = "org.adventiste.ufb.agenda.t20261015";
const timestamp = bundleId.split(".").pop()?.replace(/^t/, "") ?? "";
const schemeFromBundleId = `manus${timestamp}`;

const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string | undefined>;

const env = {
  portal: extra.oauthPortalUrl ?? process.env.EXPO_PUBLIC_OAUTH_PORTAL_URL ?? "",
  server: extra.oauthServerUrl ?? process.env.EXPO_PUBLIC_OAUTH_SERVER_URL ?? "",
  appId: extra.appId ?? process.env.EXPO_PUBLIC_APP_ID ?? "",
  ownerId: process.env.EXPO_PUBLIC_OWNER_OPEN_ID ?? "",
  ownerName: process.env.EXPO_PUBLIC_OWNER_NAME ?? "",
  apiBaseUrl: extra.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  deepLinkScheme: schemeFromBundleId,
};

export const OAUTH_PORTAL_URL = env.portal;
export const OAUTH_SERVER_URL = env.server;
export const APP_ID = env.appId;
export const OWNER_OPEN_ID = env.ownerId;
export const OWNER_NAME = env.ownerName;
export const API_BASE_URL = env.apiBaseUrl;

/**
 * Get the API base URL, deriving from current hostname if not set.
 * Metro runs on 8081, API server runs on 3000.
 * URL pattern: https://PORT-sandboxid.region.domain
 */
export function getApiBaseUrl(): string {
  // Keep published Web requests same-origin. Only the numbered sandbox Preview host
  // should point at the separate 3000 endpoint, and native builds use their configured URL.
  if (ReactNative.Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { protocol, hostname, port } = window.location;
    if ((hostname === "localhost" || hostname === "127.0.0.1") && port === "8081") {
      return `${protocol}//${hostname}:3000`;
    }
    if (/^\d+-[a-z0-9-]+(?:\.[a-z0-9]+)?\.manus\.computer$/i.test(hostname)) {
      if (API_BASE_URL) return API_BASE_URL.replace(/\/$/, "");
      return `${protocol}//${hostname.replace(/^\d+-/, "3000-")}`;
    }
    if (API_BASE_URL && !API_BASE_URL.includes(".manus.computer")) {
      return API_BASE_URL.replace(/\/$/, "");
    }
    return "";
  }

  return API_BASE_URL.replace(/\/$/, "");
}

export const SESSION_TOKEN_KEY = "ufb-session-token";
export const USER_INFO_KEY = "ufb-user-info";

const encodeState = (value: string) => {
  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(value);
  }
  const BufferImpl = (globalThis as Record<string, any>).Buffer;
  if (BufferImpl) {
    return BufferImpl.from(value, "utf-8").toString("base64");
  }
  return value;
};

/**
 * Get the redirect URI for OAuth callback.
 * - Web: uses API server callback endpoint
 * - Native: uses deep link scheme
 */
export const getRedirectUri = () => {
  if (ReactNative.Platform.OS === "web") {
    const apiBaseUrl = getApiBaseUrl();
    const browserOrigin =
      typeof window !== "undefined" && window.location ? window.location.origin : "";
    const origin = apiBaseUrl || browserOrigin;
    if (!origin) throw new Error("The public OAuth callback origin is unavailable");
    return new URL("/api/oauth/callback", origin).toString();
  } else {
    return Linking.createURL("/oauth/callback", {
      scheme: env.deepLinkScheme,
    });
  }
};

export const getLoginUrl = () => {
  if (!OAUTH_PORTAL_URL || !APP_ID) {
    throw new Error("Manus login configuration is unavailable");
  }
  const redirectUri = getRedirectUri();
  const state = encodeState(redirectUri);

  const url = new URL(`${OAUTH_PORTAL_URL}/app-auth`);
  url.searchParams.set("appId", APP_ID);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};

/**
 * Start OAuth login flow.
 *
 * On native platforms (iOS/Android), open the system browser directly so
 * the OAuth callback returns via deep link to the app.
 *
 * On web, this simply redirects to the login URL.
 *
 * @returns Always null, the callback is handled via deep link.
 */
export async function startOAuthLogin(): Promise<string | null> {
  if (ReactNative.Platform.OS === "web") {
    if (typeof window !== "undefined") {
      const apiBaseUrl = getApiBaseUrl();
      const startUrl = apiBaseUrl ? `${apiBaseUrl}/api/oauth/start` : "/api/oauth/start";
      const response = await fetch(startUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const result = (await response.json().catch(() => ({}))) as {
        authorizationUrl?: string;
        error?: string;
      };
      if (!response.ok || !result.authorizationUrl) {
        throw new Error(result.error || "Unable to start Manus sign-in");
      }
      window.location.assign(result.authorizationUrl);
    }
    return null;
  }

  const loginUrl = getLoginUrl();
  const supported = await Linking.canOpenURL(loginUrl);
  if (!supported) {
    console.warn("[OAuth] Cannot open login URL: URL scheme not supported");
    // 可考虑抛出错误或返回错误状态，让调用方处理
    return null;
  }

  try {
    await Linking.openURL(loginUrl);
  } catch {
    console.error("[OAuth] Failed to open login URL");
    // 可考虑抛出错误让调用方处理
  }

  // The OAuth callback will reopen the app via deep link.
  return null;
}
