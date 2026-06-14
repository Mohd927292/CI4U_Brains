-- Cover direct foreign key columns flagged by Supabase/Postgres advisor.
-- Composite indexes stay in place for application queries; these keep FK maintenance predictable.

CREATE INDEX IF NOT EXISTS "vendor_team_members_vendor_id_idx" ON "vendor_team_members"("vendor_id");
CREATE INDEX IF NOT EXISTS "jobs_assigned_vendor_id_idx" ON "jobs"("assigned_vendor_id");
CREATE INDEX IF NOT EXISTS "vendor_offers_vendor_id_idx" ON "vendor_offers"("vendor_id");
CREATE INDEX IF NOT EXISTS "staff_activity_events_user_id_idx" ON "staff_activity_events"("user_id");
CREATE INDEX IF NOT EXISTS "staff_activity_events_target_user_id_idx" ON "staff_activity_events"("target_user_id");
CREATE INDEX IF NOT EXISTS "leads_scope_owner_queue_updated_idx" ON "leads"("data_scope", "assigned_to_id", "is_archived", "current_stage", "updated_at");
