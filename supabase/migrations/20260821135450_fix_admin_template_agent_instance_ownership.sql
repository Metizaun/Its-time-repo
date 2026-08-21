-- Bug: agents.create_agent_from_template() re-checks instance ownership with a
-- stricter rule (crm.instance.created_by = p_created_by OR explicit
-- instance_access_memberships row) than the application-level gate in
-- sdr-agent-gemini.ts's ensureInstanceOwnership(), which already lets ANY
-- ADMIN of the account attach an agent to ANY instance of that account,
-- skipping the created_by/membership check entirely for admins.
--
-- Accounts with more than one ADMIN user (each owning different WhatsApp
-- instances, e.g. aces_id 7: "Instituto" owned by one admin,
-- "Saudeperfeita" owned by another) hit this mismatch: the instance picker
-- happily lists every instance of the account for any admin, but creating an
-- agent FROM A TEMPLATE on an instance owned by a different admin always
-- fails with "Instancia nao pertence ao usuario atual", surfaced to the
-- browser as the generic "Nao foi possivel criar o agente pelo template"
-- (sdr-agent-gemini.ts wraps every RPC error with that same message).
-- Creating an agent WITHOUT a template on the same instance works fine,
-- since that path never re-validates ownership after ensureInstanceOwnership.
--
-- Fix: by the time this function reaches the instance check, it has already
-- confirmed p_created_by is an ADMIN of p_aces_id (see the "Usuario nao
-- autorizado a criar agentes" check above). Match ensureInstanceOwnership's
-- behavior and only require the instance to belong to the same account and
-- not be cancelled — the extra created_by/membership match served no one
-- once admin-ness is already established.

CREATE OR REPLACE FUNCTION agents.create_agent_from_template(
  p_aces_id integer,
  p_created_by uuid,
  p_instance_name text,
  p_name text,
  p_system_prompt text,
  p_model text DEFAULT 'gemini-2.5-flash',
  p_temperature numeric DEFAULT 0.4,
  p_template_key text DEFAULT NULL,
  p_is_active boolean DEFAULT true
)
RETURNS agents.ai_agents
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_template agents.agent_templates%ROWTYPE;
  v_agent agents.ai_agents%ROWTYPE;
BEGIN
  IF NULLIF(btrim(p_name), '') IS NULL THEN
    RAISE EXCEPTION 'Nome do agente e obrigatorio';
  END IF;

  IF NULLIF(btrim(p_instance_name), '') IS NULL THEN
    RAISE EXCEPTION 'Instancia do agente e obrigatoria';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.users u
    WHERE u.id = p_created_by
      AND u.aces_id = p_aces_id
      AND u.role = 'ADMIN'::crm.user_role
  ) THEN
    RAISE EXCEPTION 'Usuario nao autorizado a criar agentes';
  END IF;

  -- p_created_by is a verified ADMIN of p_aces_id at this point (checked
  -- above), so match ensureInstanceOwnership()'s admin bypass: any instance
  -- of the same account is eligible, regardless of who originally created it.
  IF NOT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.aces_id = p_aces_id
      AND i.instancia = btrim(p_instance_name)
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Instancia nao pertence a esta conta';
  END IF;

  IF NULLIF(btrim(p_template_key), '') IS NOT NULL THEN
    SELECT *
    INTO v_template
    FROM agents.agent_templates t
    WHERE t.template_key = btrim(p_template_key)
      AND t.is_active IS TRUE
    ORDER BY t.version DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Template de agente nao encontrado';
    END IF;
  END IF;

  INSERT INTO agents.ai_agents (
    aces_id,
    instance_name,
    name,
    system_prompt,
    provider,
    model,
    temperature,
    is_active,
    created_by,
    template_key,
    template_version
  )
  VALUES (
    p_aces_id,
    btrim(p_instance_name),
    btrim(p_name),
    COALESCE(
      NULLIF(btrim(p_system_prompt), ''),
      NULLIF(btrim(v_template.agent_defaults->>'systemPrompt'), ''),
      'Voce e um agente comercial via WhatsApp. Responda de forma natural, util e segura.'
    ),
    'gemini',
    COALESCE(NULLIF(btrim(p_model), ''), 'gemini-2.5-flash'),
    LEAST(GREATEST(COALESCE(p_temperature, 0.4), 0.1), 0.8),
    COALESCE(p_is_active, true),
    p_created_by,
    CASE WHEN v_template.template_key IS NULL THEN NULL ELSE v_template.template_key END,
    CASE WHEN v_template.template_key IS NULL THEN NULL ELSE v_template.version END
  )
  RETURNING * INTO v_agent;

  IF v_template.template_key IS NOT NULL THEN
    INSERT INTO agents.agent_tools (
      aces_id,
      agent_id,
      tool_key,
      tool_version,
      is_enabled,
      readiness,
      config
    )
    SELECT
      p_aces_id,
      v_agent.id,
      tt.tool_key,
      tt.tool_version,
      tt.default_enabled,
      tt.default_readiness,
      tt.default_config
    FROM agents.agent_template_tools tt
    WHERE tt.template_key = v_template.template_key
      AND tt.template_version = v_template.version
    ORDER BY tt.display_order;
  END IF;

  INSERT INTO crm.bi_outbox (
    aces_id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
  )
  VALUES (
    p_aces_id,
    'agent',
    v_agent.id,
    'agent.created',
    jsonb_build_object(
      'agent_id', v_agent.id,
      'template_key', v_agent.template_key,
      'template_version', v_agent.template_version
    )
  );

  RETURN v_agent;
END;
$$;

REVOKE ALL ON FUNCTION agents.create_agent_from_template(integer, uuid, text, text, text, text, numeric, text, boolean)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION agents.create_agent_from_template(integer, uuid, text, text, text, text, numeric, text, boolean)
  TO service_role;
;
