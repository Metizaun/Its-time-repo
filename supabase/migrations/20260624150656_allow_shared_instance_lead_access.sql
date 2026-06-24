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
        i.created_by = public.current_crm_user_id()
        OR EXISTS (
          SELECT 1
          FROM crm.instance_access_memberships iam
          WHERE iam.aces_id = i.aces_id
            AND iam.instance_name = i.instancia
            AND iam.crm_user_id = public.current_crm_user_id()
            AND iam.access_level = 'editor'
            AND iam.is_active = true
        )
      )
  );
$$;

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
        (
          l.owner_id = public.current_crm_user_id()
          AND i.created_by = public.current_crm_user_id()
        )
        OR EXISTS (
          SELECT 1
          FROM crm.instance_access_memberships iam
          WHERE iam.aces_id = l.aces_id
            AND iam.instance_name = l.instancia
            AND iam.crm_user_id = public.current_crm_user_id()
            AND iam.access_level = 'editor'
            AND iam.is_active = true
        )
      )
  );
$$;

DROP POLICY IF EXISTS leads_insert ON crm.leads;
CREATE POLICY leads_insert ON crm.leads
FOR INSERT
TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND owner_id = public.current_crm_user_id()
  AND crm.current_user_owns_instance(instancia)
);

DROP POLICY IF EXISTS leads_update ON crm.leads;
CREATE POLICY leads_update ON crm.leads
FOR UPDATE
TO authenticated
USING (crm.current_user_can_access_lead(id))
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_owns_instance(instancia)
);
