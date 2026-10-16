/** Configuration belongs to this deployment; never fall back to the old GCV host. */
export function googleOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "";
  const mailbox = process.env.GMAIL_USER?.trim().toLowerCase() ?? "";
  const base = process.env.PUBLIC_API_URL || process.env.PUBLIC_APP_URL;
  let redirectUri: string | null = null;
  try {
    if (base) {
      const url = new URL(base);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if ((url.protocol === "https:" || (local && url.protocol === "http:")) && !url.username && !url.password) {
        redirectUri = new URL("/api/google/oauth/callback", url.origin).toString();
      }
    }
  } catch { /* Unconfigured until a valid deployment URL is supplied. */ }
  const encryptionReady = /^[0-9a-f]{64}$/i.test(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim() ?? "");
  return {
    clientId, clientSecret, mailbox, redirectUri,
    configured: Boolean(clientId && clientSecret && redirectUri && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox) && encryptionReady),
  };
}
