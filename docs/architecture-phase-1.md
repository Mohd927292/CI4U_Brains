# CI4U Brains Phase 1 Architecture Guardrails

## Current Build Scope

This project starts with CI4U Brains as a web-first internal CRM and operations dashboard. The first build is only the application foundation and dashboard shell. It is not yet the real backend workflow.

## Correct First Backend Boundary

Critical business actions must be backend-controlled:

- Lead import and phone normalization
- Duplicate phone enforcement
- Lead stage movement
- Follow-up scheduling
- Archive and reactivation
- Capture / won conversion
- Job creation
- Vendor assignment
- Vendor offer response handling
- Customer price and vendor price visibility
- KYC document access

Frontend checks may improve UX, but they must not be the source of truth.

## Phase 1 Data Model Direction

Use PostgreSQL as the core database with these initial tables:

- users
- roles
- rolePermissions
- customers
- customerPhones
- leads
- leadActivities
- followUps
- importBatches
- importRows
- notifications
- archives
- auditLogs

The `customerPhones.phoneNormalized` field must have a unique constraint. Import duplicate handling should be transactional: find or create customer identity, then create a lead cycle only when allowed.

## UI Rules For This Build

- Dashboard cards must eventually link to filtered queues.
- All counts shown in the current shell are mock data.
- Sidebar sections are navigation placeholders until routes are implemented.
- Vendor, work order, and operations modules are intentionally delayed until lead workflow is stable.

## Do Not Build Yet

- Vendor app
- Customer app
- WhatsApp API direct sending
- Payment gateway
- AI scraping
- Advanced BI
- GPS proof
- Full work order legal automation

These features depend on the core CRM workflow being reliable first.
