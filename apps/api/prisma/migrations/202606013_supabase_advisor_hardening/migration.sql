-- Supabase public schema hardening for Prisma's migration metadata table.
-- Prisma connects as the database owner for migrations, so enabling RLS here
-- does not block migration deploys, but it prevents accidental public exposure.
ALTER TABLE IF EXISTS public._prisma_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._prisma_migrations FROM anon;
REVOKE ALL ON TABLE public._prisma_migrations FROM authenticated;

-- Foreign-key indexes recommended by Supabase performance advisors.
-- These keep joins, cascades, deletes, and history lookups predictable as CRM
-- data grows beyond small demo volumes.
CREATE INDEX IF NOT EXISTS user_roles_role_id_idx ON public.user_roles(role_id);
CREATE INDEX IF NOT EXISTS role_permissions_permission_id_idx ON public.role_permissions(permission_id);

CREATE INDEX IF NOT EXISTS lead_activities_lead_id_idx ON public.lead_activities(lead_id);
CREATE INDEX IF NOT EXISTS lead_activities_created_by_id_idx ON public.lead_activities(created_by_id);

CREATE INDEX IF NOT EXISTS follow_ups_customer_id_idx ON public.follow_ups(customer_id);
CREATE INDEX IF NOT EXISTS follow_ups_assigned_to_id_idx ON public.follow_ups(assigned_to_id);

CREATE INDEX IF NOT EXISTS whatsapp_messages_lead_id_idx ON public.whatsapp_messages(lead_id);

CREATE INDEX IF NOT EXISTS quotation_package_template_items_quotation_item_id_idx
  ON public.quotation_package_template_items(quotation_item_id);

CREATE INDEX IF NOT EXISTS lead_quotations_lead_id_idx ON public.lead_quotations(lead_id);

CREATE INDEX IF NOT EXISTS won_lead_details_customer_id_idx ON public.won_lead_details(customer_id);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS notifications_customer_id_idx ON public.notifications(customer_id);

CREATE INDEX IF NOT EXISTS archives_customer_id_idx ON public.archives(customer_id);
CREATE INDEX IF NOT EXISTS archives_archived_by_id_idx ON public.archives(archived_by_id);
CREATE INDEX IF NOT EXISTS archives_reactivated_by_id_idx ON public.archives(reactivated_by_id);

CREATE INDEX IF NOT EXISTS import_batches_uploaded_by_id_idx ON public.import_batches(uploaded_by_id);

CREATE INDEX IF NOT EXISTS import_rows_lead_id_idx ON public.import_rows(lead_id);
