-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "DataScope" AS ENUM ('DEVELOPMENT', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('RAW_UNTOUCHED', 'CONTACT_ATTEMPTED', 'WARM', 'HOT_INSTALLATION', 'HOT_REPAIR_SERVICE', 'HOT_AMC', 'QUOTATION_PENDING', 'SITE_VISIT_PENDING', 'CAPTURED_WON', 'VENDOR_ASSIGNMENT', 'VENDOR_OFFER_SENT', 'VENDOR_ACCEPTED', 'OPERATIONS_ONGOING', 'ACTIVE_JOB', 'COMPLETED', 'LOST', 'NOT_INTERESTED', 'WRONG_NUMBER', 'NOT_RECEIVING', 'GHOSTING', 'NOT_RECEIVING_FINAL', 'TRASH_ARCHIVED');

-- CreateEnum
CREATE TYPE "LeadIntent" AS ENUM ('UNKNOWN', 'WARM', 'NEW_INSTALLATION', 'REPAIR_SERVICE');

-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('LEAD_IMPORTED', 'LEAD_CREATED', 'DUPLICATE_DETECTED', 'CALL_ATTEMPTED', 'CALL_CONNECTED', 'CALL_OUTCOME', 'FOLLOW_UP_SCHEDULED', 'FOLLOW_UP_COMPLETED', 'STAGE_CHANGED', 'INTENT_CHANGED', 'WHATSAPP_GENERATED', 'WHATSAPP_SENT_MANUAL', 'ARCHIVED', 'REACTIVATED', 'NOTE_ADDED', 'WON_MARKED');

-- CreateEnum
CREATE TYPE "FollowUpReason" AS ENUM ('NURTURE', 'SITE_VISIT_REQUIRED', 'QUOTATION_REQUIRED', 'TO_FINALIZE_DECISION', 'WON');

-- CreateEnum
CREATE TYPE "SiteVisitScheduleStatus" AS ENUM ('SCHEDULED', 'NOT_SCHEDULED');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('OPEN', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ArchiveCategory" AS ENUM ('NOT_INTERESTED', 'WRONG_NUMBER', 'NOT_RECEIVING_FINAL', 'LOST', 'OLD_WARM', 'OLD_COMPLETED', 'DUPLICATE', 'MANUALLY_ARCHIVED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'IMPORTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('NEW_VALID', 'DUPLICATE_IN_FILE', 'DUPLICATE_ACTIVE', 'DUPLICATE_ARCHIVED', 'DUPLICATE_COMPLETED', 'INVALID_PHONE', 'MISSING_NAME', 'IMPORTED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('DRAFT', 'COPIED', 'OPENED_WHATSAPP', 'SENT_MANUAL_CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "auth_provider" TEXT,
    "auth_subject" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role_id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "primary_phone_normalized" TEXT NOT NULL,
    "business_name" TEXT NOT NULL,
    "contact_person" TEXT,
    "alternate_phones" JSONB NOT NULL DEFAULT '[]',
    "address" TEXT,
    "area" TEXT,
    "pincode" TEXT,
    "city" TEXT,
    "lifetime_value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_jobs" INTEGER NOT NULL DEFAULT 0,
    "last_interaction_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_index" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "phone_normalized" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "current_lead_id" TEXT,
    "current_stage" "LeadStage" NOT NULL DEFAULT 'RAW_UNTOUCHED',
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "last_updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "phone_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "customer_id" TEXT NOT NULL,
    "lead_cycle_number" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "current_stage" "LeadStage" NOT NULL DEFAULT 'RAW_UNTOUCHED',
    "current_intent" "LeadIntent" NOT NULL DEFAULT 'UNKNOWN',
    "assigned_to_id" TEXT,
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "last_call_at" TIMESTAMP(3),
    "next_follow_up_at" TIMESTAMP(3),
    "follow_up_reason" "FollowUpReason",
    "site_visit_status" "SiteVisitScheduleStatus",
    "site_visit_scheduled_at" TIMESTAMP(3),
    "not_receiving_count" INTEGER NOT NULL DEFAULT 0,
    "spoken_count" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "archive_category" "ArchiveCategory",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_activities" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "old_stage" "LeadStage",
    "new_stage" "LeadStage",
    "old_intent" "LeadIntent",
    "new_intent" "LeadIntent",
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "FollowUpStatus" NOT NULL DEFAULT 'OPEN',
    "assigned_to_id" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_messages" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "message_body" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "generated_by" TEXT NOT NULL,
    "edited_by_user" BOOLEAN NOT NULL DEFAULT false,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "sent_at" TIMESTAMP(3),
    "sent_by_id" TEXT,
    "failure_reason" TEXT,
    "api_message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "user_id" TEXT NOT NULL,
    "customer_id" TEXT,
    "type" TEXT NOT NULL,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "related_id" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "archives" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "lead_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "category" "ArchiveCategory" NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_by_id" TEXT,
    "reason" TEXT NOT NULL,
    "reactivated_at" TIMESTAMP(3),
    "reactivated_by_id" TEXT,

    CONSTRAINT "archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "uploaded_by_id" TEXT,
    "file_name" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "batch_id" TEXT NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_customer_name" TEXT,
    "raw_phone" TEXT,
    "normalized_phone" TEXT,
    "status" "ImportRowStatus" NOT NULL,
    "lead_id" TEXT,
    "duplicate_customer_id" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_data_scope_auth_subject_key" ON "users"("data_scope", "auth_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_data_scope_email_key" ON "users"("data_scope", "email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_code_key" ON "roles"("code");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_code_key" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "customers_data_scope_business_name_idx" ON "customers"("data_scope", "business_name");

-- CreateIndex
CREATE INDEX "customers_area_pincode_idx" ON "customers"("area", "pincode");

-- CreateIndex
CREATE UNIQUE INDEX "phone_index_current_lead_id_key" ON "phone_index"("current_lead_id");

-- CreateIndex
CREATE INDEX "phone_index_customer_id_idx" ON "phone_index"("customer_id");

-- CreateIndex
CREATE INDEX "phone_index_is_active_is_archived_idx" ON "phone_index"("is_active", "is_archived");

-- CreateIndex
CREATE UNIQUE INDEX "phone_index_data_scope_phone_normalized_key" ON "phone_index"("data_scope", "phone_normalized");

-- CreateIndex
CREATE INDEX "leads_data_scope_current_stage_next_follow_up_at_idx" ON "leads"("data_scope", "current_stage", "next_follow_up_at");

-- CreateIndex
CREATE INDEX "leads_customer_id_current_stage_is_archived_idx" ON "leads"("customer_id", "current_stage", "is_archived");

-- CreateIndex
CREATE INDEX "leads_assigned_to_id_current_stage_next_follow_up_at_idx" ON "leads"("assigned_to_id", "current_stage", "next_follow_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "leads_customer_id_lead_cycle_number_key" ON "leads"("customer_id", "lead_cycle_number");

-- CreateIndex
CREATE INDEX "lead_activities_data_scope_lead_id_created_at_idx" ON "lead_activities"("data_scope", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "lead_activities_customer_id_created_at_idx" ON "lead_activities"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "follow_ups_data_scope_assigned_to_id_due_at_status_idx" ON "follow_ups"("data_scope", "assigned_to_id", "due_at", "status");

-- CreateIndex
CREATE INDEX "follow_ups_lead_id_status_idx" ON "follow_ups"("lead_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_messages_data_scope_lead_id_created_at_idx" ON "whatsapp_messages"("data_scope", "lead_id", "created_at");

-- CreateIndex
CREATE INDEX "whatsapp_messages_customer_id_created_at_idx" ON "whatsapp_messages"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_data_scope_user_id_read_created_at_idx" ON "notifications"("data_scope", "user_id", "read", "created_at");

-- CreateIndex
CREATE INDEX "archives_data_scope_category_year_month_idx" ON "archives"("data_scope", "category", "year", "month");

-- CreateIndex
CREATE INDEX "archives_lead_id_idx" ON "archives"("lead_id");

-- CreateIndex
CREATE INDEX "import_batches_data_scope_uploaded_by_id_created_at_idx" ON "import_batches"("data_scope", "uploaded_by_id", "created_at");

-- CreateIndex
CREATE INDEX "import_rows_data_scope_normalized_phone_idx" ON "import_rows"("data_scope", "normalized_phone");

-- CreateIndex
CREATE INDEX "import_rows_status_idx" ON "import_rows"("status");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batch_id_row_number_key" ON "import_rows"("batch_id", "row_number");

-- CreateIndex
CREATE INDEX "audit_logs_data_scope_entity_type_entity_id_created_at_idx" ON "audit_logs"("data_scope", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_index" ADD CONSTRAINT "phone_index_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_index" ADD CONSTRAINT "phone_index_current_lead_id_fkey" FOREIGN KEY ("current_lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archives" ADD CONSTRAINT "archives_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archives" ADD CONSTRAINT "archives_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archives" ADD CONSTRAINT "archives_archived_by_id_fkey" FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "archives" ADD CONSTRAINT "archives_reactivated_by_id_fkey" FOREIGN KEY ("reactivated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
