-- Integrity guards for the independent collections release.
-- All functions stay private to the collections schema and are callable only
-- by the backend service role.

CREATE OR REPLACE FUNCTION collections.resolve_source_dispatcher(p_source_connection_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN sc.status <> 'active' THEN 'paused'
    WHEN COALESCE((SELECT rc.active_dispatcher
                   FROM collections.runtime_controls rc
                   WHERE rc.aces_id = sc.aces_id), '') = 'paused' THEN 'paused'
    WHEN sc.source_type = 'rb'
      AND NOT EXISTS (
        SELECT 1
        FROM rb.connections rb_connection
        WHERE rb_connection.id::text = NULLIF(sc.config->>'legacyConnectionId', '')
          AND rb_connection.aces_id = sc.aces_id
          AND rb_connection.is_active IS TRUE
          AND rb_connection.billing_enabled IS TRUE
          AND NULLIF(btrim(rb_connection.rb_token_api), '') IS NOT NULL
      ) THEN 'paused'
    WHEN sc.source_type = 'rb'
      AND COALESCE(sc.config->>'dispatcherMode', 'legacy_rb') <> 'canonical' THEN 'legacy_rb'
    ELSE 'canonical'
  END
  FROM collections.source_connections sc
  WHERE sc.id = p_source_connection_id;
$$;

CREATE OR REPLACE FUNCTION collections.prepare_rb_source(
  p_aces_id integer,
  p_legacy_connection_id uuid,
  p_config jsonb,
  p_capabilities jsonb DEFAULT '{}'::jsonb
)
RETURNS collections.source_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection rb.connections%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_config jsonb;
BEGIN
  IF jsonb_typeof(COALESCE(p_config, '{}'::jsonb)) <> 'object'
     OR jsonb_typeof(COALESCE(p_capabilities, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Configuracao da fonte invalida' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM rb.connections
  WHERE id = p_legacy_connection_id AND aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND OR v_connection.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'Conexao RB ativa nao encontrada' USING ERRCODE = '23503';
  END IF;

  v_config := COALESCE(p_config, '{}'::jsonb)
    || jsonb_build_object('legacyConnectionId', p_legacy_connection_id::text);
  SELECT * INTO v_source
  FROM collections.source_connections
  WHERE aces_id = p_aces_id
    AND source_type = 'rb'
    AND config->>'legacyConnectionId' = p_legacy_connection_id::text
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO collections.source_connections (
      aces_id, name, source_type, delivery_mode, default_ingestion_mode,
      status, capabilities, config
    ) VALUES (
      p_aces_id, 'Registro Base', 'rb', 'pull', 'incremental',
      'paused', COALESCE(p_capabilities, '{}'::jsonb), v_config
    )
    RETURNING * INTO v_source;
  ELSE
    UPDATE collections.source_connections
    SET capabilities = CASE
          WHEN COALESCE(p_capabilities, '{}'::jsonb) = '{}'::jsonb THEN capabilities
          ELSE COALESCE(p_capabilities, '{}'::jsonb)
        END,
        config = COALESCE(config, '{}'::jsonb) || v_config,
        updated_at = now()
    WHERE id = v_source.id AND aces_id = p_aces_id
    RETURNING * INTO v_source;
  END IF;

  RETURN v_source;
END;
$$;

CREATE OR REPLACE FUNCTION collections.rotate_source_credential(
  p_aces_id integer,
  p_source_connection_id uuid,
  p_credential_type text,
  p_ciphertext bytea,
  p_iv bytea,
  p_auth_tag bytea,
  p_key_version text,
  p_valid_until timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_credential_id uuid;
  v_expiry timestamptz := COALESCE(p_valid_until, now() + interval '24 hours');
BEGIN
  IF p_credential_type NOT IN ('rb_token', 'webhook_hmac') THEN
    RAISE EXCEPTION 'Tipo de credencial invalido' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(COALESCE(p_key_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Versao da chave obrigatoria' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(octet_length(p_ciphertext), 0) = 0
     OR octet_length(p_iv) <> 12
     OR octet_length(p_auth_tag) <> 16 THEN
    RAISE EXCEPTION 'Payload criptografico invalido' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM collections.source_connections sc
  WHERE sc.id = p_source_connection_id AND sc.aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fonte de cobranca nao encontrada' USING ERRCODE = '23503';
  END IF;

  UPDATE collections.source_credentials
  SET status = 'previous', valid_until = v_expiry, updated_at = now()
  WHERE aces_id = p_aces_id
    AND source_connection_id = p_source_connection_id
    AND credential_type = p_credential_type
    AND status = 'current';

  INSERT INTO collections.source_credentials (
    aces_id, source_connection_id, credential_type,
    ciphertext, iv, auth_tag, key_version, status, valid_until
  ) VALUES (
    p_aces_id, p_source_connection_id, p_credential_type,
    p_ciphertext, p_iv, p_auth_tag, p_key_version, 'current', NULL
  )
  RETURNING id INTO v_credential_id;

  RETURN v_credential_id;
END;
$$;

CREATE OR REPLACE FUNCTION collections.activate_collection_onboarding(
  p_aces_id integer,
  p_source_connection_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_binding collections.onboarding_bindings%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_agent agents.ai_agents%ROWTYPE;
  v_tool agents.agent_tools%ROWTYPE;
  v_now timestamptz := now();
  v_already_active boolean;
BEGIN
  SELECT * INTO v_binding
  FROM collections.onboarding_bindings
  WHERE aces_id = p_aces_id AND source_connection_id = p_source_connection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Fonte ainda nao foi preparada' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_source
  FROM collections.source_connections
  WHERE id = p_source_connection_id AND aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active' THEN
    RAISE EXCEPTION 'A fonte precisa estar ativa para iniciar os envios' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(collections.resolve_source_dispatcher(p_source_connection_id), 'paused') <> 'canonical' THEN
    RAISE EXCEPTION 'A fonte ainda nao esta pronta para a operacao canonica' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_agent
  FROM agents.ai_agents
  WHERE id = v_binding.agent_id AND aces_id = p_aces_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agente de cobranca nao encontrado' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_tool
  FROM agents.agent_tools
  WHERE id = v_binding.agent_tool_id
    AND agent_id = v_binding.agent_id
    AND aces_id = p_aces_id
    AND tool_key = 'collection_orchestration';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ferramenta de cobranca nao encontrada' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collections.agent_source_bindings b
    WHERE b.aces_id = p_aces_id
      AND b.source_connection_id = p_source_connection_id
      AND b.agent_tool_id = v_binding.agent_tool_id
      AND b.is_enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'Rota do agente de cobranca nao esta habilitada' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crm.pipelines p
    WHERE p.id = v_binding.pipeline_id AND p.aces_id = p_aces_id
  ) THEN
    RAISE EXCEPTION 'Pipeline de cobranca nao encontrado' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crm.automation_funnels f
    WHERE f.id = v_binding.funnel_id AND f.aces_id = p_aces_id AND f.entry_source = 'collection'
  ) THEN
    RAISE EXCEPTION 'Regua de cobranca nao encontrada' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collections.journey_rules r
    WHERE r.id = v_binding.journey_rule_id AND r.aces_id = p_aces_id
  ) THEN
    RAISE EXCEPTION 'Regra de cobranca nao encontrada' USING ERRCODE = '23503';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s
    WHERE s.id = v_binding.first_step_id
      AND s.funnel_id = v_binding.funnel_id
      AND NULLIF(btrim(COALESCE(s.message_template, '')), '') IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Mensagem de cobranca nao configurada' USING ERRCODE = '22023';
  END IF;

  v_already_active := v_binding.status = 'active' AND v_binding.sending_enabled IS TRUE;

  UPDATE agents.ai_agents
  SET is_active = true, updated_at = v_now
  WHERE id = v_binding.agent_id AND aces_id = p_aces_id;

  UPDATE agents.agent_tools
  SET is_enabled = true, readiness = 'ready', last_validated_at = v_now, updated_at = v_now
  WHERE id = v_binding.agent_tool_id AND aces_id = p_aces_id;

  UPDATE crm.automation_steps
  SET is_active = true, updated_at = v_now
  WHERE funnel_id = v_binding.funnel_id;

  UPDATE collections.journey_rules
  SET is_active = true, updated_at = v_now
  WHERE id = v_binding.journey_rule_id AND aces_id = p_aces_id;

  UPDATE crm.automation_funnels
  SET is_active = true, updated_at = v_now
  WHERE id = v_binding.funnel_id AND aces_id = p_aces_id;

  UPDATE collections.onboarding_bindings
  SET status = 'active', sending_enabled = true, updated_at = v_now
  WHERE id = v_binding.id;

  RETURN jsonb_build_object(
    'status', 'active',
    'sendingEnabled', true,
    'alreadyActive', v_already_active
  );
END;
$$;

CREATE OR REPLACE FUNCTION collections.set_rb_billing_state(
  p_aces_id integer,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection rb.connections%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
BEGIN
  SELECT * INTO v_connection
  FROM rb.connections
  WHERE aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conexao RB nao encontrada' USING ERRCODE = '23503';
  END IF;
  IF p_enabled AND (
    v_connection.is_active IS NOT TRUE
    OR NULLIF(btrim(v_connection.rb_token_api), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Conexao RB ativa nao encontrada' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source
  FROM collections.source_connections
  WHERE aces_id = p_aces_id
    AND source_type = 'rb'
    AND config->>'legacyConnectionId' = v_connection.id::text
  FOR UPDATE;

  IF p_enabled AND NOT FOUND THEN
    RAISE EXCEPTION 'Fonte canonica RB nao preparada' USING ERRCODE = '23503';
  END IF;

  UPDATE rb.connections
  SET billing_enabled = p_enabled, updated_at = now()
  WHERE id = v_connection.id;

  IF FOUND AND v_source.id IS NOT NULL THEN
    UPDATE collections.source_connections
    SET status = CASE WHEN p_enabled THEN 'active' ELSE 'paused' END,
        updated_at = now()
    WHERE id = v_source.id AND aces_id = p_aces_id;
  END IF;

  RETURN jsonb_build_object(
    'acesId', p_aces_id,
    'sourceId', v_source.id,
    'billingEnabled', p_enabled
  );
END;
$$;

CREATE OR REPLACE FUNCTION collections.complete_canonical_cutover(
  p_aces_id integer,
  p_source_connection_id uuid,
  p_reason text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS collections.runtime_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source collections.source_connections%ROWTYPE;
  v_runtime collections.runtime_controls%ROWTYPE;
  v_previous_dispatcher text;
BEGIN
  SELECT * INTO v_source
  FROM collections.source_connections
  WHERE id = p_source_connection_id AND aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND OR v_source.source_type <> 'rb'
     OR v_source.status <> 'active'
     OR v_source.config->>'dispatcherMode' <> 'canonical' THEN
    RAISE EXCEPTION 'Fonte RB nao esta preparada para cutover' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_runtime
  FROM collections.runtime_controls
  WHERE aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A conta deve estar pausada antes do cutover' USING ERRCODE = '22023';
  END IF;
  v_previous_dispatcher := v_runtime.active_dispatcher;
  IF v_previous_dispatcher NOT IN ('paused', 'canonical') THEN
    RAISE EXCEPTION 'A conta deve estar pausada antes do cutover' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM crm.automation_executions e
    JOIN crm.automation_funnels f ON f.id = e.funnel_id AND f.aces_id = e.aces_id
    WHERE e.aces_id = p_aces_id AND e.status = 'processing' AND f.entry_source = 'rb'
  ) THEN
    RAISE EXCEPTION 'Existem execucoes RB em processamento' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM collections.agent_source_bindings b
    JOIN agents.agent_tools t ON t.id = b.agent_tool_id AND t.aces_id = b.aces_id
    WHERE b.aces_id = p_aces_id
      AND b.source_connection_id = p_source_connection_id
      AND b.is_enabled IS TRUE
      AND t.tool_key = 'collection_orchestration'
  ) THEN
    RAISE EXCEPTION 'Nenhuma rota canonica configurada para a fonte' USING ERRCODE = '22023';
  END IF;

  UPDATE agents.agent_tools t
  SET is_enabled = true, readiness = 'ready', updated_at = now()
  FROM collections.agent_source_bindings b
  WHERE b.agent_tool_id = t.id
    AND b.aces_id = t.aces_id
    AND b.aces_id = p_aces_id
    AND b.source_connection_id = p_source_connection_id
    AND b.is_enabled IS TRUE
    AND t.tool_key = 'collection_orchestration';

  UPDATE agents.agent_tools
  SET is_enabled = false, updated_at = now()
  WHERE aces_id = p_aces_id AND tool_key = 'rb_billing';

  IF v_previous_dispatcher <> 'canonical' THEN
    INSERT INTO collections.runtime_controls (
      aces_id, active_dispatcher, changed_by, change_reason, changed_at, updated_at
    ) VALUES (
      p_aces_id, 'canonical', p_actor_id, left(COALESCE(p_reason, 'cutover RB'), 1000), now(), now()
    )
    ON CONFLICT (aces_id) DO UPDATE SET
      active_dispatcher = 'canonical', changed_by = EXCLUDED.changed_by,
      change_reason = EXCLUDED.change_reason, changed_at = now(), updated_at = now()
    RETURNING * INTO v_runtime;

    INSERT INTO collections.operational_events (aces_id, event_type, severity, actor_id, details)
    VALUES (
      p_aces_id, 'dispatcher.changed', 'info', p_actor_id,
      jsonb_build_object('activeDispatcher', 'canonical', 'sourceConnectionId', p_source_connection_id, 'reason', p_reason)
    );
  END IF;

  RETURN v_runtime;
END;
$$;

REVOKE ALL ON FUNCTION collections.rotate_source_credential(integer, uuid, text, bytea, bytea, bytea, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION collections.prepare_rb_source(integer, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION collections.activate_collection_onboarding(integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION collections.set_rb_billing_state(integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION collections.complete_canonical_cutover(integer, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.rotate_source_credential(integer, uuid, text, bytea, bytea, bytea, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION collections.prepare_rb_source(integer, uuid, jsonb, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION collections.activate_collection_onboarding(integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.set_rb_billing_state(integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION collections.complete_canonical_cutover(integer, uuid, text, uuid) TO service_role;
