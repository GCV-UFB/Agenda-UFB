import { timingSafeEqual } from "crypto";
import { ONE_YEAR_MS } from "../../shared/const.js";
import { ADMIN_EMAIL } from "../../shared/gcv.js";
import type { Express, Request, Response } from "express";
import { getUserByOpenId, upsertUser } from "../db";
import { getSessionCookieName, getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

const ADMIN_OPEN_ID = "gcv-primary-admin";

function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function userResponse(user: any) {
  return {
    id: user?.id ?? null, openId: user?.openId ?? null, name: user?.name ?? null,
    email: user?.email ?? null, loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

export function registerOAuthRoutes(app: Express) {
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const configured = process.env.ADMIN_PASSWORD || "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (configured.length < 12) {
      res.status(503).json({ error: "ADMIN_PASSWORD doit contenir au moins 12 caractères." });
      return;
    }
    if (!safeEqual(password, configured)) {
      res.status(401).json({ error: "Mot de passe incorrect." });
      return;
    }
    const now = new Date();
    await upsertUser({ openId: ADMIN_OPEN_ID, name: "GCV-UFB", email: ADMIN_EMAIL, loginMethod: "password", lastSignedIn: now });
    const user = await getUserByOpenId(ADMIN_OPEN_ID);
    if (!user) { res.status(503).json({ error: "Base de données indisponible." }); return; }
    const token = await sdk.createSessionToken(ADMIN_OPEN_ID, { name: "GCV-UFB", expiresInMs: ONE_YEAR_MS });
    res.cookie(getSessionCookieName(req), token, { ...getSessionCookieOptions(req), maxAge: ONE_YEAR_MS });
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ success: true, user: userResponse(user) });
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(getSessionCookieName(req), { ...getSessionCookieOptions(req), maxAge: -1 });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.setHeader("Cache-Control", "private, no-store");
      res.json({ user: userResponse(user) });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });
}
