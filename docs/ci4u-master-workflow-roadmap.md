# CI4U Master Workflow And Roadmap

This document is the working source of truth for CI4U Brains, Vendor App, and the future Customer App. Future development should follow this plan unless it is intentionally updated after review.

## 1. Product Definition

CI4U is a business operating system for lead management, customer history, follow-ups, vendor assignment, field operations, work orders, photos, checklists, notifications, finance tracking, and reports.

The ecosystem has three products:

- CI4U Brains: internal CRM and operations command center.
- CI4U Vendor App: vendor/partner mobile execution app.
- CI4U Customer App: future customer self-service app.

Current build priority is CI4U Brains.

## 2. Non-Negotiable Architecture Rules

- One customer identity can have many lead cycles and many jobs.
- Normalized phone number is the first duplicate key.
- Duplicate prevention must be enforced by the backend and database, not only the UI.
- Important actions must create immutable history.
- Data should be archived, not hard deleted, unless an admin-only legal/privacy process requires removal or anonymization.
- Vendor must never see customer price, company margin, internal notes, or other vendor offers.
- KYC documents, selfies, Aadhaar files, and signatures are sensitive data.
- Critical business writes must be backend-controlled.
- The dashboard must guide staff to the next safest action, not only show pretty numbers.

## 3. Final Technical Direction

Use this stack unless a later technical review changes it:

- CI4U Brains frontend: Next.js, React, TypeScript, Tailwind CSS.
- Brains first target: desktop/laptop web.
- Vendor App: React Native with Expo, Android first.
- Customer App: later, Next.js PWA first.
- Backend: NestJS modular monolith API.
- Database: PostgreSQL.
- Auth: managed auth provider plus backend-owned roles and permissions.
- Storage: private object storage with signed URLs.
- Queue/background jobs: Redis plus BullMQ.
- PDF work orders: server-side HTML template rendered to PDF.
- Notifications: in-app notifications first, push notifications later.
- WhatsApp phase 1: generated message, edit, copy, open WhatsApp manually.
- WhatsApp phase 2: official WhatsApp Business Platform only after consent, templates, and pricing are verified again.

## 4. Core Workflow Extraction

### Customer Identity

Every customer has one canonical profile:

- Customer ID
- Primary normalized phone
- Business/customer name
- Contact person
- Alternate phones
- Address, area, pincode, city
- Lifetime value
- Total jobs
- Last interaction

One customer can have many lead cycles:

- 2026 CCTV installation lead
- 2027 service complaint
- 2028 AMC renewal

### Lead Import

Initial mandatory fields:

- Customer or business name
- Phone number

Import sources:

- CSV
- Excel
- Manual entry
- Future customer app
- Future WhatsApp enquiry
- Future browser extension or scraping

Import flow:

1. Upload or enter leads.
2. Normalize phone numbers.
3. Validate required fields.
4. Check phone against active, archived, won, completed, trash, lost, not interested, wrong number, and not receiving records.
5. If phone is new, create customer identity and lead cycle.
6. If phone exists, show duplicate preview.
7. Let allowed user open existing record, reactivate, create new job under same customer, ignore, or mark duplicate.
8. Store import batch report.

### Lead Work

Lead detail is the main work screen. It must show:

- Customer identity
- Lead ID and customer ID
- Current stage and intent
- Assigned staff
- Last contact
- Next follow-up
- Quick actions
- Call update form
- WhatsApp preview
- Full timeline

Every call update must capture:

- Call outcome
- Conversation summary when required
- Intent
- Follow-up date/time when required
- Follow-up reason
- WhatsApp message status
- Next action

### Lead Stages

Use controlled stages:

- Raw / Untouched
- Contact Attempted
- Warm
- Hot - Installation
- Hot - Repair / Service
- Hot - AMC
- Quotation Pending
- Site Visit Pending
- Captured / Won
- Vendor Assignment
- Vendor Offer Sent
- Vendor Accepted
- Operations / Ongoing
- Active Job
- Completed
- Lost
- Not Interested
- Wrong Number
- Not Receiving
- Not Receiving Final
- Trash / Archived

Won must not be a casual dropdown value. It must trigger capture confirmation and job creation.

### Follow-Up Engine

Follow-ups must support:

- Today due
- Overdue
- Hot priority
- Warm nurture
- Assigned staff
- Completion status
- Reason
- Next action

Dashboard priority order:

1. Overdue hot leads.
2. Today due hot leads.
3. Today due warm leads.
4. Upcoming hot installation leads.
5. Upcoming repair/service leads.
6. Upcoming AMC leads.
7. Upcoming warm nurture.

### Archive And Reactivation

Archive categories:

- Not Interested
- Wrong Number
- Not Receiving Final
- Lost
- Old Warm
- Old Completed
- Duplicate
- Manually Archived

Reactivation flow:

1. User opens archived record.
2. User reviews history.
3. System blocks re-import duplicate behavior.
4. Allowed user reactivates to Master Leads or correct stage.
5. System creates history entry.
6. Previous history remains intact.

### Capture / Won

Capture must open a controlled confirmation screen with:

- Customer price
- Customer name
- Site contact
- Written address
- Location link
- Area
- Pincode
- City
- Scope of work
- Schedule date/time
- Vendor offer price
- Internal notes

Backend transaction must:

1. Mark lead as captured/won.
2. Create job.
3. Add customer history.
4. Add lead activity.
5. Add dashboard notification.
6. Place job into vendor assignment queue.

### Vendor Assignment

Vendor matching should start rule-based:

- Pincode
- Area
- Service category
- Skills
- Active status
- KYC verified
- Current workload
- Rating
- Acceptance rate
- Previous job performance
- Average cost
- Complaint history

Do not add AI vendor matching until real performance data exists.

### Vendor App

Vendor app starts after Brains has working vendor and job workflows.

Vendor flow:

1. Phone OTP login.
2. KYC form.
3. Verification pending.
4. Admin review in Brains.
5. Approval and Vendor ID generation.
6. Job offers.
7. Accept, negotiate, reject.
8. Work order acceptance.
9. Ongoing jobs.
10. Site arrival.
11. Before photos.
12. Completion photos.
13. Checklist.
14. Completion submission.
15. Payment history.

### Operations

Job statuses:

- Waiting for Vendor Assignment
- Offer Sent
- Vendor Negotiation
- Vendor Accepted
- Work Order Generated
- Vendor On The Way
- Active / Reached Site
- Work In Progress
- Work Submitted
- Completion Review Pending
- Completed
- Rework Required
- Customer Complaint
- Cancelled
- Vendor Rejected
- Vendor No Show
- Payment Pending
- Closed

Operations staff must be able to approve, request correction, mark incomplete, raise complaint, and close jobs.

### Finance

Job finance must track:

- Customer price
- Vendor offer price
- Vendor accepted price
- Material cost
- Transport cost
- Extra cost
- Discount
- Refund
- Gross revenue
- Net margin
- Customer payment received
- Customer payment pending
- Vendor paid amount
- Vendor balance

Only authorized roles can see customer price, margin, and internal profit.

## 5. Data Model Plan

Initial database tables:

- users
- roles
- permissions
- rolePermissions
- customers
- customerPhones
- leads
- leadActivities
- followUps
- whatsappMessages
- notifications
- importBatches
- importRows
- archives
- auditLogs

Later operational tables:

- vendors
- vendorKyc
- vendorTeamMembers
- jobs
- vendorOffers
- workOrders
- jobPhotos
- jobChecklists
- payments
- payoutRecords
- reportSnapshots

Required early constraints:

- Unique normalized phone in `customerPhones`.
- Lead must reference customer.
- Follow-up must reference lead and customer.
- Activity must reference lead and customer.
- Archive must not erase lead history.
- Critical writes must be transactional.

Required early indexes:

- `customerPhones(phoneNormalized)`
- `leads(customerId, currentStage, isArchived)`
- `leads(assignedTo, currentStage, nextFollowUpAt)`
- `followUps(assignedTo, dueAt, status)`
- `leadActivities(leadId, createdAt)`
- `notifications(userId, read, createdAt)`
- `jobs(jobStatus, scheduledAt)` when jobs begin
- `vendors(pincode, area, active, kycStatus)` when vendor module begins

## 6. Role And Permission Plan

Roles:

- Founder / Super Admin
- Admin
- Management
- Sales Head
- Sales Manager
- Sales Executive
- Operations Head
- Operations Executive
- Vendor Management Executive
- Accounts Executive
- Support Staff
- Viewer
- Vendor

Permission groups:

- Lead read/update/import/archive/reactivate
- Follow-up read/update/assign
- Customer read/update
- WhatsApp draft/create/send-status update
- Job create/update/assign/close
- Vendor read/update/verify
- KYC read/approve/reject
- Customer price read/update
- Vendor price read/update
- Margin report read
- User management
- Audit log read

## 7. UI/UX Plan

Brains navigation:

- Login
- Operations Command dashboard
- Master Leads
- Lead Detail
- Today Follow-ups
- Overdue Follow-ups
- Warm Leads
- Hot Installation
- Hot Repair / Service
- Hot AMC
- Capture / Won
- Vendor Assignment
- Operations / Live Jobs
- Vendors
- Customers
- Work Orders
- WhatsApp Messages
- Notifications
- Reports
- Imports
- Archive
- Settings
- User Management

Lead Detail UI priorities:

1. What happened last?
2. What should staff do next?
3. What stage is this customer in?
4. Is a follow-up due?
5. Is there duplicate/history risk?
6. What is blocked by permissions?

Vendor App UI:

- OTP login
- KYC
- Verification pending
- Home
- New job offers
- Offer detail
- Accept / Negotiate / Reject
- Ongoing jobs
- Active job
- Upload photos
- Checklist
- Past jobs
- Earnings
- Profile
- Support

## 8. Full Roadmap

### Phase 0: Final Foundation Decision

Goal: Lock the technical direction and workflow boundaries.

Features:

- Tech stack decision
- Architecture docs
- Roadmap docs
- Phase boundaries

Backend:

- No production backend yet.

Frontend:

- Dashboard shell foundation.

Testing:

- Lint/build/browser smoke test.

Risk: Medium.

Done condition:

- Project runs locally and source-of-truth docs exist.

### Phase 1: Brains Foundation

Goal: Create real app foundation.

Features:

- Auth shell
- Role model
- Layout
- Dashboard route
- Navigation routes

Backend:

- NestJS API scaffold
- PostgreSQL setup
- Users, roles, permissions
- Audit log foundation

Frontend:

- Login page
- Protected app layout
- Navigation
- Empty states

Testing:

- Login, logout, route guard, role visibility.

Risk: High.

Done condition:

- Staff user can log in and see only allowed sections.

### Phase 2: Lead Import And Duplicate Enforcement

Goal: Build the real data integrity foundation.

Features:

- CSV import
- Manual lead create
- Phone normalization
- Duplicate preview
- Import report

Backend:

- Customers
- Customer phones
- Leads
- Import batches
- Import rows
- Transactional duplicate handling

Frontend:

- Import screen
- Preview table
- Duplicate resolution UI
- Import report screen

Testing:

- Duplicate phones, invalid phones, missing names, archived duplicates, completed customer duplicates, large file.

Risk: Critical.

Done condition:

- Same normalized phone cannot create duplicate customer identity.

### Phase 3: Lead Detail And Follow-Up Engine

Goal: Make staff able to work leads.

Features:

- Lead detail
- Call outcome
- Stage/intent update
- Follow-up create/complete
- Activity timeline

Backend:

- Lead activities
- Follow-ups
- Stage transition service

Frontend:

- Lead detail screen
- Guided call form
- Timeline
- Follow-up panels

Testing:

- Warm required follow-up, hot required follow-up, not receiving count, stage change history.

Risk: High.

Done condition:

- A raw lead can be worked through warm/hot/lost/archive with full history.

### Phase 4: Dashboard And Notifications

Goal: Make dashboard operationally useful.

Features:

- Today follow-ups
- Overdue follow-ups
- Hot lead queues
- Basic notifications
- Clickable dashboard cards

Backend:

- Notification table
- Dashboard aggregate queries
- Optional precomputed counters

Frontend:

- Real dashboard cards
- Filtered list navigation
- Notification center

Testing:

- Counts match database, cards open correct filters, permissions apply.

Risk: Medium.

Done condition:

- Staff can start their day from dashboard queues.

### Phase 5: WhatsApp Manual Message Flow

Goal: Support WhatsApp without API risk.

Features:

- Template-based message generation
- Edit preview
- Copy button
- Open WhatsApp button
- Message record

Backend:

- WhatsApp messages table
- Template variables

Frontend:

- Message preview modal
- Copy/open actions

Testing:

- Correct phone, correct message body, edited status, sent status manual update.

Risk: Medium.

Done condition:

- Staff can generate and manually send WhatsApp messages while CRM records the action.

### Phase 6: Archive And Reactivation

Goal: Keep history clean without deleting business data.

Features:

- Archive filters
- View history
- Reactivate
- Create new lead/job under existing customer

Backend:

- Archive service
- Reactivation transaction

Frontend:

- Archive screen
- Reactivation confirmation

Testing:

- Archived duplicate import, reactivation, full history preservation.

Risk: High.

Done condition:

- Old leads can be restored safely without duplicate creation.

### Phase 7: Capture / Won And Job Creation

Goal: Convert sales into operations safely.

Features:

- Capture confirmation
- Work order draft data
- Job creation
- Vendor assignment queue

Backend:

- Jobs table
- Capture transaction
- Price permission checks

Frontend:

- Capture form
- Job summary

Testing:

- Missing address blocked, missing price blocked where required, unauthorized price view blocked.

Risk: Critical.

Done condition:

- Won lead creates a job and history atomically.

### Phase 8: Vendor Manager In Brains

Goal: Manage vendors before mobile app.

Features:

- Vendor database
- Vendor status
- Skills and service areas
- Rule-based matching
- Offer sending record

Backend:

- Vendors
- Vendor offers
- Matching query

Frontend:

- Vendor list
- Vendor detail
- Assignment screen

Testing:

- Inactive/unverified vendors excluded, pincode match, skill match, multiple offers.

Risk: High.

Done condition:

- Operations can assign/send offers inside Brains.

### Phase 9: Vendor KYC Module

Goal: Verify vendors securely.

Features:

- KYC review
- Approve/reject
- Vendor ID generation
- Sensitive document access logging

Backend:

- Vendor KYC
- Private file references
- Signed URLs
- Access audit logs

Frontend:

- KYC review screen
- Masked document display

Testing:

- Unauthorized access blocked, approval history stored, rejected vendor cannot receive jobs.

Risk: Critical.

Done condition:

- Only verified vendors can receive job offers.

### Phase 10: Vendor App MVP

Goal: Let vendors respond to work.

Features:

- Phone OTP
- KYC submit
- Job offers
- Accept/negotiate/reject
- Ongoing jobs

Backend:

- Vendor app API
- OTP auth integration
- Vendor-scoped permissions

Frontend:

- React Native app screens

Testing:

- Vendor sees only own offers and no internal pricing.

Risk: High.

Done condition:

- Vendor can accept/reject/negotiate a real offer.

### Phase 11: Work Order PDF And Agreement

Goal: Generate job-wise agreement.

Features:

- Work order PDF
- Terms version
- Vendor signature attachment
- Acceptance record

Backend:

- PDF worker
- Work orders table
- Terms versioning

Frontend:

- Preview/download
- Accept agreement

Testing:

- Correct fields, signature attached, internal fields hidden.

Risk: High.

Done condition:

- Accepted vendor job has a stored agreement PDF.

### Phase 12: Operations / Live Jobs

Goal: Track job execution.

Features:

- Job board
- Status transitions
- Delay flags
- No-show
- Complaint/rework

Backend:

- Job transition service
- Operations notifications

Frontend:

- Live jobs screen
- Job detail

Testing:

- Invalid transitions blocked, audit created.

Risk: High.

Done condition:

- Operations can track real jobs from assignment to completion.

### Phase 13: Photos, Checklists, Completion

Goal: Collect proof and close jobs professionally.

Features:

- Before photos
- Issue photos
- Completion photos
- Checklists
- Completion review

Backend:

- Private uploads
- File validation
- Checklist tables

Frontend:

- Vendor upload flows
- Brains review screen

Testing:

- File size/type, missing checklist blocked, correction request.

Risk: High.

Done condition:

- Vendor can submit completion and Brains can approve or request correction.

### Phase 14: Reports, Revenue, Margin, Payouts

Goal: Give management real control.

Features:

- Lead reports
- Staff reports
- Vendor reports
- Revenue/margin
- Vendor payout
- Exports

Backend:

- Report snapshots
- Aggregate tables
- Export jobs

Frontend:

- Report dashboards
- CSV/PDF export

Testing:

- Calculations reconcile with job records.

Risk: High.

Done condition:

- Founder/admin can trust the numbers.

### Phase 15: Customer App Planning

Goal: Add customer self-service only after operations are stable.

Features:

- Enquiry
- Job tracking
- Complaint
- Payment
- Feedback

Backend:

- Customer app API scope

Frontend:

- PWA prototype

Testing:

- Customer sees only own data.

Risk: Medium.

Done condition:

- Customer app scope approved after Brains/Vendor workflows prove stable.

## 9. MVP Definition

The smallest professional MVP is:

- Staff login
- Roles and permissions
- Customer identity
- Normalized phone duplicate enforcement
- CSV/manual lead import
- Duplicate preview and import report
- Master leads
- Lead detail
- Call outcome logic
- Warm/hot follow-ups
- Today and overdue follow-up queues
- WhatsApp manual message generation
- Archive/reactivation
- Basic dashboard counts
- Audit/activity timeline

Do not put these in MVP:

- Vendor mobile app
- Customer app
- Direct WhatsApp API sending
- Payment gateway
- AI scraping
- GPS proof
- Advanced BI
- Complex automation builder

## 10. Quality Bar

Every feature must define:

- Correct next task check
- Backend impact
- Database impact
- UI/UX impact
- Security impact
- Test cases
- Failure cases
- Rollback plan

Every screen must handle:

- Empty state
- Loading state
- Error state
- Permission denied state
- Duplicate state where relevant
- Slow network behavior
- Double-click behavior
- Audit/history behavior

## 11. Recheck Notes

This roadmap is the best current approach because it prioritizes data integrity before mobile expansion, backend-controlled workflows before automation, and Brains before Vendor/Customer apps.

The approach should be rechecked before production for:

- WhatsApp Business Platform rules and pricing
- OTP provider pricing and abuse controls
- KYC/Aadhaar handling compliance
- Hosting cost
- Backup/PITR capability
- File storage lifecycle cost
- Push notification behavior on target devices

## 12. Next Immediate Engineering Step

The next correct build step is backend foundation:

1. Add NestJS backend workspace.
2. Add PostgreSQL schema/migrations.
3. Add users, roles, permissions, customers, customerPhones, leads, leadActivities, followUps, importBatches, auditLogs.
4. Implement phone normalization.
5. Implement duplicate-safe manual lead creation.
6. Add import preview service.
7. Connect Brains frontend to real API after backend foundation is stable.
