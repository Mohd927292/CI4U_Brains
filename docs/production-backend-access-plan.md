# CI4U Database, Server, And Multi-Device Access Plan

## CTO Decision

Stop - using this PC as the real backend is wrong because it makes CI4U depend on one laptop, one internet connection, and one local process. That is acceptable for development demos only. It is not acceptable for staff, managers, or vendors using the system from many devices.

The correct deadline path is:

- CI4U Brains frontend: Vercel-hosted Next.js web app
- CI4U API: Render-hosted NestJS web service
- Database: Supabase-hosted PostgreSQL
- ORM/migrations: Prisma
- Auth for temporary demo: dev auth with `development` data scope only, explicitly enabled
- Auth for real production: JWT/OIDC auth before entering real customer data

## What Was Verified From Official Docs

- Supabase Prisma docs describe using a Supavisor session pooler connection string ending in port `5432` for Prisma app/migration use, and transaction mode `6543` for serverless/autoscaling environments.
- Render Node docs confirm Node web services can be deployed with custom build/start commands and receive a public `onrender.com` URL after deploy.
- Render health-check docs confirm HTTP health checks pass on `2xx` or `3xx` responses and can be configured with a path such as `/v1/health`.
- Next.js/Vercel docs confirm environment variables are separated by environment and browser-exposed variables need the `NEXT_PUBLIC_` prefix.

Official sources used:

- `https://supabase.com/docs/guides/database/prisma`
- `https://render.com/docs/deploy-node-express-app`
- `https://render.com/docs/health-checks`
- `https://nextjs.org/docs/app/guides/environment-variables`
- `https://vercel.com/docs/environment-variables`

## Current Repo Readiness

Implemented:

- API can run on `0.0.0.0`, so hosted services and LAN devices can reach it.
- API health endpoint: `GET /v1/health`.
- Prisma schema and migrations exist.
- API repository can switch between `memory` and `prisma`.
- Root script `npm run prisma:migrate:deploy` applies database migrations.
- Root script `npm run smoke:api` tests the live HTTP API.
- Root script `npm run supabase:check` verifies the configured Supabase database connection.
- Root script `npm run supabase:migrate` applies migrations using the configured Supabase database.
- Root script `npm run supabase:api` starts the API against Supabase Postgres.
- `render.yaml` defines a Render web service for the API.
- Root `.env.example` defines the frontend API URL variable.
- API `.env.example` defines database/auth/server variables.

Not complete:

- A real hosted PostgreSQL database has not been connected from this machine.
- The Prisma repository has not yet been smoke-tested against a live hosted database.
- Production JWT auth is scaffolded, but real users/roles/permissions are not wired enough for real company data.
- File storage for KYC/photos/PDFs is not implemented yet.

## Emergency Demo Deployment

This is allowed only for deadline demo data. Do not enter real customer/vendor/KYC/payment data in this mode.

### 1. Create Supabase Postgres

Supabase project details currently captured:

```txt
project_ref=klvtjuejpogylqkkdkqx
host=aws-1-ap-southeast-1.pooler.supabase.com
port=5432
database=postgres
user=postgres.klvtjuejpogylqkkdkqx
```

The database password is intentionally not stored in the repo.

Use the Supavisor session pooler connection string for this Render API:

```txt
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

Use a dedicated Prisma/database user if possible. Do not commit this value.

Recommended setup:

1. First connect using the project `postgres` user.
2. Run [supabase-prisma-role.sql](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/supabase-prisma-role.sql) in Supabase SQL Editor with a generated password.
3. Switch Render `DATABASE_URL` to `prisma.klvtjuejpogylqkkdkqx`.

Local check:

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
npm run supabase:check
```

Apply migrations:

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
npm run supabase:migrate
```

### 2. Deploy API On Render

Use the included `render.yaml` or manually create a Render Web Service. The committed blueprint is production-safe by default: it requires you to set auth, data scope, origins, and database URL in Render instead of silently launching with public dev auth.

Build command:

```bash
npm ci && npm run build:api
```

Start command:

```bash
npm run prisma:migrate:deploy && npm run start:api
```

Health check path:

```txt
/v1/health
```

Production API env:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_AUTH_JWKS_URL=https://<auth-project>/.well-known/jwks.json
CI4U_AUTH_ISSUER=https://<auth-project>
CI4U_AUTH_AUDIENCE=<auth-audience-if-used>
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
CI4U_WEB_ORIGINS=https://<your-vercel-domain>
```

The migration `202606012_supabase_public_lockdown` enables RLS and revokes direct `anon`/`authenticated` access on CI4U CRM tables. This is intentional: all CRM writes must go through the NestJS API.

Temporary demo API env, only if real auth is not ready:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
CI4U_WEB_ORIGINS=https://<your-vercel-domain>
```

Why `CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true` exists:

- It makes the risk explicit.
- The API will refuse public production runtime with dev auth unless this is intentionally set.
- Remove it when switching to JWT auth.

### 3. Deploy Web On Vercel

Vercel project root:

```txt
ci4u-brains repo root
```

Build command:

```bash
npm run build
```

Frontend env:

```txt
NEXT_PUBLIC_CI4U_API_BASE_URL=https://<your-render-api>.onrender.com/v1
```

After Vercel gives a domain, add it to Render:

```txt
CI4U_WEB_ORIGINS=https://<your-vercel-domain>
```

Then redeploy/restart the API.

### 4. Smoke Test Hosted API

From local terminal:

```bash
$env:CI4U_SMOKE_API_BASE_URL="https://<your-render-api>.onrender.com/v1"
npm run smoke:api
```

Expected result:

```json
{
  "status": "ok",
  "checked": ["health", "dev auth isolation", "raw create", "warm", "quotation", "won details"]
}
```

### 5. Manual Device Test

Open the Vercel URL from:

- Your laptop
- Your phone on mobile data
- Another phone
- Another browser profile

Verify:

- Dev login opens.
- Raw lead can be created.
- Duplicate phone is blocked.
- Lead detail opens.
- Warm update saves.
- Quotation update saves.
- Won details save.
- Refreshing the page does not lose data.

## Local LAN Testing

This is not "anywhere"; it is only devices on the same Wi-Fi.

1. Find this computer's LAN IP:

```powershell
ipconfig
```

2. Start API:

```powershell
$env:CI4U_AUTH_MODE="dev"
$env:CI4U_REPOSITORY="memory"
$env:CI4U_DATA_SCOPE="development"
$env:CI4U_WEB_ORIGINS="http://<LAN-IP>:3001,http://127.0.0.1:3001"
npm run dev:api
```

3. Start web:

```powershell
$env:NEXT_PUBLIC_CI4U_API_BASE_URL="http://<LAN-IP>:4000/v1"
npm run dev:web:lan
```

4. Open from phone:

```txt
http://<LAN-IP>:3001
```

Windows Firewall may need to allow inbound ports `3001` and `4000`.

## Real Production Requirements

Before real data:

- Set `CI4U_AUTH_MODE=jwt`.
- Remove `CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION`.
- Use `CI4U_DATA_SCOPE=production`.
- Connect a real auth provider with JWKS.
- Map JWT users to database users.
- Enforce role/permission checks server-side.
- Add audit logs for every critical action.
- Add database backup/export policy.

API production env:

```txt
NODE_ENV=production
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_AUTH_JWKS_URL=https://<auth-project>/.well-known/jwks.json
CI4U_AUTH_ISSUER=https://<auth-project>
CI4U_AUTH_AUDIENCE=
CI4U_AUTH_ROLE_CLAIM=app_metadata.ci4u_role
CI4U_REPOSITORY=prisma
DATABASE_URL=postgresql://...
CI4U_WEB_ORIGINS=https://brains.ci4u.example
```

## Hard Rule

Do not use the temporary dev-auth public deployment for real CI4U operations. It is only a deadline demo environment until production auth and permission enforcement are completed.
