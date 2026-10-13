import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import { adminProfiles, auditLog, InsertUser, users } from "../drizzle/schema";
import { ADMIN_EMAIL } from "../shared/gcv";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const parsed = new URL(process.env.DATABASE_URL);
      const pool = mysql.createPool({
        host: parsed.hostname,
        port: Number(parsed.port || 3306),
        user: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
        database: parsed.pathname.replace(/^\//, ""),
        ssl: {},
      });
      _db = drizzle(pool);
    } catch {
      console.warn("[Database] Failed to connect");
      _db = null;
    }
  }
  return _db;
}

function isPrimaryAdmin(email: string | null | undefined) {
  return email?.trim().toLowerCase() === ADMIN_EMAIL;
}

export async function getAdminProfileRole(userId: number, email: string | null | undefined): Promise<"PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY" | null> {
  const db = await getDb();
  if (!db || !email) return null;
  const rows = await db.select({ role: adminProfiles.role, email: adminProfiles.email })
    .from(adminProfiles)
    .where(and(eq(adminProfiles.userId, userId), eq(adminProfiles.active, "YES")))
    .limit(1);
  return rows[0]?.email.trim().toLowerCase() === email.trim().toLowerCase() ? rows[0]?.role ?? null : null;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const existing = await getUserByOpenId(user.openId);
  const effectiveEmail = user.email !== undefined ? user.email : existing?.email;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    const value = user[field];
    if (value !== undefined) {
      values[field] = value ?? null;
      updateSet[field] = value ?? null;
    }
  }

  // The primary admin is identified by the authorized email only. The Manus owner ID
  // alone is never sufficient to grant application access.
  const role = isPrimaryAdmin(effectiveEmail) ? "admin" : "user";
  values.role = role;
  updateSet.role = role;
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });

  const saved = await getUserByOpenId(user.openId);
  if (saved && isPrimaryAdmin(saved.email)) {
    await db
      .insert(adminProfiles)
      .values({ userId: saved.id, email: ADMIN_EMAIL, role: "PRIMARY_ADMIN", active: "YES" })
      .onDuplicateKeyUpdate({ set: { email: ADMIN_EMAIL, role: "PRIMARY_ADMIN", active: "YES", updatedAt: new Date() } });
  }

  if (saved && await getAdminProfileRole(saved.id, saved.email)) {
    await db.insert(auditLog).values({
      action: "ADMIN_LOGIN",
      entityType: "admin",
      entityId: String(saved.id),
      actor: saved.email ?? null,
      details: JSON.stringify({ method: saved.loginMethod ?? null }),
    });
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
