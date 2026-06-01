# CI4U Quality Gate

This project must be checked like a real user and a real production system after every meaningful change.

## Mandatory Rule

Every change must finish with verification. Do not stop after coding.

Minimum command gate:

```bash
npm run check:all
```

This runs:

- Frontend lint
- Frontend production build
- API typecheck
- API production build
- API tests
- Prisma schema validation

## UI Change Gate

For every UI change:

1. Run `npm run check:all`.
2. Start or confirm the API and web app are running.
3. Run `npm run smoke:web`.
4. Open `http://127.0.0.1:3000` or `http://127.0.0.1:3001`.
5. Check as a user:
   - Page loads.
   - Main screen is visible.
   - No obvious overlap.
   - Navigation surface is visible.
   - Important labels are readable.
   - Empty/loading/error states are considered where applicable.
   - Browser console has no errors when browser tooling is available.
6. Mention any browser tooling limitation clearly.

## Backend Change Gate

For every backend change:

1. Run `npm run check:all`.
2. Smoke test the relevant endpoint.
3. Verify both success and failure paths.
4. For lead/import work, always test:
   - Valid new phone.
   - Same phone in different format.
   - Invalid phone.
   - Missing required name.
   - Existing active duplicate.
   - Existing archived duplicate where applicable.
   - Raw/Warm Not Receiving ladder and final archive behavior.
   - Hot/Won contextual Not Receiving behavior: first 3 hours, then repeated 24-hour attempts.
   - Hot quotation validation and totals.
   - Site visit scheduled/completed/not-completed validation.
   - Won details required before a lead can enter Won Leads.
   - Lost summary required before a follow-up can enter Lost Leads.
5. Confirm critical writes are not frontend-only.

## Database Change Gate

For every schema/database change:

1. Run Prisma validation.
2. Confirm indexes and unique constraints match the workflow.
3. Confirm migrations are safe before applying them to a shared or production database.
4. Confirm archive/history behavior is preserved.
5. Confirm sensitive fields have a permission plan.
6. Confirm dev and production data scopes cannot affect each other's duplicate checks.

## Product Workflow Change Gate

Before changing workflow:

1. Read `docs/ci4u-master-workflow-roadmap.md`.
2. Read `docs/architecture-phase-1.md`.
3. Ask whether this is the correct next task.
4. Reject premature work when it jumps ahead of the roadmap.

## Final Response Requirement

Every completion report must include:

- What changed.
- What was tested.
- Whether full gate passed.
- Any limitation or risk.
- Next correct step.
