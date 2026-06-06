CREATE TYPE "VendorKycStatus" AS ENUM ('KYC_NOT_STARTED', 'KYC_SUBMITTED', 'VERIFICATION_PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED', 'BLOCKED');
CREATE TYPE "VendorTeamType" AS ENUM ('INDIVIDUAL', 'TEAM');
CREATE TYPE "JobStatus" AS ENUM ('WAITING_VENDOR_ASSIGNMENT', 'VENDOR_OFFER_SENT', 'VENDOR_ASSIGNED', 'WORK_STARTED', 'WORK_PAUSED', 'WORK_COMPLETED', 'CLOSED');
CREATE TYPE "VendorOfferStatus" AS ENUM ('OFFER_SENT', 'ACCEPTED', 'NEGOTIATED', 'REJECTED', 'CANCELLED');
CREATE TYPE "JobEventType" AS ENUM ('JOB_CREATED', 'VENDOR_OFFER_SENT', 'WORK_STARTED', 'WORK_PAUSED', 'WORK_RESUMED', 'WORK_COMPLETED', 'JOB_CLOSED');

CREATE TABLE "vendors" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "vendor_code" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "working_address" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "date_of_birth" TIMESTAMP(3) NOT NULL,
    "experience_years" INTEGER NOT NULL DEFAULT 0,
    "aadhaar_document_name" TEXT NOT NULL,
    "selfie_document_name" TEXT NOT NULL,
    "signature_reference" TEXT NOT NULL,
    "team_type" "VendorTeamType" NOT NULL DEFAULT 'INDIVIDUAL',
    "team_size" INTEGER NOT NULL DEFAULT 1,
    "skills" JSONB NOT NULL DEFAULT '[]',
    "kyc_status" "VendorKycStatus" NOT NULL DEFAULT 'VERIFICATION_PENDING',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_team_members" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "vendor_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "aadhaar_document_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_team_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'WAITING_VENDOR_ASSIGNMENT',
    "site_contact_number" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "scope_of_work" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3),
    "vendor_offer_price_paise" INTEGER,
    "assigned_vendor_id" TEXT,
    "started_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "completion_summary" TEXT,
    "vendor_bonus_paise" INTEGER NOT NULL DEFAULT 0,
    "vendor_deduction_paise" INTEGER NOT NULL DEFAULT 0,
    "completion_certificate_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vendor_offers" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "job_id" TEXT NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "offer_price_paise" INTEGER NOT NULL,
    "status" "VendorOfferStatus" NOT NULL DEFAULT 'OFFER_SENT',
    "message_body" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_events" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "job_id" TEXT NOT NULL,
    "type" "JobEventType" NOT NULL,
    "old_status" "JobStatus",
    "new_status" "JobStatus",
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendors_data_scope_phone_key" ON "vendors"("data_scope", "phone");
CREATE UNIQUE INDEX "vendors_data_scope_vendor_code_key" ON "vendors"("data_scope", "vendor_code");
CREATE INDEX "vendors_data_scope_active_kyc_status_idx" ON "vendors"("data_scope", "active", "kyc_status");
CREATE INDEX "vendors_data_scope_pincode_active_idx" ON "vendors"("data_scope", "pincode", "active");
CREATE INDEX "vendor_team_members_data_scope_vendor_id_idx" ON "vendor_team_members"("data_scope", "vendor_id");
CREATE UNIQUE INDEX "jobs_lead_id_key" ON "jobs"("lead_id");
CREATE INDEX "jobs_data_scope_status_scheduled_at_idx" ON "jobs"("data_scope", "status", "scheduled_at");
CREATE INDEX "jobs_data_scope_assigned_vendor_id_status_idx" ON "jobs"("data_scope", "assigned_vendor_id", "status");
CREATE INDEX "jobs_customer_id_idx" ON "jobs"("customer_id");
CREATE UNIQUE INDEX "vendor_offers_job_id_vendor_id_key" ON "vendor_offers"("job_id", "vendor_id");
CREATE INDEX "vendor_offers_data_scope_vendor_id_status_idx" ON "vendor_offers"("data_scope", "vendor_id", "status");
CREATE INDEX "vendor_offers_job_id_idx" ON "vendor_offers"("job_id");
CREATE INDEX "job_events_data_scope_job_id_created_at_idx" ON "job_events"("data_scope", "job_id", "created_at");
CREATE INDEX "job_events_job_id_idx" ON "job_events"("job_id");

ALTER TABLE "vendor_team_members" ADD CONSTRAINT "vendor_team_members_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_assigned_vendor_id_fkey" FOREIGN KEY ("assigned_vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vendor_offers" ADD CONSTRAINT "vendor_offers_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_offers" ADD CONSTRAINT "vendor_offers_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
