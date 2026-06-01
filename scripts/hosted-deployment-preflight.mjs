import fs from "node:fs";
import process from "node:process";
import { execFileSync } from "node:child_process";

const checks = [];
const warnings = [];
const blockers = [];

checkFile("render.yaml", "Render blueprint");
checkFile("vercel.json", "Vercel project config");
checkFile(".github/workflows/ci.yml", "GitHub Actions quality gate");
checkFile("docs/run-on-other-devices.md", "multi-device runbook");
checkFile("docs/deployment-details-needed.md", "deployment details checklist");

const remotes = tryExec("git", ["remote", "-v"]);
if (!remotes.trim()) {
  blockers.push("Git remote is missing. Hosted deployment needs this repo pushed to GitHub first.");
} else {
  checks.push("Git remote configured");
}

const status = tryExec("git", ["status", "--short"]);
if (status.trim()) {
  warnings.push("Git worktree has uncommitted changes. Commit before deploying from GitHub.");
} else {
  checks.push("Git worktree clean");
}

if (!process.env.CI4U_RENDER_API_URL) {
  blockers.push("CI4U_RENDER_API_URL is missing. Vercel must point to the hosted API URL, not localhost.");
} else if (!process.env.CI4U_RENDER_API_URL.startsWith("https://")) {
  blockers.push("CI4U_RENDER_API_URL must be HTTPS.");
} else {
  checks.push("Hosted API URL provided");
}

if (!process.env.CI4U_VERCEL_WEB_URL) {
  warnings.push("CI4U_VERCEL_WEB_URL is not set yet. This is expected before the first Vercel deployment.");
} else if (!process.env.CI4U_VERCEL_WEB_URL.startsWith("https://")) {
  blockers.push("CI4U_VERCEL_WEB_URL must be HTTPS.");
} else {
  checks.push("Hosted web URL provided");
}

const result = {
  status: blockers.length ? "blocked" : "ok",
  checks,
  warnings,
  blockers,
  next: blockers.length
    ? "Provide the missing deployment details, then rerun npm run check:hosted."
    : "Proceed with hosted API smoke test, Vercel deploy, and hosted web smoke test.",
};

console.log(JSON.stringify(result, null, 2));
process.exit(blockers.length ? 1 : 0);

function checkFile(filePath, label) {
  if (fs.existsSync(filePath)) {
    checks.push(`${label} exists`);
    return;
  }

  blockers.push(`${label} is missing: ${filePath}`);
}

function tryExec(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" });
  } catch {
    return "";
  }
}
