import { ONE_YEAR_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import {
  getAdminLoginRecord,
  getAdminScope,
  registerAdminLoginFailure,
  registerAdminLoginSuccess,
} from "../db";
import { getSessionCookieName, getSessionCookieOptions } from "./cookies";
import { verifyPassword } from "./password";
import { sdk } from "./sdk";

const INVALID_LOGIN_MESSAGE = "Adresse e-mail ou mot de passe incorrect.";

function userResponse(user: any) {
  return {
    id: user?.id ?? null,
    openId: user?.openId ?? null,
    name: user?.name ?? null,
    email: user?.email ?? null,
    loginMethod: user?.loginMethod ?? null,
    lastSignedIn: (user?.lastSignedIn ?? new Date()).toISOString(),
  };
}

export function registerOAuthRoutes(app: Express) {
  app.use("/api/auth", (_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const email =
        typeof req.body?.email === "string"
          ? req.body.email.trim().toLowerCase()
          : "";

      const password =
        typeof req.body?.password === "string"
          ? req.body.password
          : "";

      if (!email || !password) {
        res.status(401).json({ error: INVALID_LOGIN_MESSAGE });
        return;
      }

      const record = await getAdminLoginRecord(email);

      if (!record) {
        res.status(401).json({ error: INVALID_LOGIN_MESSAGE });
        return;
      }

      if (
        record.lockedUntil &&
        record.lockedUntil.getTime() > Date.now()
      ) {
        res.status(429).json({
          error:
            "Compte temporairement verrouillé. Veuillez réessayer dans quelques minutes.",
        });
        return;
      }

      const validPassword = await verifyPassword(
        password,
        record.passwordHash,
      );

      if (!validPassword) {
        const failure = await registerAdminLoginFailure(
          record.profileId,
          record.failedAttempts,
        );

        if (failure.locked) {
          res.status(429).json({
            error:
              "Compte temporairement verrouillé. Veuillez réessayer dans 15 minutes.",
          });
          return;
        }

        res.status(401).json({ error: INVALID_LOGIN_MESSAGE });
        return;
      }

      await registerAdminLoginSuccess(record.profileId);

      const token = await sdk.createSessionToken(record.openId, {
        name: record.name ?? "Agenda UFB",
        expiresInMs: ONE_YEAR_MS,
      });

      res.cookie(getSessionCookieName(req), token, {
        ...getSessionCookieOptions(req),
        maxAge: ONE_YEAR_MS,
      });

      res.setHeader("Cache-Control", "private, no-store");

      res.json({
        success: true,
        user: userResponse({
          id: record.userId,
          openId: record.openId,
          name: record.name,
          email: record.userEmail,
          loginMethod: "password",
          lastSignedIn: new Date(),
        }),
      });
    } catch (error) {
      console.error("[Auth] Admin login failed:", error);
      res.status(503).json({
        error: "Service d’authentification temporairement indisponible.",
      });
    }
  });

  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(getSessionCookieName(req), {
      ...getSessionCookieOptions(req),
      maxAge: -1,
    });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const scope = await getAdminScope(user.id, user.email);

      if (!scope) {
        res.status(403).json({
          error: "Accès administrateur non autorisé.",
          user: null,
        });
        return;
      }

      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        user: {
          ...userResponse(user),
          adminRole: scope.role,
        },
      });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });
}
