// https://docs.expo.dev/guides/using-eslint/
import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

export default defineConfig([
  expoConfig,
  {
    ignores: ["dist/**", "backup_gcv_migrations/**"],
  },
  { files: ["server/**/*.{ts,js}", "scripts/**/*.{ts,js}", "tests/**/*.ts"], rules: { "expo/no-dynamic-env-var": "off" } },
]);
