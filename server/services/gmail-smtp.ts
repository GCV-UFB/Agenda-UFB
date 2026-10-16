import { google } from "googleapis";

import { ADMIN_EMAIL } from "../../shared/gcv";
import { getGoogleRefreshToken, googleTokenStatus } from "./google-mail-token";

import { googleOAuthConfig } from "./google-config";

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
  const config = googleOAuthConfig();
  const tokenStatus = await googleTokenStatus();

  return {
    authorizationReady: config.configured,
    redirectUri: config.redirectUri,
    configured: config.configured,
    connected: config.configured && tokenStatus.configured && tokenStatus.mailboxEmail?.toLowerCase() === config.mailbox,
    email: config.mailbox || ADMIN_EMAIL,
  };
}

export async function sendGmailMail(input: {
  to: string;
  subject: string;
  html: string;
}) {
  const config = googleOAuthConfig();

  const status = await gmailConnectionStatus();
  if (!config.configured || !status.connected) {
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
    config.redirectUri!,
  );

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
  });

  const gmail = google.gmail({
    version: "v1",
    auth: oauth2Client,
  });

  const message = [
    `From: "Agenda UFB" <${config.mailbox}>`,
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
