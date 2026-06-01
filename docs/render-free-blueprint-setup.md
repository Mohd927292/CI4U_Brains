# Render Free Blueprint Setup

Use this only for the deadline demo. This keeps the API hosted so the laptop can be turned off.

## Source

```txt
GitHub repo: https://github.com/Mohd927292/CI4U_Brains
Branch: main
Blueprint file: render.yaml
Service name: ci4u-brains-api
Plan: free
```

## Create The Service

1. Open Render Dashboard.
2. Create a new Blueprint.
3. Connect GitHub repository `Mohd927292/CI4U_Brains`.
4. Select branch `main`.
5. Render should detect `render.yaml`.
6. Confirm the free plan service `ci4u-brains-api`.

## Required Environment Variables

Set these in Render before the first deploy:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
CI4U_WEB_ORIGINS=https://<vercel-domain-after-web-deploy>
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

Temporary first deploy option:

```txt
CI4U_WEB_ORIGINS=https://placeholder.invalid
```

After Vercel deploys, replace it with the real Vercel domain and redeploy/restart the Render service.

## Expected Render URL

Render often uses a URL like:

```txt
https://ci4u-brains-api.onrender.com
```

Do not assume this until Render confirms it. If the URL is different, use the exact Render URL in Vercel.

## Test After Render Deploy

```powershell
$env:CI4U_SMOKE_API_BASE_URL="https://<render-api>.onrender.com/v1"
npm run smoke:api
```

Expected:

```txt
status: ok
checked: health, dev auth isolation, raw create, warm, quotation, won details
```

## Important Production Warning

Stop - this demo setup uses dev auth. Do not enter real customer, vendor, KYC, payment, or company margin data until proper JWT auth and role permissions are enabled.
