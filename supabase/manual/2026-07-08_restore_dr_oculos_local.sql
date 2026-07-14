DO $$
DECLARE
  v_user_id uuid;
  v_agent agents.ai_agents%ROWTYPE;
BEGIN
  SELECT u.id
  INTO v_user_id
  FROM crm.users u
  WHERE u.aces_id = 5
    AND u.role = 'ADMIN'
    AND lower(u.email) = 'publigyntrafego@gmail.com'
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel localizar o usuario ADMIN do aces_id 5';
  END IF;

  UPDATE crm.instance
  SET
    color = COALESCE(color, '#3b82f6'),
    status = 'connected',
    setup_status = 'connected',
    setup_started_at = COALESCE(setup_started_at, created_at, now()),
    setup_expires_at = NULL,
    operation_lock_until = NULL,
    last_error = NULL,
    created_by = v_user_id,
    connection_mode = 'local',
    remote_evolution_url = NULL,
    remote_instance_name = NULL,
    remote_webhook_connected_at = NULL
  WHERE aces_id = 5
    AND instancia = 'mamis';

  IF NOT FOUND THEN
    INSERT INTO crm.instance (
      instancia,
      aces_id,
      color,
      created_at,
      token,
      status,
      setup_status,
      setup_started_at,
      setup_expires_at,
      operation_lock_until,
      last_error,
      created_by,
      connection_mode,
      remote_evolution_url,
      remote_instance_name,
      remote_webhook_connected_at
    )
    VALUES (
      'mamis',
      5,
      '#3b82f6',
      now(),
      NULL,
      'connected',
      'connected',
      now(),
      NULL,
      NULL,
      NULL,
      v_user_id,
      'local',
      NULL,
      NULL,
      NULL
    );
  END IF;

  INSERT INTO crm.instance_access_memberships (
    aces_id,
    instance_name,
    crm_user_id,
    access_level,
    granted_by,
    grant_reason,
    is_active,
    granted_at,
    revoked_at
  )
  VALUES (
    5,
    'mamis',
    v_user_id,
    'admin',
    v_user_id,
    'Restauracao local do Dr Oculos',
    true,
    now(),
    NULL
  )
  ON CONFLICT (instance_name, crm_user_id) DO UPDATE
  SET
    aces_id = EXCLUDED.aces_id,
    access_level = EXCLUDED.access_level,
    granted_by = EXCLUDED.granted_by,
    grant_reason = EXCLUDED.grant_reason,
    is_active = true,
    revoked_at = NULL;

  SELECT a.*
  INTO v_agent
  FROM agents.ai_agents a
  WHERE a.aces_id = 5
    AND a.instance_name = 'mamis'
    AND a.template_key = 'cobranca_rb'
  ORDER BY a.created_at DESC
  LIMIT 1;

  IF v_agent.id IS NULL THEN
    v_agent := agents.create_agent_from_template(
      5,
      v_user_id,
      'mamis',
      'Cobranca Dr Oculos',
      NULL,
      'gemini-2.5-flash',
      0.35,
      'cobranca_rb',
      true
    );
  END IF;

  UPDATE agents.agent_tools
  SET
    is_enabled = true,
    readiness = 'ready',
    config = jsonb_build_object(
      'rb_mode', 'mock',
      'rb_base_url', 'https://app.registrobase.com.br:32077',
      'rb_token_api', '',
      'rb_empresa_ids', '[]'::jsonb,
      'trigger_time', '10:00',
      'timezone', 'America/Sao_Paulo',
      'dispatch_mode', 'humanized',
      'stage_mapping', '{}'::jsonb,
      'pix_mapping_by_store', jsonb_build_object(
        '1', '66972304000129',
        '2', '66972192000106'
      ),
      'gupshup_defaults', '{}'::jsonb,
      'is_dr_oculos_bootstrap', true,
      'last_run_on_local_date', NULL,
      'default_owner_id', v_user_id
    )
  WHERE agent_id = v_agent.id
    AND tool_key = 'rb_billing';

  UPDATE agents.agent_tools
  SET
    is_enabled = false
  WHERE agent_id = v_agent.id
    AND tool_key = 'ai_audio';
END;
$$;
