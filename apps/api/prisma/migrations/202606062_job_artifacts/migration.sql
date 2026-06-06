ALTER TYPE "JobEventType" ADD VALUE IF NOT EXISTS 'JOB_PHOTO_ADDED';
ALTER TYPE "JobEventType" ADD VALUE IF NOT EXISTS 'JOB_CHECKLIST_SAVED';
ALTER TYPE "JobEventType" ADD VALUE IF NOT EXISTS 'CERTIFICATE_CREATED';

CREATE TYPE "JobPhotoType" AS ENUM ('BEFORE_WORK', 'ISSUE_PHOTO', 'COMPLETED_WORK', 'CUSTOMER_CONFIRMATION', 'OTHER');
CREATE TYPE "JobChecklistType" AS ENUM ('INSTALLATION', 'REPAIR_SERVICE');
CREATE TYPE "JobChecklistStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');
CREATE TYPE "WorkCertificateAudience" AS ENUM ('CUSTOMER', 'VENDOR');

CREATE TABLE "job_photos" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "job_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "type" "JobPhotoType" NOT NULL,
    "file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "notes" TEXT,
    "uploaded_by_id" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_photos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_checklists" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "job_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "type" "JobChecklistType" NOT NULL,
    "status" "JobChecklistStatus" NOT NULL DEFAULT 'DRAFT',
    "items" JSONB NOT NULL DEFAULT '[]',
    "submitted_by_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_checklists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "work_certificates" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "job_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "vendor_id" TEXT,
    "audience" "WorkCertificateAudience" NOT NULL,
    "title" TEXT NOT NULL,
    "pdf_file_name" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_id" TEXT,

    CONSTRAINT "work_certificates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_photos_data_scope_job_id_type_uploaded_at_idx" ON "job_photos"("data_scope", "job_id", "type", "uploaded_at");
CREATE INDEX "job_photos_job_id_idx" ON "job_photos"("job_id");
CREATE INDEX "job_photos_vendor_id_idx" ON "job_photos"("vendor_id");

CREATE UNIQUE INDEX "job_checklists_job_id_type_key" ON "job_checklists"("job_id", "type");
CREATE INDEX "job_checklists_data_scope_job_id_status_idx" ON "job_checklists"("data_scope", "job_id", "status");
CREATE INDEX "job_checklists_job_id_idx" ON "job_checklists"("job_id");
CREATE INDEX "job_checklists_vendor_id_idx" ON "job_checklists"("vendor_id");

CREATE UNIQUE INDEX "work_certificates_job_id_audience_key" ON "work_certificates"("job_id", "audience");
CREATE INDEX "work_certificates_data_scope_customer_id_issued_at_idx" ON "work_certificates"("data_scope", "customer_id", "issued_at");
CREATE INDEX "work_certificates_data_scope_vendor_id_issued_at_idx" ON "work_certificates"("data_scope", "vendor_id", "issued_at");
CREATE INDEX "work_certificates_job_id_idx" ON "work_certificates"("job_id");
CREATE INDEX "work_certificates_customer_id_idx" ON "work_certificates"("customer_id");
CREATE INDEX "work_certificates_vendor_id_idx" ON "work_certificates"("vendor_id");

ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_photos" ADD CONSTRAINT "job_photos_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_checklists" ADD CONSTRAINT "job_checklists_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "job_checklists" ADD CONSTRAINT "job_checklists_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "work_certificates" ADD CONSTRAINT "work_certificates_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
