import type { Express, Request, Response } from "express";
import { google } from "googleapis";
import { parse } from "cookie";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sdk } from "../_core/sdk";
import { ENV } from "../_core/env";
import { getAdminScope } from "../db";
import { saveGoogleRefreshToken } from "../services/google-mail-token";
import { googleOAuthConfig } from "../services/google-config";

const STATE_COOKIE = "ufb_google_oauth_state";
const STATE_PATH = "/api/google/oauth";

async function primaryAdmin(req: Request) {
  const user = await sdk.authenticateRequest(req);
  const scope = await getAdminScope(user.id, user.email);
  return scope?.role === "PRIMARY_ADMIN" ? user : null;
}

function stateSignature(value: string) {
  if (ENV.cookieSecret.length < 32) throw new Error("Configuration de session indisponible.");
  return createHmac("sha256", ENV.cookieSecret).update(`ufb-google-oauth:${value}`).digest("base64url");
}

export function createGoogleState(actor: string) {
  const payload = Buffer.from(JSON.stringify({ actor, nonce: randomBytes(32).toString("hex"), expires: Date.now() + 600_000 })).toString("base64url");
  return `${payload}.${stateSignature(payload)}`;
}

export function validGoogleState(state: string, actor: string) {
  try {
    const [payload, signature, extra] = state.split(".");
    if (!payload || !signature || extra) return false;
    const expected = Buffer.from(stateSignature(payload));
    const actual = Buffer.from(signature);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    return data.actor === actor && typeof data.expires === "number" && data.expires > Date.now();
  } catch { return false; }
}

export function registerGoogleOAuthRoutes(app: Express) {
  app.get("/api/google/oauth/start", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    let user;
    try { user = await primaryAdmin(req); } catch { res.status(401).send("Connexion administrateur requise."); return; }
    if (!user) { res.status(403).send("Accès réservé à l’administrateur principal."); return; }
    const config = googleOAuthConfig();
    if (!config.configured) { res.status(503).send("Configurez l’adresse publique et le service Google de cette Agenda UFB."); return; }
    try {
      const oauth = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri!);
      const state = createGoogleState(user.openId);
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true, secure: config.redirectUri!.startsWith("https:"), sameSite: "lax", path: STATE_PATH, maxAge: 600_000,
      });
      res.redirect(oauth.generateAuthUrl({
        access_type: "offline", prompt: "consent", login_hint: config.mailbox,
        scope: ["openid", "email", "https://www.googleapis.com/auth/gmail.send", ...(process.env.GOOGLE_CALENDAR_ID ? ["https://www.googleapis.com/auth/calendar.events"] : [])],
        state,
      }));
    } catch {
      res.status(503).send("L’autorisation Google n’a pas pu être démarrée.");
    }
  });

  app.get("/api/google/oauth/callback", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    let user;
    try { user = await primaryAdmin(req); } catch { res.status(401).send("Reconnectez-vous à l’administration avant d’autoriser Google."); return; }
    if (!user) { res.status(403).send("Accès réservé à l’administrateur principal."); return; }
    const config = googleOAuthConfig();
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const expected = parse(req.headers.cookie ?? "")[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE, { httpOnly: true, secure: config.redirectUri?.startsWith("https:"), sameSite: "lax", path: STATE_PATH });
    if (!state || state !== expected || !validGoogleState(state, user.openId)) {
      res.status(400).send("Autorisation invalide ou expirée. Recommencez depuis les réglages."); return;
    }
    if (req.query.error) { res.status(400).send("Autorisation Google annulée. Vous pouvez recommencer depuis les réglages."); return; }
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code || !config.configured) { res.status(400).send("Configuration ou code d’autorisation manquant."); return; }
    try {
      const oauth = new google.auth.OAuth2(config.clientId, config.clientSecret, config.redirectUri!);
      const { tokens } = await oauth.getToken(code);
      if (!tokens.id_token || !tokens.refresh_token || !tokens.scope?.split(" ").includes("https://www.googleapis.com/auth/gmail.send")) {
        res.status(400).send("Google n’a pas fourni les jetons nécessaires. Recommencez l’autorisation avec consentement."); return;
      }
      const identity = (await oauth.verifyIdToken({ idToken: tokens.id_token, audience: config.clientId })).getPayload();
      if (!identity?.email_verified || identity.email?.toLowerCase() !== config.mailbox) {
        res.status(403).send("Le compte Google autorisé ne correspond pas au compte d’envoi configuré."); return;
      }
      await saveGoogleRefreshToken({ refreshToken: tokens.refresh_token, mailboxEmail: identity.email.toLowerCase(), connectedBy: user.openId });
      res.redirect(new URL("/admin/settings?google=connected", process.env.PUBLIC_APP_URL || config.redirectUri!).toString());
    } catch {
      // Google client errors can contain authorization codes or credentials: never log them.
      res.status(503).send("L’autorisation Google a échoué. Recommencez depuis les réglages.");
    }
  });
}
