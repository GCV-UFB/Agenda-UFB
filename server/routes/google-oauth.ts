import type { Express, Request, Response } from "express";
import { google } from "googleapis";
import { sdk } from "../_core/sdk";
import { saveGoogleRefreshToken } from "../services/google-mail-token";
import { randomBytes } from "node:crypto";

const REDIRECT_URI =
  "https://gcv-ufb-agenda.onrender.com/api/google/oauth/callback";

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_CLIENT_ID ou GOOGLE_CLIENT_SECRET não configurado.",
    );
  }

  return new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
}

export function registerGoogleOAuthRoutes(app: Express) {
  app.get("/api/google/oauth/start", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);

      if (user.openId !== "gcv-primary-admin") {
        res.status(403).send("Acesso não autorizado.");
        return;
      }
      const oauth2Client = getOAuthClient();

      const state = randomBytes(32).toString("hex");

      res.cookie("google_oauth_state", state, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        maxAge: 10 * 60 * 1000,
      });

      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/calendar.events",
        ],
        state,
      });

      res.redirect(url);
    } catch (error) {
      console.error("[Google OAuth] start failed", error);
      res.status(500).send("Google OAuth não configurado.");
    }
  });

  app.get("/api/google/oauth/callback", async (req: Request, res: Response) => {
    try {
      const code = typeof req.query.code === "string" ? req.query.code : "";

      if (!code) {
        res.status(400).send("Código de autorização ausente.");
        return;
      }

      const returnedState =
        typeof req.query.state === "string" ? req.query.state : "";

      const cookieHeader = req.headers.cookie ?? "";

      const expectedState =
        cookieHeader
          .split(";")
          .map((cookie) => cookie.trim())
          .find((cookie) => cookie.startsWith("google_oauth_state="))
          ?.slice("google_oauth_state=".length) ?? "";

      if (!returnedState || !expectedState || returnedState !== expectedState) {
        res.status(400).send("Estado OAuth inválido ou expirado.");
        return;
      }

      res.clearCookie("google_oauth_state", {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
      });
      const oauth2Client = getOAuthClient();
      const { tokens } = await oauth2Client.getToken(code);

      if (!tokens.refresh_token) {
        res
          .status(400)
          .send(
            "Google não retornou refresh_token. Revogue o acesso anterior e autorize novamente.",
          );
        return;
      }
      const mailboxEmail = process.env.GMAIL_USER?.trim().toLowerCase();

      if (!mailboxEmail) {
        throw new Error("GMAIL_USER não configurado.");
      }

      await saveGoogleRefreshToken({
        refreshToken: tokens.refresh_token,
        mailboxEmail,
        connectedBy: "gcv-primary-admin",
      });
      console.log(
        "[Google OAuth] autorização concluída; refresh token recebido.",
      );

      res.status(200).type("html").send(`
            <!doctype html>
            <html lang="pt-BR">
              <head>
                <meta charset="utf-8">
                <title>Google autorizado</title>
              </head>
              <body style="font-family:Arial,sans-serif;padding:40px">
                <h1>Google autorizado com sucesso</h1>
                <p>O refresh token foi recebido pelo servidor.</p>
                <p>Você pode fechar esta página.</p>
              </body>
            </html>
          `);
    } catch (error) {
      console.error("[Google OAuth] callback failed", error);
      res.status(500).send("Falha na autorização Google.");
    }
  });
}
