ALTER TYPE "ActivityType" ADD VALUE IF NOT EXISTS 'LEAD_TRANSFERRED';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "post_title" TEXT,
  ADD COLUMN IF NOT EXISTS "role_tags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "permission_codes" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "authority_stage" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS "users_data_scope_status_authority_stage_idx"
  ON "users"("data_scope", "status", "authority_stage");

UPDATE "users"
SET
  "post_title" = COALESCE("post_title", 'BDM'),
  "role_tags" = '["BDM"]'::jsonb,
  "permission_codes" = '["ADD_RAW_LEADS","WORK_ON_LEADS","TRANSFER_LEADS","SUPERVISOR","ADD_USERS","DELETE_USERS"]'::jsonb,
  "authority_stage" = GREATEST("authority_stage", 90)
WHERE lower("email") = 'syedci4u@gmail.com';

UPDATE "users"
SET
  "post_title" = COALESCE("post_title", 'Co-Founder / CTO'),
  "role_tags" = '["CO_FOUNDER","CTO"]'::jsonb,
  "permission_codes" = '["ADD_RAW_LEADS","WORK_ON_LEADS","TRANSFER_LEADS","SUPERVISOR","ADD_USERS","DELETE_USERS"]'::jsonb,
  "authority_stage" = GREATEST("authority_stage", 100)
WHERE "id" IN (
  SELECT ur."user_id"
  FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."role_id"
  WHERE r."code" = 'SUPER_ADMIN'
);
