# Run CI4U Brains On Other Devices

## The Honest Difference

There are two different meanings of "other devices":

- Same Wi-Fi/LAN: your laptop runs the web app and API. Other phones/computers on the same network can open it.
- Anywhere in the world: the API must be hosted on Render and the web app must be hosted on Vercel.

Stop - using only your PC is not a real production setup. It is fine for testing on your phone today, but if the PC sleeps, loses internet, or the terminal closes, other devices stop working.

## Same Wi-Fi Test Mode

Use this only for quick staff/demo testing.

### 1. Find Your Laptop IP

```powershell
ipconfig
```

Look for the active Wi-Fi IPv4 address, for example:

```txt
192.168.1.23
```

In the commands below, replace `<LAN-IP>` with that value.

### 2. Build API Once

```powershell
npm run build:api
```

### 3. Start API Against Supabase

```powershell
$env:CI4U_SUPABASE_DB_PASSWORD="<supabase-db-password>"
$env:PORT="4000"
$env:CI4U_WEB_ORIGINS="http://<LAN-IP>:3001,http://127.0.0.1:3001,http://localhost:3001"
npm run supabase:api
```

Keep this terminal open.

### 4. Start Web On LAN

Open a second terminal:

```powershell
$env:NEXT_PUBLIC_CI4U_API_BASE_URL="http://<LAN-IP>:4000/v1"
npm run dev:web:lan
```

Keep this terminal open.

### 5. Open From Other Devices

From a phone or another computer on the same Wi-Fi:

```txt
http://<LAN-IP>:3001
```

If it does not open, Windows Firewall is probably blocking port `3001` or `4000`.

## Anywhere Access

This is the correct setup for real use:

- Supabase: database
- Render: NestJS API
- Vercel: Next.js web app

### 1. Push To GitHub

The project must be in a GitHub repo before normal Render/Vercel deployment.

### 2. Deploy API On Render

Use the repo root and `render.yaml`.

Set Render environment variables:

```txt
NODE_ENV=production
CI4U_REPOSITORY=prisma
CI4U_AUTH_MODE=dev
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=true
CI4U_DATA_SCOPE=development
CI4U_WEB_ORIGINS=https://<vercel-domain>
DATABASE_URL=postgresql://postgres.klvtjuejpogylqkkdkqx:<PASSWORD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require&uselibpqcompat=true
```

This is demo mode only. Do not enter real production customer/vendor/KYC/payment data with dev auth.

After Render deploys, test:

```powershell
$env:CI4U_SMOKE_API_BASE_URL="https://<render-api>.onrender.com/v1"
npm run smoke:api
```

### 3. Deploy Web On Vercel

Set Vercel environment variable:

```txt
NEXT_PUBLIC_CI4U_API_BASE_URL=https://<render-api>.onrender.com/v1
```

After Vercel deploys, update Render:

```txt
CI4U_WEB_ORIGINS=https://<vercel-domain>
```

Then test:

```powershell
$env:CI4U_SMOKE_WEB_URL="https://<vercel-domain>"
npm run smoke:web
```

## Before Real Production Data

Switch away from demo auth:

```txt
CI4U_AUTH_MODE=jwt
CI4U_DATA_SCOPE=production
CI4U_ALLOW_DEV_AUTH_IN_PRODUCTION=false
```

Real production also needs:

- Proper user login provider.
- Role and permission enforcement.
- Audit-log completion.
- File storage rules for KYC/photos.
- Password rotation because the database password was shared during setup.
