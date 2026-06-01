# Lead Outcome Workflow Design

This document defines the current Raw, Warm, Hot, Won, Lost, and Archive workflow. The rule is strict: stage movement is backend-controlled, not frontend-only.

## Raw Lead Entry

Raw Leads are the first work queue. A raw lead can be created by:

- Manual entry
- CSV import
- XLSX import

Required fields:

- Customer or business name
- Phone number

Backend rules:

- Normalize Indian mobile numbers before duplicate checks.
- Phone number is the strict first duplicate key.
- Never create a second customer identity for the same normalized phone inside the same data scope.
- Duplicate preview must show current stage, archive status, owner, next follow-up, and last history.

## Development Auth Separation

Every API request except health must include development auth headers in dev mode:

- `x-ci4u-data-scope: development`
- `x-ci4u-dev-user-id`
- `x-ci4u-dev-user-name`
- `x-ci4u-dev-role`

Production auth must replace this before production use. Business records store `data_scope`, and duplicate phone checks are scoped by:

- `data_scope`
- normalized phone number

This keeps development test leads away from production phone records even if a shared database is accidentally used during setup.

## First Call Outcomes

Only four outcomes are allowed:

- `SPOKE`
- `NOT_INTERESTED`
- `WRONG_NUMBER`
- `NOT_RECEIVING`

No `Busy`, `Call Later`, `Switched Off`, or `Invalid Number` in this version.

## Not Interested

Requires:

- Conversation summary

Save:

- Stage: `NOT_INTERESTED`
- Archive category: `NOT_INTERESTED`
- Follow-up stopped
- History entry created

Do not hard delete.

## Wrong Number

Save:

- Stage: `WRONG_NUMBER`
- Archive category: `WRONG_NUMBER`
- Follow-up stopped
- History entry created

Allow future correction or reactivation.

## Not Receiving

Raw and Warm leads:

- Increment `notReceivingCount`.
- Keep the lead in the `Unanswered` queue while the ladder is active.
- Backend auto-schedules the next attempt; staff should not manually choose the date.
- Attempt 1: after 3 hours
- Attempt 2: after 24 hours
- Attempt 3: after 72 hours
- Attempt 4: after 1 week
- Attempt 5: after 1 month
- Attempt 6: after 3 months
- Attempt 7: move to `NOT_RECEIVING_FINAL` archive

Hot and Won follow-ups:

- First unanswered follow-up: after 3 hours
- Every later unanswered follow-up: after 24 hours
- Keep the lead in `Unanswered`
- Do not create a ghosting decision in V2
- Do not ask site-visit completion questions unless staff selects `SPOKE`

## Spoke

Required order:

1. Conversation summary
2. Follow-up date/time default
3. Lead intent

Allowed lead intents on first spoken interaction:

- `WARM`
- `INSTALLATION`
- `REPAIR_SERVICE`

From the second spoken interaction onward, `LOST` is also allowed, but it requires a lost confirmation summary.

## Warm

Follow-up reason:

- `NURTURE` only

Rules:

- Default follow-up date is one month later.
- Staff may edit the follow-up date before saving.
- Stage: `WARM`
- Intent: `WARM`
- Priority: `MEDIUM`
- History entry created
- Warm follow-ups behave like Raw Leads but show previous history and warm-follow-up context.

## Hot Installation / Repair-Service

Allowed hot follow-up reasons:

- `NURTURE`
- `QUOTATION`
- `SITE_VISIT`
- `WON`

Save:

- Installation intent -> `HOT_INSTALLATION`
- Repair/service intent -> `HOT_REPAIR_SERVICE`
- Priority: `HIGH`
- History entry created

If intent changes after a previous spoken interaction, the backend requires `intentChangeSummary`.

## Quotation

Backend-owned rules:

- `QUOTATION` requires at least one package and at least one item.
- Prices are stored as integer paise.
- UI displays whole rupees.
- Each item stores item name, unit price, quantity, and line total.
- Package multiplier is saved in the lead quotation snapshot.
- Saving a quotation updates company-wide quotation item and package-template suggestions.

Rejected by backend:

- Empty quotation package
- Empty quotation item
- Negative price
- Missing quotation when follow-up reason is `QUOTATION`

## Site Visit

If `SITE_VISIT` is scheduled:

- `siteVisitStatus` must be `SCHEDULED`.
- `siteVisitScheduledAt` is required.
- The follow-up date becomes the site visit scheduled date.
- The UI labels it as `Site Visit Scheduled Date`.

If not scheduled:

- `siteVisitStatus` must be `NOT_SCHEDULED`.
- Normal follow-up date/time is required.

On a scheduled site-visit follow-up, if staff selects `SPOKE`, the backend requires `siteVisitOutcome`:

- `COMPLETED` requires outcome summary.
- `NOT_COMPLETED` requires not-completed reason.

If the site visit is rescheduled, the next scheduled date is saved again and shown as the current site visit schedule.

## Won

`WON` is a follow-up reason, not a normal intent.

Selecting `WON` requires `wonDetails`:

- Site contact number
- Address or location
- Scope of work
- Schedule status
- Schedule date/time when scheduled
- Quoted price
- Accepted price
- Advance payment

Save:

- Stage: `CAPTURED_WON`
- Queue: `Won Leads`
- Lightweight `won_lead_details` record created or updated
- No job, vendor assignment, or work-order record yet

This is intentional. Vendor/job workflow is not stable enough to attach here yet.

## Lost

`LOST` is only allowed from the second spoken interaction onward.

Requires:

- Conversation summary
- Lost summary

Save:

- Stage: `LOST`
- Queue: `Lost Leads`
- Follow-up stopped
- History remains searchable
- No hard delete

## WhatsApp

Version 1:

- Generate deterministic message draft from customer name, summary, intent, and follow-up reason.
- Staff can edit the message.
- Staff opens WhatsApp with a prefilled message and sends manually.

Future:

- Backend AI draft service with structured JSON.
- Official WhatsApp Business API only after template, cost, and compliance review.

## Implemented Endpoint

- `POST /v1/leads/:leadId/call-outcome`

This endpoint controls:

- Stage movement
- Intent movement
- Follow-up date
- Site visit schedule and outcome state
- Quotation snapshot and quotation suggestions
- Not Receiving count and scheduling
- Archive state
- Won transfer and won detail storage
- Lost transfer
- History timeline
