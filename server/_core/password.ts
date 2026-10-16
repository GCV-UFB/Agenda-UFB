import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const FORMAT = "scrypt-v1";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error("Le mot de passe doit contenir au moins 12 caractères.");
  }

  const salt = randomBytes(SALT_LENGTH);
  const derivedKey = (await scrypt(
    password,
    salt,
    KEY_LENGTH,
  )) as Buffer;

  return [
    FORMAT,
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    const [format, saltBase64, hashBase64] = storedHash.split("$");

    if (
      format !== FORMAT ||
      !saltBase64 ||
      !hashBase64
    ) {
      return false;
    }

    const salt = Buffer.from(saltBase64, "base64");
    const expectedHash = Buffer.from(hashBase64, "base64");

    if (salt.length !== SALT_LENGTH || expectedHash.length !== KEY_LENGTH) {
      return false;
    }

    const actualHash = (await scrypt(
      password,
      salt,
      expectedHash.length,
    )) as Buffer;

    return (
      actualHash.length === expectedHash.length &&
      timingSafeEqual(actualHash, expectedHash)
    );
  } catch {
    return false;
  }
}
