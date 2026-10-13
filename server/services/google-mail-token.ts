import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { googleMailConnections } from "../../drizzle/schema";
import { getDb } from "../db";

const CONNECTION_ID = 1;
const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();

  if (!raw) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY não configurada.");
  }

  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(
      "GOOGLE_TOKEN_ENCRYPTION_KEY deve conter exatamente 64 caracteres hexadecimais.",
    );
  }

  return Buffer.from(raw, "hex");
}

function encryptToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);

  const encrypted = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

function decryptToken(payload: string): string {
  const [version, ivEncoded, authTagEncoded, encryptedEncoded] =
    payload.split(".");

  if (version !== "v1" || !ivEncoded || !authTagEncoded || !encryptedEncoded) {
    throw new Error("Refresh token Google armazenado em formato inválido.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivEncoded, "base64url"),
  );

  decipher.setAuthTag(Buffer.from(authTagEncoded, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedEncoded, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

async function requireDb() {
  const db = await getDb();

  if (!db) {
    throw new Error("Base de dados indisponível.");
  }

  return db;
}

export async function saveGoogleRefreshToken(input: {
  refreshToken: string;
  mailboxEmail: string;
  connectedBy: string;
}) {
  const db = await requireDb();

  const refreshTokenEncrypted = encryptToken(input.refreshToken);

  await db
    .insert(googleMailConnections)
    .values({
      id: CONNECTION_ID,
      mailboxEmail: input.mailboxEmail.trim().toLowerCase(),
      refreshTokenEncrypted,
      connectedBy: input.connectedBy.trim(),
    })
    .onDuplicateKeyUpdate({
      set: {
        mailboxEmail: input.mailboxEmail.trim().toLowerCase(),
        refreshTokenEncrypted,
        connectedBy: input.connectedBy.trim(),
        updatedAt: new Date(),
      },
    });
}

export async function getGoogleRefreshToken(): Promise<string | null> {
  const db = await requireDb();

  const rows = await db
    .select({
      refreshTokenEncrypted: googleMailConnections.refreshTokenEncrypted,
    })
    .from(googleMailConnections)
    .where(eq(googleMailConnections.id, CONNECTION_ID))
    .limit(1);

  const row = rows[0];

  if (!row) {
    return null;
  }

  return decryptToken(row.refreshTokenEncrypted);
}

export async function googleTokenStatus() {
  const db = await requireDb();

  const rows = await db
    .select({
      mailboxEmail: googleMailConnections.mailboxEmail,
      connectedAt: googleMailConnections.connectedAt,
      updatedAt: googleMailConnections.updatedAt,
    })
    .from(googleMailConnections)
    .where(eq(googleMailConnections.id, CONNECTION_ID))
    .limit(1);

  const row = rows[0];

  return {
    configured: Boolean(row),
    mailboxEmail: row?.mailboxEmail ?? null,
    connectedAt: row?.connectedAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}
