DO $body$
DECLARE
  v_definition text;
BEGIN
  v_definition := pg_get_functiondef(
    'public.rpc_create_lead(text,text,text,text,text,text,uuid,text,numeric,text)'::regprocedure
  );

  v_definition := replace(
    v_definition,
    'AND instance.created_by = v_current_user_id',
    'AND (crm.current_user_is_account_admin() OR instance.created_by = v_current_user_id)'
  );

  v_definition := replace(
    v_definition,
    $old$  IF v_instance_owner_id IS NULL THEN
    RAISE EXCEPTION 'A instancia selecionada nao possui um responsavel configurado';
  END IF;$old$,
    $new$  IF v_instance_owner_id IS NULL THEN
    SELECT u.id
    INTO v_instance_owner_id
    FROM crm.users AS u
    WHERE u.aces_id = v_aces_id
      AND u.role = 'ADMIN'::crm.user_role
    ORDER BY u.created_at ASC
    LIMIT 1;

    IF v_instance_owner_id IS NULL THEN
      RAISE EXCEPTION 'A instancia selecionada nao possui um responsavel configurado';
    END IF;
  END IF;$new$
  );

  EXECUTE v_definition;
END;
$body$;
