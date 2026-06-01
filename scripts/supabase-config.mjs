const defaultConfig = {
  projectRef: "klvtjuejpogylqkkdkqx",
  host: "aws-1-ap-southeast-1.pooler.supabase.com",
  port: "5432",
  database: "postgres",
  user: "postgres.klvtjuejpogylqkkdkqx",
};

export function getSupabaseDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const password = process.env.CI4U_SUPABASE_DB_PASSWORD;

  if (!password) {
    throw new Error(
      "Missing Supabase password. Set CI4U_SUPABASE_DB_PASSWORD, or set DATABASE_URL directly. Do not commit the password.",
    );
  }

  const user = encodeURIComponent(process.env.CI4U_SUPABASE_DB_USER ?? defaultConfig.user);
  const encodedPassword = encodeURIComponent(password);
  const host = process.env.CI4U_SUPABASE_DB_HOST ?? defaultConfig.host;
  const port = process.env.CI4U_SUPABASE_DB_PORT ?? defaultConfig.port;
  const database = process.env.CI4U_SUPABASE_DB_NAME ?? defaultConfig.database;

  return `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}?sslmode=require&uselibpqcompat=true`;
}

export function maskDatabaseUrl(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);

    if (parsed.password) {
      parsed.password = "****";
    }

    return parsed.toString();
  } catch {
    return databaseUrl.replace(/:\/\/([^:\s]+):([^@\s]+)@/, "://$1:****@");
  }
}

export function getSupabaseSummary(databaseUrl = getSupabaseDatabaseUrl()) {
  const parsed = new URL(databaseUrl);

  return {
    projectRef: defaultConfig.projectRef,
    host: parsed.hostname,
    port: parsed.port || "5432",
    database: parsed.pathname.replace(/^\//, ""),
    user: decodeURIComponent(parsed.username),
    maskedUrl: maskDatabaseUrl(databaseUrl),
  };
}
