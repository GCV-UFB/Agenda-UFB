import { google } from "googleapis";

import { ADMIN_EMAIL } from "../../shared/gcv";
import { getGoogleRefreshToken, googleTokenStatus } from "./google-mail-token";

const REDIRECT_URI =
  "https://gcv-ufb-agenda.onrender.com/api/google/oauth/callback";

function gmailConfig() {
  const user = process.env.GMAIL_USER?.trim();
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

  return {
    user,
    clientId,
    clientSecret,
    configured: Boolean(user && clientId && clientSecret),
  };
}

function encodeHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeMessage(message: string) {
  return Buffer.from(message, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function gmailConnectionStatus() {
  const config = gmailConfig();
  const tokenStatus = await googleTokenStatus();

  return {
    configured: config.configured && tokenStatus.configured,
    connected: config.configured && tokenStatus.configured,
    email: tokenStatus.mailboxEmail ?? config.user ?? ADMIN_EMAIL,
  };
}

export async function sendGmailMail(input: {
  to: string;
  subject: string;
  html: string;
}) {
  const config = gmailConfig();

  if (!config.user || !config.clientId || !config.clientSecret) {
    throw new Error(
      "Gmail API não configurada. Verifique GMAIL_USER, GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.",
    );
  }

  const refreshToken = await getGoogleRefreshToken();

  if (!refreshToken) {
    throw new Error(
      "Conta Google ainda não autorizada. Conecte o Gmail pelo fluxo OAuth.",
    );
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    REDIRECT_URI,
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  const gmail = google.gmail({
    version: "v1",
    auth: oauth2Client,
  });

  const message = [
    `From: "GCV-UFB" <${config.user}>`,
    `To: ${input.to}`,
    `Reply-To: ${ADMIN_EMAIL}`,
    `Subject: ${encodeHeader(input.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    input.html,
  ].join("\r\n");

  const raw = encodeMessage(message);

  await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw,
    },
  });
}
