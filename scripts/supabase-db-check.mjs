import pg from "pg";
import { getSupabaseDatabaseUrl, getSupabaseSummary } from "./supabase-config.mjs";

const databaseUrl = getSupabaseDatabaseUrl();
const summary = getSupabaseSummary(databaseUrl);
const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
  const result = await client.query(`
    select
      current_database() as database,
      current_user as "user",
      inet_server_addr()::text as server_address,
      version() as version
  `);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        projectRef: summary.projectRef,
        connection: summary.maskedUrl,
        database: result.rows[0].database,
        user: result.rows[0].user,
        serverAddress: result.rows[0].server_address,
        version: result.rows[0].version,
      },
      null,
      2,
    ),
  );
} finally {
  await client.end().catch(() => undefined);
}
