# Supabase Connection

## Project

```txt
project_ref=klvtjuejpogylqkkdkqx
host=aws-1-ap-southeast-1.pooler.supabase.com
port=5432
database=postgres
user=postgres.klvtjuejpogylqkkdkqx
```

## Password Rule

Do not commit the database password. Prefer setting it locally as an environment variable:

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
```

The repo scripts build this connection string automatically:

```txt
postgresql://postgres.klvtjuejpogylqkkdkqx:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

## Recommended Prisma Database User

For production-grade setup, do not run the API forever as the project `postgres` user. Supabase recommends a custom Prisma role for Prisma applications.

Use this template in the Supabase SQL Editor:

- [supabase-prisma-role.sql](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/supabase-prisma-role.sql)

After creating the role, use this user in the connection string:

```txt
prisma.klvtjuejpogylqkkdkqx
```

Then set:

```powershell
$env:CI4U_SUPABASE_DB_USER="prisma.klvtjuejpogylqkkdkqx"
$env:CI4U_SUPABASE_DB_PASSWORD="<prisma-role-password>"
```

This role intentionally uses `bypassrls` because the NestJS API is the trusted server boundary. Browser users must never receive this connection string.

## Check Database Connection

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
npm run supabase:check
```

Expected:

```json
{
  "status": "ok"
}
```

## Apply Prisma Migrations

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
npm run supabase:migrate
```

This runs:

```bash
npm run prisma:migrate:deploy
```

with `DATABASE_URL` set to the Supabase pooler URL.

## Start API Against Supabase

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
$env:CI4U_WEB_ORIGINS="http://127.0.0.1:3001,http://localhost:3001"
npm run supabase:api
```

Then smoke test:

```powershell
npm run smoke:api
```

## Hosted Render Environment

For Render, set `DATABASE_URL` directly instead of `CI4U_SUPABASE_DB_PASSWORD`:

```txt
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_AUTH_JWKS_URL=https://<auth-project>/.well-known/jwks.json
CI4U_AUTH_ISSUER=https://<auth-project>
CI4U_AUTH_AUDIENCE=<auth-audience-if-used>
CI4U_WEB_ORIGINS=https://<your-vercel-domain>
```

For a temporary deadline demo only, you can intentionally use:

```txt
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
CI4U_WEB_ORIGINS=https://<your-vercel-domain>
```

This is still demo auth. Do not use it for real production data.

## Supabase Public Schema Lockdown

The migration `202606012_supabase_public_lockdown` enables RLS and revokes `anon`/`authenticated` direct table access for CI4U CRM tables. This keeps browser users from bypassing the NestJS API through Supabase's generated Data API.

The API database user must have server-side privileges. Browser users should call CI4U API endpoints only.
