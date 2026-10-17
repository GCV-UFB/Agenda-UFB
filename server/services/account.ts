import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { adminCredentials, adminProfiles, auditLog } from "../../drizzle/schema";
import { getDb } from "../db";
import { hashPassword, verifyPassword } from "../_core/password";

/** The caller supplies the verified session user ID, never a target profile ID. */
export async function changeOwnPassword(input: { userId: number; currentPassword: string; newPassword: string }) {
  if (!input.currentPassword || input.currentPassword.length > 200 || input.newPassword.length < 12 || input.newPassword.length > 200) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Le nouveau mot de passe doit contenir entre 12 et 200 caractères." });
  }
  const db = await getDb();
  if (!db) throw new Error("La base de données n’est pas disponible.");

  const result = await db.transaction(async (tx) => {
    const account = (await tx.select({
      profileId: adminProfiles.id,
      email: adminProfiles.email,
      passwordHash: adminCredentials.passwordHash,
      failedAttempts: adminCredentials.failedAttempts,
      lockedUntil: adminCredentials.lockedUntil,
    }).from(adminProfiles)
      .innerJoin(adminCredentials, eq(adminCredentials.adminProfileId, adminProfiles.id))
      .where(and(eq(adminProfiles.userId, input.userId), eq(adminProfiles.active, "YES")))
      .limit(1).for("update"))[0];

    if (!account) throw new TRPCError({ code: "FORBIDDEN", message: "Votre compte n’est plus actif ou ses identifiants sont indisponibles." });
    if (account.lockedUntil && account.lockedUntil.getTime() > Date.now()) return "LOCKED" as const;

    if (!await verifyPassword(input.currentPassword, account.passwordHash)) {
      const attempts = account.failedAttempts + 1;
      const locked = attempts >= 5;
      await tx.update(adminCredentials).set({
        failedAttempts: locked ? 0 : attempts,
        lockedUntil: locked ? new Date(Date.now() + 15 * 60 * 1000) : null,
      }).where(eq(adminCredentials.adminProfileId, account.profileId));
      // Commit the failed-attempt counter before reporting the error.
      return locked ? "LOCKED" as const : "INVALID" as const;
    }
    if (await verifyPassword(input.newPassword, account.passwordHash)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Choisissez un nouveau mot de passe différent du mot de passe actuel." });
    }

    const passwordHash = await hashPassword(input.newPassword);
    await tx.update(adminCredentials).set({
      passwordHash,
      passwordChangedAt: new Date(),
      failedAttempts: 0,
      lockedUntil: null,
    }).where(eq(adminCredentials.adminProfileId, account.profileId));
    await tx.insert(auditLog).values({
      action: "ADMIN_PASSWORD_CHANGED",
      entityType: "admin",
      entityId: String(account.profileId),
      actor: account.email,
      details: null,
    });
    return "SUCCESS" as const;
  });

  if (result === "LOCKED") throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Compte temporairement verrouillé. Veuillez réessayer dans 15 minutes." });
  if (result === "INVALID") throw new TRPCError({ code: "BAD_REQUEST", message: "Le mot de passe actuel est incorrect." });
  return { success: true as const };
}
