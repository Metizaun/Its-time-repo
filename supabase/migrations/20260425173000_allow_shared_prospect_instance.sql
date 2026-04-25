CREATE OR REPLACE FUNCTION crm.current_user_owns_instance(p_instance text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.instancia = NULLIF(btrim(p_instance), '')
      AND i.aces_id = public.current_aces_id()
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND (
        i.created_by = public.current_crm_user_id()
        OR lower(i.instancia) = 'prospect'
      )
  );
$$;

CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads l
    JOIN crm.instance i
      ON i.aces_id = l.aces_id
     AND i.instancia = l.instancia
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND l.owner_id = public.current_crm_user_id()
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND (
        i.created_by = public.current_crm_user_id()
        OR lower(i.instancia) = 'prospect'
      )
  );
$$;

DROP POLICY IF EXISTS instance_select ON crm.instance;
CREATE POLICY instance_select ON crm.instance FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND (
      created_by = public.current_crm_user_id()
      OR lower(instancia) = 'prospect'
    )
  );
