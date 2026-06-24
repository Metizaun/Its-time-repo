CREATE OR REPLACE FUNCTION crm.current_user_is_account_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'crm', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.users u
    WHERE u.id = public.current_crm_user_id()
      AND u.aces_id = public.current_aces_id()
      AND u.role = 'ADMIN'::crm.user_role
  );
$$;

GRANT EXECUTE ON FUNCTION crm.current_user_is_account_admin() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION crm.current_user_owns_instance(p_instance text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'crm', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.instancia = NULLIF(btrim(p_instance), '')
      AND i.aces_id = public.current_aces_id()
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND (
        crm.current_user_is_account_admin()
        OR i.created_by = public.current_crm_user_id()
        OR EXISTS (
          SELECT 1
          FROM crm.instance_access_memberships iam
          WHERE iam.aces_id = i.aces_id
            AND iam.instance_name = i.instancia
            AND iam.crm_user_id = public.current_crm_user_id()
            AND iam.access_level IN ('editor', 'admin')
            AND iam.is_active = true
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION crm.current_user_owns_instance(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'crm', 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads l
    JOIN crm.instance i
      ON i.aces_id = l.aces_id
     AND i.instancia = l.instancia
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND (
        crm.current_user_is_account_admin()
        OR l.owner_id = public.current_crm_user_id()
        OR EXISTS (
          SELECT 1
          FROM crm.instance_access_memberships iam
          WHERE iam.aces_id = l.aces_id
            AND iam.instance_name = l.instancia
            AND iam.crm_user_id = public.current_crm_user_id()
            AND iam.access_level IN ('editor', 'admin')
            AND iam.is_active = true
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION crm.current_user_can_access_lead(uuid) TO authenticated, service_role;
