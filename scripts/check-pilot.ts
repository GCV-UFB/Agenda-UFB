import "dotenv/config";
import "../server/_core/env";
import fs from "node:fs";
import path from "node:path";
import { googleOAuthConfig } from "../server/services/google-config";

const root = process.cwd();
const checks: Record<string, boolean> = {};
const routes = ["index.html", "request.html", "admin/index.html", "admin/calendar.html", "admin/requests.html", "admin/settings.html", "privacy.html", "data-rights.html"];
checks.webRoutesBuilt = routes.every((route) => fs.existsSync(path.join(root, "dist/web", route)));
checks.serverBuilt = fs.existsSync(path.join(root, "dist/index.js"));
const dockerIgnore = fs.readFileSync(path.join(root, ".dockerignore"), "utf8");
checks.deploymentExcludesSecrets = [".env", ".env.*", ".git", "**/*.backup-*"].every((entry) => dockerIgnore.split(/\r?\n/).includes(entry));

function publicFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? publicFiles(file) : /\.(js|html|json)$/.test(entry.name) ? [file] : [];
  });
}
const secretValues = ["DATABASE_URL", "JWT_SECRET", "MANUS_JWT_SECRET", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_ENCRYPTION_KEY"]
  .map((key) => process.env[key]).filter((value): value is string => Boolean(value && value.length >= 12));
checks.publicBuildContainsNoConfiguredSecrets = publicFiles(path.join(root, "dist/web"))
  .every((file) => { const content = fs.readFileSync(file, "utf8"); return secretValues.every((secret) => !content.includes(secret)); });

const google = googleOAuthConfig();
const configuration = {
  databaseConfigured: Boolean(process.env.DATABASE_URL),
  sessionSecretConfigured: (process.env.JWT_SECRET || process.env.MANUS_JWT_SECRET || "").length >= 32,
  googleAuthorizationConfigured: google.configured,
  calendarEnabled: Boolean(process.env.GOOGLE_CALENDAR_ID?.trim()),
  isolatedTestDatabaseConfigured: Boolean(process.env.UFB_TEST_DATABASE_URL),
};
const report = { checkedAt: new Date().toISOString(), checks, configuration, buildReady: Object.values(checks).every(Boolean), note: "A successful build does not confirm Google consent, database isolation, mail delivery, or public deployment." };
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
fs.writeFileSync(path.join(root, "artifacts/pilot-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
if (!report.buildReady) process.exitCode = 1;
if (process.argv.includes("--require-integrations") && (!configuration.googleAuthorizationConfigured || !configuration.databaseConfigured || !configuration.sessionSecretConfigured)) process.exitCode = 2;
