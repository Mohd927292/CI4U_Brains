import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const requiredRenderEnvKeys = [
  "NODE_ENV",
  "CI4U_REPOSITORY",
  "CI4U_DATA_SCOPE",
  "CI4U_AUTH_MODE",
  "CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION",
  "CI4U_WEB_ORIGINS",
  "DATABASE_URL",
];

if (process.argv.includes("--check-render-blueprint")) {
  checkRenderBlueprint();
  process.exit(0);
}

const result = validateRuntimeEnv(process.env);

if (!result.ok) {
  console.error(
    JSON.stringify(
      {
        status: "blocked",
        reason: "CI4U API production environment is not safe to start.",
        errors: result.errors,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      checked: result.checked,
    },
    null,
    2,
  ),
);

export function validateRuntimeEnv(env) {
  const errors = [];
  const checked = [];
  const nodeEnv = env.NODE_ENV ?? "development";
  const repository = env.CI4U_REPOSITORY ?? "memory";
  const authMode = env.CI4U_AUTH_MODE ?? "dev";
  const dataScope = env.CI4U_DATA_SCOPE;
  const databaseUrl = env.DATABASE_URL;
  const webOrigins = env.CI4U_WEB_ORIGINS;

  if (nodeEnv !== "production") {
    return {
      ok: true,
      checked: ["non-production runtime can use local defaults"],
      errors,
    };
  }

  checked.push("NODE_ENV=production");

  if (repository !== "prisma") {
    errors.push("NODE_ENV=production requires CI4U_REPOSITORY=prisma so data persists outside one process.");
  } else {
    checked.push("CI4U_REPOSITORY=prisma");
  }

  if (!databaseUrl || databaseUrl.includes("<") || databaseUrl.includes("localhost")) {
    errors.push("Production Prisma mode requires a real hosted DATABASE_URL. Do not use localhost or placeholder strings.");
  } else {
    checked.push("DATABASE_URL present");
  }

  if (dataScope !== "production" && dataScope !== "development") {
    errors.push("CI4U_DATA_SCOPE must be production or development.");
  } else {
    checked.push(`CI4U_DATA_SCOPE=${dataScope}`);
  }

  if (!webOrigins || webOrigins.includes("<") || !webOrigins.split(",").some((origin) => origin.trim().startsWith("https://"))) {
    errors.push("CI4U_WEB_ORIGINS must include the hosted HTTPS frontend origin.");
  } else {
    checked.push("CI4U_WEB_ORIGINS includes hosted origin");
  }

  if (authMode === "dev") {
    if (env.CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION !== "true") {
      errors.push("Dev auth in production runtime is blocked unless CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true is explicitly set for a demo.");
    }

    if (dataScope !== "development") {
      errors.push("Public demo dev auth must use CI4U_DATA_SCOPE=development. Do not mix demo auth with production data.");
    }

    checked.push("CI4U_AUTH_MODE=dev demo guard");
  } else if (authMode === "jwt") {
    if (!env.CI4U_AUTH_JWKS_URL || env.CI4U_AUTH_JWKS_URL.includes("<")) {
      errors.push("JWT auth requires CI4U_AUTH_JWKS_URL.");
    }

    if (!env.CI4U_AUTH_ISSUER || env.CI4U_AUTH_ISSUER.includes("<")) {
      errors.push("JWT auth requires CI4U_AUTH_ISSUER.");
    }

    checked.push("CI4U_AUTH_MODE=jwt");
  } else {
    errors.push("CI4U_AUTH_MODE must be dev or jwt.");
  }

  return {
    ok: errors.length === 0,
    checked,
    errors,
  };
}

function checkRenderBlueprint() {
  const renderPath = path.resolve("render.yaml");
  const packagePath = path.resolve("package.json");
  const errors = [];

  const renderYaml = fs.readFileSync(renderPath, "utf8");
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));

  if (packageJson.engines?.node !== "24.x") {
    errors.push("package.json should pin engines.node to 24.x for Render and Vercel consistency.");
  }

  if (!renderYaml.includes("node scripts/require-api-production-env.mjs")) {
    errors.push("render.yaml startCommand must run the production env guard before migrations/start.");
  }

  for (const key of requiredRenderEnvKeys) {
    if (!renderYaml.includes(`key: ${key}`)) {
      errors.push(`render.yaml is missing env var declaration for ${key}.`);
    }
  }

  if (!renderYaml.includes("healthCheckPath: /v1/health")) {
    errors.push("render.yaml must keep /v1/health as the API health check path.");
  }

  if (errors.length) {
    console.error(
      JSON.stringify(
        {
          status: "blocked",
          errors,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        checked: ["node engine", "render start guard", "render required env vars", "render health check"],
      },
      null,
      2,
    ),
  );
}
