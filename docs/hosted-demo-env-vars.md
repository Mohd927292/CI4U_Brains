# Hosted Demo Environment Variables

Use this file as a copy checklist for Render and Vercel. Do not commit real secret values.

## Render API Service

Temporary deadline demo only:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
CI4U_WEB_ORIGINS=https://<vercel-domain>
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

Stop - this is not safe for real production customer, vendor, KYC, payment, or margin data because demo auth is still enabled.

Real production later:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_AUTH_JWKS_URL=https://<auth-provider>/.well-known/jwks.json
CI4U_AUTH_ISSUER=https://<auth-provider>
CI4U_AUTH_AUDIENCE=<audience-if-required>
CI4U_WEB_ORIGINS=https://<production-web-domain>
DATABASE_URL=postgresql://<production-db-url>
```

## Vercel Web App

```txt
NEXT_PUBLIC_CI4U_API_BASE_URL=https://<render-api>.onrender.com/v1
```

## Verification

```powershell
npm run check:all
npm run check:deployment

$env:CI4U_RENDER_API_URL="https://<render-api>.onrender.com"
$env:CI4U_VERCEL_WEB_URL="https://<vercel-domain>"
npm run check:hosted

$env:CI4U_SMOKE_API_BASE_URL="https://<render-api>.onrender.com/v1"
npm run smoke:api

$env:CI4U_SMOKE_WEB_URL="https://<vercel-domain>"
npm run smoke:web
```
