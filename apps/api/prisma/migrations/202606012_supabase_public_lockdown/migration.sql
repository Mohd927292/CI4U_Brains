-- Supabase public-schema hardening.
-- CI4U uses the NestJS API for critical CRM writes; browser clients must not
-- directly access these tables through Supabase's generated Data API.

DO $$
DECLARE
  table_name text;
  has_anon_role boolean;
  has_authenticated_role boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') INTO has_anon_role;
  SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') INTO has_authenticated_role;

  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'roles',
    'permissions',
    'user_roles',
    'role_permissions',
    'customers',
    'phone_index',
    'leads',
    'lead_activities',
    'follow_ups',
    'whatsapp_messages',
    'quotation_items',
    'quotation_package_templates',
    'quotation_package_template_items',
    'lead_quotations',
    'lead_quotation_packages',
    'lead_quotation_items',
    'won_lead_details',
    'notifications',
    'archives',
    'import_batches',
    'import_rows',
    'audit_logs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE IF EXISTS public.%I ENABLE ROW LEVEL SECURITY', table_name);
    IF has_anon_role THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', table_name);
    END IF;
    IF has_authenticated_role THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', table_name);
    END IF;
  END LOOP;

  IF has_anon_role THEN
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
  END IF;

  IF has_authenticated_role THEN
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
  END IF;
END $$;
