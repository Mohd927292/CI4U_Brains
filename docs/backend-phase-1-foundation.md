# Backend Phase 1 Foundation

## What Exists Now

The backend foundation lives in `apps/api`.

Implemented:

- NestJS API shell
- Health endpoint
- Phase 1 PostgreSQL Prisma schema
- Prisma migration: `apps/api/prisma/migrations/202605281_backend_foundation/migration.sql`
- Current Prisma 7 config
- Indian mobile phone normalization
- Duplicate-safe manual lead intake domain service
- Import preview domain service
- Import commit domain service
- Raw, warm, hot installation, hot repair/service, unanswered, won, lost, and archive queue APIs
- Backend-owned call outcome workflow
- Lead Workflow V2 quotation snapshot and suggestion tables
- Lightweight won lead detail storage without premature job/vendor creation
- Prisma repository implementation behind `CI4U_REPOSITORY=prisma`
- Prisma client generated during API build/test/typecheck instead of relying on committed generated files
- In-memory development repository
- Data-scope isolation so development duplicate checks do not mix with production records
- Configurable local web origins through `CI4U_WEB_ORIGINS`
- Production JWT auth scaffold using JWKS, issuer validation, optional audience validation, and server-owned data scope
- API host binding on `0.0.0.0` for hosted Node services and controlled LAN testing
- Unit tests for phone normalization, duplicate prevention, archived duplicates, import preview, import commit, lead outcome movement, archive movement, quotation flow, won detail validation, Lost Leads, contextual Not Receiving scheduling, and data-scope isolation

## Current API Endpoints

Base URL in local development:

```txt
http://127.0.0.1:4000/v1
```

Endpoints:

- `GET /health`
- `GET /leads/counts`
- `GET /leads/raw`
- `GET /leads/queue/:queue`
- `GET /leads/:leadId`
- `POST /leads/manual`
- `POST /leads/import/preview`
- `POST /leads/import/commit`
- `POST /leads/:leadId/call-outcome`

Manual lead body:

```json
{
  "businessName": "ABC Enterprises",
  "phone": "98765 43210",
  "source": "MANUAL"
}
```

Import preview body:

```json
{
  "rows": [
    {
      "rowNumber": 1,
      "businessName": "ABC Enterprises",
      "phone": "98765 43210"
    }
  ]
}
```

## Important Limitation

The default repository adapter is still in-memory because this machine does not currently have PostgreSQL running. This is useful for domain testing and API shape verification only.

The Prisma repository and migration now exist, but they require a real PostgreSQL database before they can be honestly called persistence-tested.

Use:

```txt
CI4U_REPOSITORY=memory
```

for local UI/domain testing without a database.

Use:

```txt
CI4U_REPOSITORY=prisma
DATABASE_URL=postgresql://...
```

only after a Postgres instance exists and the migration is applied.

Next backend step:

1. Add a PostgreSQL local dev setup.
2. Apply the Prisma migration to a clean development database.
3. Run API integration tests against `CI4U_REPOSITORY=prisma`.
4. Add audit-log writes for lead outcome changes.
5. Add import batch persistence, not just import preview/commit return data.

## Why This Is Still Correct

The business logic is already shaped correctly:

- Phones normalize before any create.
- Existing phones return duplicate previews instead of creating new customers inside the same data scope.
- The same phone can exist separately in development and production scopes.
- Archived duplicates expose reactivation as an allowed action.
- Import preview distinguishes missing name, invalid phone, duplicate in file, existing active duplicate, existing archived duplicate, and completed duplicate.
- Call outcomes are backend-controlled and create timeline history.
- Raw and Warm Not Receiving follows the backend-owned escalation ladder: 3 hours, 24 hours, 72 hours, 1 week, 1 month, 3 months, then final archive.
- Hot and Won follow-up Not Receiving uses the V2 contextual schedule: first 3 hours, then repeated 24-hour attempts. It does not create a ghosting decision.
- Hot Quotation requires a quotation snapshot and updates company-wide item/package suggestions.
- Won requires mandatory lightweight won details and does not create job/vendor records yet.

The next risk is live database integration, audit logging, and role/permission authorization. Do not ship real CRM data until JWT auth is connected to a hosted auth provider and `users`/`roles`/`permissions` are enforced server-side.
