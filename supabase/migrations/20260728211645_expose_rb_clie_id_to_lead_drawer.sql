CREATE OR REPLACE FUNCTION crm.get_lead_rb_clie_id(p_lead_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT metadata.clie_id
  FROM rb.lead_metadata AS metadata
  INNER JOIN crm.leads AS lead
    ON lead.id = metadata.lead_id
   AND lead.aces_id = metadata.aces_id
  WHERE metadata.lead_id = p_lead_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND lead.aces_id = public.current_aces_id()
    AND crm.current_user_can_access_lead(lead.id)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION crm.get_lead_rb_clie_id(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.get_lead_rb_clie_id(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION crm.get_lead_rb_clie_id(uuid) IS
  'Returns the RB CLIE_ID only when the authenticated CRM user can access the lead.';
