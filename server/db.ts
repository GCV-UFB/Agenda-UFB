import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2";
import { adminCredentials, adminDepartments, adminProfiles, auditLog, InsertUser, users } from "../drizzle/schema";
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

export type AdminScope = {
  role: "PRIMARY_ADMIN" | "ADMIN" | "READ_ONLY";
  allDepartments: boolean;
  departmentIds: number[];
  canWrite: boolean;
};

export async function getAdminScope(
  userId: number,
  email: string | null | undefined,
): Promise<AdminScope | null> {
  const db = await getDb();
  if (!db || !email) return null;

  const profileRows = await db
    .select({
      id: adminProfiles.id,
      role: adminProfiles.role,
      email: adminProfiles.email,
    })
    .from(adminProfiles)
    .where(
      and(
        eq(adminProfiles.userId, userId),
        eq(adminProfiles.active, "YES"),
      ),
    )
    .limit(1);

  const profile = profileRows[0];

  if (
    !profile ||
    profile.email.trim().toLowerCase() !== email.trim().toLowerCase()
  ) {
    return null;
  }

  if (profile.role === "PRIMARY_ADMIN") {
    return {
      role: profile.role,
      allDepartments: true,
      departmentIds: [],
      canWrite: true,
    };
  }

  const assignments = await db
    .select({ departmentId: adminDepartments.departmentId })
    .from(adminDepartments)
    .where(eq(adminDepartments.adminProfileId, profile.id));

  return {
    role: profile.role,
    allDepartments: false,
    departmentIds: assignments.map((item) => item.departmentId),
    canWrite: profile.role === "ADMIN",
  };
}

export async function getAdminLoginRecord(email: string) {
  const db = await getDb();
  if (!db) return null;

  const normalizedEmail = email.trim().toLowerCase();

  const rows = await db
    .select({
      userId: users.id,
      openId: users.openId,
      name: users.name,
      userEmail: users.email,
      profileId: adminProfiles.id,
      profileEmail: adminProfiles.email,
      role: adminProfiles.role,
      active: adminProfiles.active,
      passwordHash: adminCredentials.passwordHash,
      failedAttempts: adminCredentials.failedAttempts,
      lockedUntil: adminCredentials.lockedUntil,
    })
    .from(adminProfiles)
    .innerJoin(users, eq(adminProfiles.userId, users.id))
    .innerJoin(
      adminCredentials,
      eq(adminCredentials.adminProfileId, adminProfiles.id),
    )
    .where(
      and(
        eq(adminProfiles.email, normalizedEmail),
        eq(adminProfiles.active, "YES"),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
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

const ADMIN_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_LOCK_MINUTES = 15;

export async function registerAdminLoginFailure(
  adminProfileId: number,
  currentFailedAttempts: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const nextFailedAttempts = currentFailedAttempts + 1;

  if (nextFailedAttempts >= ADMIN_MAX_FAILED_ATTEMPTS) {
    const lockedUntil = new Date(
      Date.now() + ADMIN_LOCK_MINUTES * 60 * 1000,
    );

    await db
      .update(adminCredentials)
      .set({
        failedAttempts: 0,
        lockedUntil,
        updatedAt: new Date(),
      })
      .where(eq(adminCredentials.adminProfileId, adminProfileId));

    return {
      locked: true,
      lockedUntil,
    };
  }

  await db
    .update(adminCredentials)
    .set({
      failedAttempts: nextFailedAttempts,
      updatedAt: new Date(),
    })
    .where(eq(adminCredentials.adminProfileId, adminProfileId));

  return {
    locked: false,
    lockedUntil: null,
  };
}

export async function registerAdminLoginSuccess(
  adminProfileId: number,
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  await db
    .update(adminCredentials)
    .set({
      failedAttempts: 0,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(adminCredentials.adminProfileId, adminProfileId));
}
