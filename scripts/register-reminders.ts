import "dotenv/config";
import { eq } from "drizzle-orm";
import { scheduledJobs } from "../drizzle/schema";
import { getDb } from "../server/db";

async function main() {
  const taskUid = process.argv[2]?.trim();
  if (!taskUid || taskUid.length > 160 || /\s/.test(taskUid)) {
    throw new Error("Usage: pnpm tsx scripts/register-reminders.ts <taskUid returned by manus-heartbeat>");
  }
  const db = await getDb();
  if (!db) throw new Error("Managed database is unavailable.");
  await db.insert(scheduledJobs).values({ jobKey: "reminders", taskUid, active: "YES" })
    .onDuplicateKeyUpdate({ set: { taskUid, active: "YES", updatedAt: new Date() } });
  console.log("Reminder schedule identity registered.");
  const client = (db as unknown as { $client?: { end?: () => Promise<void> } }).$client;
  await client?.end?.();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Could not register the reminder schedule.");
  process.exitCode = 1;
});
