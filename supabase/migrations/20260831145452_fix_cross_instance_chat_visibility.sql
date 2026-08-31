BEGIN;

-- A lead keeps one primary instance, but an inbound message can authorize
-- another instance of the same account. That secondary instance must also
-- make the lead visible to users who have access to it.
CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads AS lead
    WHERE lead.id = p_lead_id
      AND lead.aces_id = public.current_aces_id()
      AND (
        crm.current_user_is_account_admin()
        OR lead.owner_id = public.current_crm_user_id()
        OR (
          crm.current_user_can_access_instance(lead.instancia, 'viewer')
          AND crm.current_user_has_empresa_access(lead.empresa_id)
        )
        OR (
          crm.current_user_has_empresa_access(lead.empresa_id)
          AND EXISTS (
            SELECT 1
            FROM crm.lead_instance_memberships AS membership
            WHERE membership.aces_id = lead.aces_id
              AND membership.lead_id = lead.id
              AND membership.is_active IS TRUE
              AND crm.current_user_can_access_instance(membership.instance_name, 'viewer')
          )
        )
      )
  );
$$;

COMMENT ON FUNCTION crm.current_user_can_access_lead(uuid) IS
  'Autoriza administradores, responsavel direto, instancia primaria ou instancia secundaria autorizada do lead.';

COMMIT;
