# CI4U Deployment Readiness Status

Date checked: 2026-06-01

## Current Status

The Supabase database is connected and migrated. The app is not deployed yet.

Verified:

- Supabase project `CI4U` exists.
- Supabase project ref: `klvtjuejpogylqkkdkqx`.
- Supabase region: `ap-southeast-1`.
- Supabase status: `ACTIVE_HEALTHY`.
- Public schema now has the CI4U CRM tables.
- Prisma migration history exists in `_prisma_migrations`.
- Applied Prisma migrations:
  - `202605281_backend_foundation`
  - `202606011_lead_workflow_v2`
  - `202606012_supabase_public_lockdown`
  - `202606013_supabase_advisor_hardening`
- Local API health endpoint works.
- Local API smoke test passes.
- API smoke test against Supabase Postgres passes.
- Local web smoke test passes through headless Chrome.
- In-app browser check passes with no console errors or hydration warnings.
- Full local quality gate passes.
- Supabase security advisor no longer reports the public `_prisma_migrations` RLS error.
- Supabase performance advisor no longer reports unindexed foreign keys.

## Important Rule

Do not apply schema through random SQL and then also run Prisma migrations later. That creates migration-history drift.

Correct production-grade path, already used for the first migration:

1. Use the Supabase session pooler database URL.
2. Run `npm run supabase:migrate` with the real database password.
3. Let Prisma create and track `_prisma_migrations`.
4. Deploy the API with the same migration strategy.

The database password is not stored in this repo. Since it was shared in chat for setup, rotate it after deployment.

## Required Secrets

For the temporary deadline demo API:

```txt
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
CI4U_WEB_ORIGINS=https://<vercel-domain>
```

For real production data, dev auth is not allowed:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_AUTH_JWKS_URL=https://<auth-provider>/.well-known/jwks.json
CI4U_AUTH_ISSUER=https://<auth-provider>
CI4U_WEB_ORIGINS=https://<production-web-domain>
DATABASE_URL=postgresql://...
```

## Deployment Order

1. Push this repo to GitHub.
2. Create a Render web service from the repo root using `render.yaml`.
3. Set Render secrets.
4. Run/deploy Render API and confirm `/v1/health`.
5. Smoke test hosted API:

```powershell
$env:CI4U_SMOKE_API_BASE_URL="https://<render-api>.onrender.com/v1"
npm run smoke:api
```

6. Deploy frontend to Vercel.
7. Set Vercel env:

```txt
NEXT_PUBLIC_CI4U_API_BASE_URL=https://<render-api>.onrender.com/v1
```

8. Add the Vercel domain to `CI4U_WEB_ORIGINS` in Render.
9. Smoke test hosted web:

```powershell
$env:CI4U_SMOKE_WEB_URL="https://<vercel-domain>"
npm run smoke:web
```

## Current Hosted Deployment Blockers

- Render deployment has not been created yet.
- The hosted Render API URL is not available yet.
- Vercel deployment must wait until the Render API URL exists, otherwise the frontend would point to localhost or a missing backend.
- After Vercel deploys, Render `CI4U_WEB_ORIGINS` must be updated to the final Vercel domain.

## Current Residual Risk

`npm audit` still reports three moderate findings through Prisma CLI's transitive `@hono/node-server` dependency. The app does not expose that package as CI4U's web server; CI4U serves through NestJS. npm's suggested fix is a major Prisma downgrade, so it is not safe to apply blindly. Recheck after Prisma publishes a patched dependency path.

Supabase still reports `RLS Enabled No Policy` info notices. This is intentional for now: the public tables are locked down from direct browser access and the CI4U API connects server-side. Do not add broad `anon` or `authenticated` policies just to silence the info notices.

Supabase also reports unused indexes because the database is new and has almost no real workload yet. Do not remove those indexes now; many are deliberate CRM query and foreign-key protection indexes.
