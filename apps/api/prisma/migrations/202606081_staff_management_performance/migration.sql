CREATE TYPE "StaffActivityType" AS ENUM (
  'STAFF_INVITED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_DEACTIVATED',
  'LEAD_CREATED',
  'LEAD_IMPORTED',
  'LEAD_INTERACTION',
  'LEAD_TRANSFERRED',
  'LEAD_ASSISTED',
  'LEAD_STAGE_CHANGED',
  'LEAD_WARM_MARKED',
  'LEAD_HOT_MARKED',
  'LEAD_WON_MARKED',
  'LEAD_LOST_MARKED',
  'FOLLOW_UP_SCHEDULED',
  'FOLLOW_UP_COMPLETED',
  'FOLLOW_UP_MISSED',
  'QUOTATION_CREATED',
  'SITE_VISIT_COORDINATED',
  'WHATSAPP_DRAFTED',
  'VENDOR_CREATED',
  'JOB_CREATED',
  'JOB_ASSIGNED',
  'WORK_STARTED',
  'WORK_COMPLETED'
);

CREATE TABLE "staff_activity_events" (
  "id" TEXT NOT NULL,
  "data_scope" "DataScope" NOT NULL DEFAULT 'DEVELOPMENT',
  "user_id" TEXT,
  "target_user_id" TEXT,
  "lead_id" TEXT,
  "customer_id" TEXT,
  "job_id" TEXT,
  "type" "StaffActivityType" NOT NULL,
  "summary" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_activity_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_activity_events_data_scope_user_id_occurred_at_idx"
  ON "staff_activity_events"("data_scope", "user_id", "occurred_at");

CREATE INDEX "staff_activity_events_data_scope_type_occurred_at_idx"
  ON "staff_activity_events"("data_scope", "type", "occurred_at");

CREATE INDEX "staff_activity_events_data_scope_target_user_id_occurred_at_idx"
  ON "staff_activity_events"("data_scope", "target_user_id", "occurred_at");

CREATE INDEX "staff_activity_events_lead_id_idx" ON "staff_activity_events"("lead_id");
CREATE INDEX "staff_activity_events_customer_id_idx" ON "staff_activity_events"("customer_id");
CREATE INDEX "staff_activity_events_job_id_idx" ON "staff_activity_events"("job_id");

ALTER TABLE "staff_activity_events"
  ADD CONSTRAINT "staff_activity_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_activity_events"
  ADD CONSTRAINT "staff_activity_events_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_activity_events"
  ADD CONSTRAINT "staff_activity_events_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_activity_events"
  ADD CONSTRAINT "staff_activity_events_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_activity_events"
  ADD CONSTRAINT "staff_activity_events_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_activity_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "staff_activity_events" FROM anon;
REVOKE ALL ON TABLE "staff_activity_events" FROM authenticated;
