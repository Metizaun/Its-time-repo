-- Admins can create leads on every non-cancelled instance in their account.
-- The instance creator is audit data, not the lead owner: an account admin
-- must remain the owner of leads created by that admin, even when an instance
-- was originally created by a user from another account.
DO $body$
DECLARE
  v_definition text;
  v_old text := $old$
  SELECT instance.created_by
  INTO v_instance_owner_id
  FROM crm.instance AS instance
  WHERE instance.aces_id = v_aces_id
    AND instance.instancia = v_instance
    AND COALESCE(instance.setup_status, 'connected') <> 'cancelled'
    AND (crm.current_user_is_account_admin() OR instance.created_by = v_current_user_id)
  LIMIT 1;$old$;
  v_new text := $new$
  SELECT CASE
    WHEN crm.current_user_is_account_admin() THEN v_current_user_id
    ELSE instance_owner.id
  END
  INTO v_instance_owner_id
  FROM crm.instance AS instance
  LEFT JOIN crm.users AS instance_owner
    ON instance_owner.id = instance.created_by
   AND instance_owner.aces_id = v_aces_id
   AND instance_owner.role <> 'NENHUM'::crm.user_role
  WHERE instance.aces_id = v_aces_id
    AND instance.instancia = v_instance
    AND COALESCE(instance.setup_status, 'connected') <> 'cancelled'
    AND (crm.current_user_is_account_admin() OR instance.created_by = v_current_user_id)
  LIMIT 1;$new$;
BEGIN
  v_definition := pg_get_functiondef(
    'public.rpc_create_lead(text,text,text,text,text,text,uuid,text,numeric,text)'::regprocedure
  );

  IF strpos(v_definition, v_old) = 0 THEN
    RAISE EXCEPTION 'Nao foi possivel localizar a regra de responsavel da RPC de criacao de lead';
  END IF;

  v_definition := replace(v_definition, v_old, v_new);
  EXECUTE v_definition;
END;
$body$;
