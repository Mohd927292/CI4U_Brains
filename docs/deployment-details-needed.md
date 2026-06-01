# Deployment Details Needed

## Short Answer

The laptop does not need to stay on after real hosted deployment.

- Same Wi-Fi test mode: laptop must stay on.
- Render + Vercel hosted mode: laptop can be off.

## Details Needed From You

Current external deployment state:

```txt
GitHub repo is available: https://github.com/Mohd927292/CI4U_Brains
Render API/service URL is missing.
Vercel can be configured, but should not be deployed until the hosted API exists.
```

### 1. GitHub

Provide one of these:

- A GitHub repo URL where this project should be pushed, and confirm this PC is already logged in to Git.
- Or create an empty repo and send the HTTPS URL.
- Or provide a GitHub token with repo write access. This is less preferred; if shared, rotate it afterward.

Recommended repo name:

```txt
ci4u-brains
```

GitHub target:

```txt
Account: Mohd927292
Repository: Mohd927292/CI4U_Brains
Default branch: main
```

### 2. Render

Provide one of these:

- Render API key, if you want me to create/manage the Render service programmatically.
- Or confirm you will create the Render Blueprint manually from the GitHub repo.

Render API key location:

```txt
Render Dashboard -> Account Settings -> API Keys
```

If shared in chat, rotate it after deployment.

Important: Render's normal Git-backed deployment needs the code in GitHub/GitLab/Bitbucket first. Without a Git remote, the professional path is blocked.

After the repo is pushed, create a Render Blueprint from:

```txt
https://github.com/Mohd927292/CI4U_Brains
```

The included `render.yaml` already uses the free plan.

### 3. Render Service Choice

For deadline demo, confirm:

```txt
Render plan: free
Auth mode: temporary dev auth
Data scope: development
```

Stop - do not use real production customer/vendor/KYC/payment data with dev auth.

### 4. Vercel

Vercel team detected:

```txt
mohd927292's projects
team_6qCSYp6A7rNz3prsHy4WxJmu
```

Confirm whether to deploy the CI4U Brains web app into this Vercel team.

Important: deploy the web only after Render gives an API URL. The frontend environment must use:

```txt
NEXT_PUBLIC_CI4U_API_BASE_URL=https://<render-api>.onrender.com/v1
```

Never deploy the public web app with `http://127.0.0.1` as its API base URL.

### 5. Hosted URLs After Creation

When Render is created, provide or let me detect:

```txt
https://<render-api>.onrender.com
```

Then Vercel must receive:

```txt
NEXT_PUBLIC_CI4U_API_BASE_URL=https://<render-api>.onrender.com/v1
```

When Vercel is created, Render must receive:

```txt
CI4U_WEB_ORIGINS=https://<vercel-domain>
```

## Exact Demo Render Environment

Use this only for demo/testing:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
CI4U_WEB_ORIGINS=https://<vercel-domain>
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

## Exact Production Render Environment

Use this only after real auth is ready:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_AUTH_JWKS_URL=https://<auth-provider>/.well-known/jwks.json
CI4U_AUTH_ISSUER=https://<auth-provider>
CI4U_AUTH_AUDIENCE=
CI4U_WEB_ORIGINS=https://<production-web-domain>
DATABASE_URL=postgresql://...
```

## Deployment Gate

Before and after deployment:

```powershell
npm run check:all
npm run check:deployment
npm run check:hosted
```

After hosted API exists:

```powershell
$env:CI4U_SMOKE_API_BASE_URL="https://<render-api>.onrender.com/v1"
npm run smoke:api
```

After hosted web exists:

```powershell
$env:CI4U_SMOKE_WEB_URL="https://<vercel-domain>"
npm run smoke:web
```
