CREATE TABLE IF NOT EXISTS crm.instance_access_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  access_level text NOT NULL DEFAULT 'editor',
  granted_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  grant_reason text,
  is_active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instance_access_memberships_unique UNIQUE (instance_name, crm_user_id),
  CONSTRAINT instance_access_memberships_access_level_check
    CHECK (access_level IN ('viewer', 'editor', 'admin')),
  CONSTRAINT instance_access_memberships_revoked_check
    CHECK (is_active IS TRUE OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_instance_access_memberships_route
  ON crm.instance_access_memberships(aces_id, crm_user_id, instance_name)
  WHERE is_active IS TRUE;

CREATE INDEX IF NOT EXISTS idx_instance_access_memberships_instance
  ON crm.instance_access_memberships(aces_id, instance_name, is_active);

ALTER TABLE crm.instance_access_memberships ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_instance_access_memberships_updated_at ON crm.instance_access_memberships;
CREATE TRIGGER trg_instance_access_memberships_updated_at
BEFORE UPDATE ON crm.instance_access_memberships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON crm.instance_access_memberships FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.instance_access_memberships TO service_role;

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

  IF NOT EXISTS (
    SELECT 1
    FROM crm.instance i
    LEFT JOIN crm.instance_access_memberships iam
      ON iam.aces_id = i.aces_id
     AND iam.instance_name = i.instancia
     AND iam.crm_user_id = p_created_by
     AND iam.is_active IS TRUE
    WHERE i.aces_id = p_aces_id
      AND i.instancia = btrim(p_instance_name)
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND (
        i.created_by = p_created_by
        OR iam.id IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'Instancia nao pertence ao usuario atual';
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
