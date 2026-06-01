import { spawn } from "node:child_process";
import { getSupabaseDatabaseUrl, getSupabaseSummary } from "./supabase-config.mjs";

const command = process.argv.slice(2);

if (command.length === 0) {
  throw new Error("Usage: node scripts/with-supabase-db.mjs <command...>");
}

const databaseUrl = getSupabaseDatabaseUrl();
const summary = getSupabaseSummary(databaseUrl);

console.log(`Using Supabase database: ${summary.maskedUrl}`);

const child = spawn(command.join(" "), {
  shell: true,
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    CI4U_REPOSITORY: process.env.CI4U_REPOSITORY ?? "prisma",
    CI4U_AUTH_MODE: process.env.CI4U_AUTH_MODE ?? "dev",
    CI4U_DATA_SCOPE: process.env.CI4U_DATA_SCOPE ?? "development",
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
