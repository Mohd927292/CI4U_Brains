# CI4U Brains

CI4U Brains is the CRM and operations control app for CI4U. The current implementation includes the Next.js web UI, NestJS API, Prisma schema, raw lead intake, duplicate phone protection, guided lead outcome workflow, quotation snapshots, and lightweight won lead details.

## Local Development

Install dependencies:

```bash
npm install
```

Start API in development memory mode:

```powershell
$env:CI4U_AUTH_MODE="dev"
$env:CI4U_REPOSITORY="memory"
$env:CI4U_DATA_SCOPE="development"
npm run dev:api
```

Start web:

```powershell
$env:NEXT_PUBLIC_CI4U_API_BASE_URL="http://127.0.0.1:4000/v1"
npm run dev:web
```

Open:

```txt
http://127.0.0.1:3000
```

If port `3000` is busy:

```bash
npm run dev:web -- -p 3001
```

## Quality Gate

Run the full gate after meaningful changes:

```bash
npm run check:all
```

This runs frontend lint/build, API typecheck/build/tests, and Prisma schema validation.

## Live API Smoke Test

With the API running:

```bash
npm run smoke:api
```

For hosted API:

```powershell
$env:CI4U_SMOKE_API_BASE_URL="https://<your-api-host>/v1"
npm run smoke:api
```

## Live Web Smoke Test

With the web and API running:

```bash
npm run smoke:web
```

For hosted web:

```powershell
$env:CI4U_SMOKE_WEB_URL="https://<your-vercel-domain>"
npm run smoke:web
```

## Multi-Device Deployment

Read the deployment plan before exposing the app:

- [Production Backend Access Plan](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/production-backend-access-plan.md)
- [Supabase Connection](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/supabase-connection.md)
- [Deployment Readiness Status](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/deployment-readiness-status.md)
- [Run On Other Devices](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/run-on-other-devices.md)
- [Deployment Details Needed](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/deployment-details-needed.md)
- [Hosted Demo Env Vars](C:/Users/Akhtar/Documents/Codex/2026-05-27/files-mentioned-by-the-user-ui/ci4u-brains/docs/hosted-demo-env-vars.md)

The short version:

- Web: Vercel
- API: Render
- Database: Supabase Postgres
- ORM/migrations: Prisma
- Temporary public demo auth: dev auth with `development` data only
- Real production auth: JWT/OIDC plus database roles and permissions

Supabase quick check:

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<paste-password-here>"
npm run supabase:check
npm run supabase:migrate
```

## Warning

Do not enter real customer, vendor, KYC, payment, or company financial data while `CI4U_AUTH_MODE=dev`. Dev auth is only for controlled testing and deadline demos.
