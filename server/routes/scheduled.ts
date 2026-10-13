import { and, eq } from "drizzle-orm";
import type { Express, Request, Response } from "express";
import { scheduledJobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { sdk } from "../_core/sdk";
import { runReminders } from "../services/gcv";

export function registerScheduledRoutes(app: Express) {
  app.post("/api/scheduled/reminders", async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "private, no-store");
    let user;
    try {
      user = await sdk.authenticateRequest(req);
    } catch {
      res.status(401).json({ error: "invalid_scheduled_identity" });
      return;
    }
    if (!user.isCron || !user.taskUid || !user.openId.startsWith("cron_")) {
      res.status(403).json({ error: "scheduled_identity_required" });
      return;
    }

    try {
      const db = await getDb();
      if (!db) {
        res.status(503).json({ error: "database_unavailable" });
        return;
      }
      const job = (await db.select({ id: scheduledJobs.id }).from(scheduledJobs).where(and(
        eq(scheduledJobs.jobKey, "reminders"),
        eq(scheduledJobs.taskUid, user.taskUid),
        eq(scheduledJobs.active, "YES"),
      )).limit(1))[0];
      if (!job) {
        res.status(404).json({ error: "scheduled_job_not_registered" });
        return;
      }

      const result = await runReminders();
      res.status(200).json({ ok: true, ...result });
    } catch (error) {
      console.error("[scheduled] reminder run failed", error);
      res.status(500).json({ error: "scheduled_work_failed" });
    }
  });
}
