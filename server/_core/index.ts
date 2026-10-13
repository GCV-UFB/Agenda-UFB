import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { createServer } from "http";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { createCorsMiddleware } from "./cors";
import { clearLegacySessionCookie } from "./cookies";
import { registerActionRoutes } from "../routes/actions";
import { registerGoogleOAuthRoutes } from "../routes/google-oauth";
import { registerScheduledRoutes } from "../routes/scheduled";

async function startServer() {
  const app = express();
  const server = createServer(app);
  app.use(createCorsMiddleware());
  app.use(clearLegacySessionCookie());
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerActionRoutes(app);
  registerGoogleOAuthRoutes(app);
  registerScheduledRoutes(app);
    app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ ok: true, service: "gcv-ufb-agenda", timestamp: Date.now() });
  });
  app.use("/api/trpc", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Vary", "Cookie, Authorization");
    next();
  });
  app.use("/api/trpc", createExpressMiddleware({ router: appRouter, createContext }));
  app.use("/api", (_req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.status(404).json({ error: "not_found" });
  });

  // Self-hosted Web/PWA build. API and frontend share one HTTPS origin.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const webDir = path.resolve(here, "web");
  if (fs.existsSync(webDir)) {
    app.use(express.static(webDir, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => {
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(webDir, "index.html"));
    });
  }
  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(port, "0.0.0.0", () => console.log(`[api] gcv server listening on ${port}`));
}

startServer().catch((error) => {
  console.error("[api] server failed to start", error);
  process.exitCode = 1;
});
