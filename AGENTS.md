<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## CI4U Project Control

Before changing product workflow, database shape, permissions, vendor/customer visibility, import behavior, archive behavior, or dashboard meaning, read:

- `docs/ci4u-master-workflow-roadmap.md`
- `docs/architecture-phase-1.md`
- `docs/lead-outcome-workflow-design.md`
- `docs/quality-gate.md`

Do not implement critical business logic only in the frontend. Phone duplicate enforcement, lead stage transitions, archive/reactivation, capture/won conversion, vendor assignment, KYC access, pricing visibility, and audit history must be backend-controlled.

Every meaningful change must end with the quality gate. Run `npm run check:all` and perform the relevant UI/API/database/user-level smoke checks from `docs/quality-gate.md`. If any part cannot be executed, state the limitation clearly.
