-- Instagram Sets 5/6: catalog checks consumed by schema-preflight.

CREATE OR REPLACE FUNCTION instagram.rpc_operations_preflight()
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'auditTable', to_regclass('instagram.admin_audit_events') IS NOT NULL,
    'auditRls', COALESCE((
      SELECT relrowsecurity
      FROM pg_class
      WHERE oid = 'instagram.admin_audit_events'::regclass
    ), false),
    'auditServiceRoleInsert', has_table_privilege('service_role', 'instagram.admin_audit_events', 'INSERT'),
    'notificationsTable', to_regclass('crm.notifications') IS NOT NULL,
    'notificationsIdempotencyKey', EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'crm'
        AND table_name = 'notifications'
        AND column_name = 'idempotency_key'
    ),
    'notificationsServiceRoleInsert', has_table_privilege('service_role', 'crm.notifications', 'INSERT')
  );
$$;

REVOKE ALL ON FUNCTION instagram.rpc_operations_preflight() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION instagram.rpc_operations_preflight() TO service_role;

NOTIFY pgrst, 'reload schema';
