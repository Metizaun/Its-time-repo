-- Agent templates, native tools and lead BI foundation.
-- The agent domain is intentionally separated from operational CRM data.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SET LOCAL idle_in_transaction_session_timeout = '2min';

CREATE SCHEMA IF NOT EXISTS agents;
CREATE SCHEMA IF NOT EXISTS bi;

COMMENT ON SCHEMA agents IS
  'Agent identities, configuration, tools and execution state.';
COMMENT ON SCHEMA bi IS
  'Private analytical facts and projections. Not exposed to browser clients.';

REVOKE ALL ON SCHEMA agents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA bi FROM PUBLIC, anon, authenticated, authenticator;
GRANT USAGE ON SCHEMA agents TO service_role, authenticator;
GRANT USAGE ON SCHEMA bi TO service_role;

DO $$
DECLARE
  v_crm_count integer;
  v_agents_count integer;
BEGIN
  SELECT count(*)
  INTO v_crm_count
  FROM unnest(ARRAY['ai_agents', 'ai_stage_rules', 'ai_lead_state', 'ai_runs']) AS table_name
  WHERE to_regclass(format('crm.%I', table_name)) IS NOT NULL;

  SELECT count(*)
  INTO v_agents_count
  FROM unnest(ARRAY['ai_agents', 'ai_stage_rules', 'ai_lead_state', 'ai_runs']) AS table_name
  WHERE to_regclass(format('agents.%I', table_name)) IS NOT NULL;

  IF NOT ((v_crm_count = 4 AND v_agents_count = 0) OR (v_crm_count = 0 AND v_agents_count = 4)) THEN
    RAISE EXCEPTION
      'Estado invalido para migracao de agentes: crm=% agents=% (esperado 4/0 ou 0/4)',
      v_crm_count,
      v_agents_count;
  END IF;
END;
$$;

-- Keep the exact previous function definitions available during the rollback window.
CREATE TABLE IF NOT EXISTS agents._schema_rollback_artifacts (
  artifact_key text PRIMARY KEY,
  ddl text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO agents._schema_rollback_artifacts (artifact_key, ddl)
SELECT 'crm.rpc_repair_automation_ai_freezes(uuid,text)', pg_get_functiondef(oid)
FROM pg_proc
WHERE oid = to_regprocedure('crm.rpc_repair_automation_ai_freezes(uuid,text)')
ON CONFLICT (artifact_key) DO NOTHING;

INSERT INTO agents._schema_rollback_artifacts (artifact_key, ddl)
SELECT 'crm.rpc_claim_due_agent_followups(integer)', pg_get_functiondef(oid)
FROM pg_proc
WHERE oid = to_regprocedure('crm.rpc_claim_due_agent_followups(integer)')
ON CONFLICT (artifact_key) DO NOTHING;

-- Move the existing agent domain without copying rows or changing identifiers.
DO $$
BEGIN
  IF to_regclass('agents.ai_agents') IS NULL
     AND to_regclass('crm.ai_agents') IS NOT NULL THEN
    ALTER TABLE crm.ai_agents SET SCHEMA agents;
  END IF;

  IF to_regclass('agents.ai_stage_rules') IS NULL
     AND to_regclass('crm.ai_stage_rules') IS NOT NULL THEN
    ALTER TABLE crm.ai_stage_rules SET SCHEMA agents;
  END IF;

  IF to_regclass('agents.ai_lead_state') IS NULL
     AND to_regclass('crm.ai_lead_state') IS NOT NULL THEN
    ALTER TABLE crm.ai_lead_state SET SCHEMA agents;
  END IF;

  IF to_regclass('agents.ai_runs') IS NULL
     AND to_regclass('crm.ai_runs') IS NOT NULL THEN
    ALTER TABLE crm.ai_runs SET SCHEMA agents;
  END IF;
END;
$$;

ALTER TABLE agents.ai_agents
  ADD COLUMN IF NOT EXISTS template_key text,
  ADD COLUMN IF NOT EXISTS template_version integer;

-- A conversation can be served by more than one agent/instance while the lead
-- keeps its original CRM owner and primary instance.
ALTER TABLE crm.message_history
  ADD COLUMN IF NOT EXISTS sender_agent_id uuid
    REFERENCES agents.ai_agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_message_history_sender_agent
  ON crm.message_history(sender_agent_id, sent_at DESC)
  WHERE sender_agent_id IS NOT NULL;

COMMENT ON TABLE agents.ai_agents IS
  'Customer-facing agents. Lead and conversation data remain in crm.';
COMMENT ON COLUMN agents.ai_agents.model IS
  'Model used by the customer-facing agent to answer the lead. Internal workers use their own model configuration.';

CREATE TABLE IF NOT EXISTS agents.tool_definitions (
  tool_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  display_name text NOT NULL,
  description text NOT NULL,
  icon text NOT NULL,
  config_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tool_key, version),
  CONSTRAINT tool_definitions_key_check
    CHECK (tool_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT tool_definitions_version_check CHECK (version > 0),
  CONSTRAINT tool_definitions_config_schema_object_check
    CHECK (jsonb_typeof(config_schema) = 'object')
);

CREATE TABLE IF NOT EXISTS agents.agent_templates (
  template_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  display_name text NOT NULL,
  description text NOT NULL,
  niche text,
  agent_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_key, version),
  CONSTRAINT agent_templates_key_check
    CHECK (template_key ~ '^[a-z][a-z0-9-]{1,63}$'),
  CONSTRAINT agent_templates_version_check CHECK (version > 0),
  CONSTRAINT agent_templates_defaults_object_check
    CHECK (jsonb_typeof(agent_defaults) = 'object')
);

CREATE TABLE IF NOT EXISTS agents.agent_template_tools (
  template_key text NOT NULL,
  template_version integer NOT NULL,
  tool_key text NOT NULL,
  tool_version integer NOT NULL DEFAULT 1,
  display_order integer NOT NULL DEFAULT 0,
  default_enabled boolean NOT NULL DEFAULT false,
  default_readiness text NOT NULL DEFAULT 'needs_config',
  default_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_key, template_version, tool_key),
  CONSTRAINT agent_template_tools_template_fkey
    FOREIGN KEY (template_key, template_version)
    REFERENCES agents.agent_templates(template_key, version)
    ON DELETE CASCADE,
  CONSTRAINT agent_template_tools_definition_fkey
    FOREIGN KEY (tool_key, tool_version)
    REFERENCES agents.tool_definitions(tool_key, version),
  CONSTRAINT agent_template_tools_order_check CHECK (display_order >= 0),
  CONSTRAINT agent_template_tools_readiness_check
    CHECK (default_readiness IN ('ready', 'needs_config', 'unavailable')),
  CONSTRAINT agent_template_tools_config_object_check
    CHECK (jsonb_typeof(default_config) = 'object')
);

CREATE TABLE IF NOT EXISTS agents.agent_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  tool_key text NOT NULL,
  tool_version integer NOT NULL DEFAULT 1,
  is_enabled boolean NOT NULL DEFAULT false,
  readiness text NOT NULL DEFAULT 'needs_config',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_validated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tools_definition_fkey
    FOREIGN KEY (tool_key, tool_version)
    REFERENCES agents.tool_definitions(tool_key, version),
  CONSTRAINT agent_tools_agent_key_unique UNIQUE (agent_id, tool_key),
  CONSTRAINT agent_tools_readiness_check
    CHECK (readiness IN ('ready', 'needs_config', 'unavailable')),
  CONSTRAINT agent_tools_config_object_check
    CHECK (jsonb_typeof(config) = 'object'),
  CONSTRAINT agent_tools_enabled_ready_check
    CHECK (is_enabled IS FALSE OR readiness = 'ready')
);

CREATE TABLE IF NOT EXISTS agents.agent_tool_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL REFERENCES agents.agent_tools(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm.leads(id) ON DELETE SET NULL,
  tool_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  idempotency_key text,
  attempt_count integer NOT NULL DEFAULT 0,
  provider text,
  model text,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  cost_amount numeric(12,6),
  error_code text,
  error_message text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_runs_status_check
    CHECK (status IN ('queued', 'running', 'waiting_input', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT agent_tool_runs_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT agent_tool_runs_cost_check CHECK (cost_amount IS NULL OR cost_amount >= 0),
  CONSTRAINT agent_tool_runs_input_object_check
    CHECK (jsonb_typeof(input_snapshot) = 'object'),
  CONSTRAINT agent_tool_runs_output_object_check
    CHECK (jsonb_typeof(output_snapshot) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_tool_runs_idempotency
  ON agents.agent_tool_runs(aces_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_pending
  ON agents.agent_tool_runs(status, queued_at)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_agent_created
  ON agents.agent_tool_runs(agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tool_runs_lead_created
  ON agents.agent_tool_runs(lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS agents.forwarding_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL REFERENCES agents.agent_tools(id) ON DELETE CASCADE,
  destination_key text NOT NULL,
  display_name text NOT NULL,
  mode text NOT NULL,
  target_phone text,
  target_agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  context_instruction text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forwarding_destinations_key_unique
    UNIQUE (agent_tool_id, destination_key),
  CONSTRAINT forwarding_destinations_mode_check
    CHECK (mode IN ('external_notification', 'agent')),
  CONSTRAINT forwarding_destinations_target_check
    CHECK (
      (mode = 'external_notification' AND target_phone IS NOT NULL AND target_agent_id IS NULL)
      OR (mode = 'agent' AND target_agent_id IS NOT NULL AND target_phone IS NULL)
    ),
  CONSTRAINT forwarding_destinations_phone_check
    CHECK (
      target_phone IS NULL
      OR length(regexp_replace(target_phone, '\D', '', 'g')) BETWEEN 10 AND 15
    )
);

CREATE TABLE IF NOT EXISTS agents.agent_transfer_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  source_agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  target_agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  source_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active',
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  cooldown_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_transfer_sessions_distinct_agents_check
    CHECK (source_agent_id <> target_agent_id),
  CONSTRAINT agent_transfer_sessions_status_check
    CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  CONSTRAINT agent_transfer_sessions_context_object_check
    CHECK (jsonb_typeof(context_snapshot) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_transfer_sessions_active_pair
  ON agents.agent_transfer_sessions(lead_id, source_agent_id, target_agent_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_agent_transfer_sessions_target
  ON agents.agent_transfer_sessions(target_agent_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agents.tool_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL REFERENCES agents.agent_tools(id) ON DELETE CASCADE,
  asset_key text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  usage_instruction text NOT NULL DEFAULT '',
  source_type text NOT NULL DEFAULT 'https',
  source_url text NOT NULL,
  media_kind text NOT NULL,
  mime_type text,
  file_name text,
  default_caption text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_media_assets_key_unique UNIQUE (agent_tool_id, asset_key),
  CONSTRAINT tool_media_assets_key_check
    CHECK (asset_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  CONSTRAINT tool_media_assets_source_type_check
    CHECK (source_type IN ('https', 'google_drive')),
  CONSTRAINT tool_media_assets_https_check
    CHECK (lower(source_url) LIKE 'https://%'),
  CONSTRAINT tool_media_assets_kind_check
    CHECK (media_kind IN ('image', 'document'))
);

CREATE INDEX IF NOT EXISTS idx_agent_tools_aces_agent
  ON agents.agent_tools(aces_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_forwarding_destinations_aces_tool
  ON agents.forwarding_destinations(aces_id, agent_tool_id);
CREATE INDEX IF NOT EXISTS idx_tool_media_assets_aces_active
  ON agents.tool_media_assets(aces_id, agent_tool_id, is_active);

-- Lead-owned operational data remains in crm.
CREATE TABLE IF NOT EXISTS crm.lead_tool_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  tool_key text NOT NULL,
  question_key text NOT NULL,
  answer_text text,
  answer_value jsonb,
  source_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_tool_answers_unique
    UNIQUE (aces_id, lead_id, tool_key, question_key),
  CONSTRAINT lead_tool_answers_value_check
    CHECK (answer_text IS NOT NULL OR answer_value IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lead_tool_answers_lead_tool
  ON crm.lead_tool_answers(lead_id, tool_key, answered_at DESC);

CREATE TABLE IF NOT EXISTS crm.lead_instance_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  source_agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_instance_memberships_unique UNIQUE (lead_id, instance_name),
  CONSTRAINT lead_instance_memberships_revoked_check
    CHECK (is_active IS TRUE OR revoked_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lead_instance_memberships_route
  ON crm.lead_instance_memberships(aces_id, instance_name, lead_id)
  WHERE is_active IS TRUE;

-- Private BI projection tables. They contain facts, not raw media or conversations.
CREATE TABLE IF NOT EXISTS bi.lead_profiles (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  primary_instance_name text,
  profile_version integer NOT NULL DEFAULT 1,
  first_interaction_at timestamptz,
  last_interaction_at timestamptz,
  last_tool_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, lead_id),
  CONSTRAINT lead_profiles_version_check CHECK (profile_version > 0)
);

CREATE TABLE IF NOT EXISTS bi.lead_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  namespace text NOT NULL,
  fact_key text NOT NULL,
  value_type text NOT NULL,
  value_text text,
  value_numeric numeric,
  value_boolean boolean,
  value_date date,
  value_json jsonb,
  source_tool_key text,
  source_record_id uuid,
  observed_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_facts_value_type_check
    CHECK (value_type IN ('text', 'numeric', 'boolean', 'date', 'json')),
  CONSTRAINT lead_facts_single_value_check
    CHECK (
      (value_type = 'text' AND value_text IS NOT NULL AND value_numeric IS NULL AND value_boolean IS NULL AND value_date IS NULL AND value_json IS NULL)
      OR (value_type = 'numeric' AND value_text IS NULL AND value_numeric IS NOT NULL AND value_boolean IS NULL AND value_date IS NULL AND value_json IS NULL)
      OR (value_type = 'boolean' AND value_text IS NULL AND value_numeric IS NULL AND value_boolean IS NOT NULL AND value_date IS NULL AND value_json IS NULL)
      OR (value_type = 'date' AND value_text IS NULL AND value_numeric IS NULL AND value_boolean IS NULL AND value_date IS NOT NULL AND value_json IS NULL)
      OR (value_type = 'json' AND value_text IS NULL AND value_numeric IS NULL AND value_boolean IS NULL AND value_date IS NULL AND value_json IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_facts_current_unique
  ON bi.lead_facts(aces_id, lead_id, namespace, fact_key)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_lead_facts_history
  ON bi.lead_facts(lead_id, namespace, fact_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS bi.tool_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm.leads(id) ON DELETE SET NULL,
  agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  tool_run_id uuid REFERENCES agents.agent_tool_runs(id) ON DELETE SET NULL,
  tool_key text NOT NULL,
  event_name text NOT NULL,
  status text NOT NULL,
  duration_ms integer,
  cost_amount numeric(12,6),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_events_duration_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT tool_events_cost_check CHECK (cost_amount IS NULL OR cost_amount >= 0),
  CONSTRAINT tool_events_metrics_object_check CHECK (jsonb_typeof(metrics) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_events_run_event_unique
  ON bi.tool_events(tool_run_id, event_name)
  WHERE tool_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tool_events_account_time
  ON bi.tool_events(aces_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS crm.bi_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  aggregate_type text NOT NULL,
  aggregate_id uuid,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bi_outbox_event_unique UNIQUE (event_id),
  CONSTRAINT bi_outbox_status_check
    CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
  CONSTRAINT bi_outbox_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT bi_outbox_payload_object_check CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_bi_outbox_pending
  ON crm.bi_outbox(available_at, id)
  WHERE status = 'pending';

-- Seed native tools and the first modelable vertical template.
INSERT INTO agents.tool_definitions (
  tool_key, version, display_name, description, icon, config_schema
)
VALUES
  (
    'ai_audio', 1, 'Audio IA',
    'Transforma uma pequena parcela das respostas em audio natural.',
    'audio-lines',
    '{"required":["voiceId"],"properties":{"voiceId":{"type":"string"},"selectionRate":{"type":"number","default":0.018}}}'::jsonb
  ),
  (
    'forwarding', 1, 'Encaminhamento',
    'Encaminha o atendimento para uma pessoa, unidade ou outro agente.',
    'route',
    '{"properties":{"destinations":{"type":"array"}}}'::jsonb
  ),
  (
    'send_media', 1, 'Enviar midia',
    'Envia fotos e catalogos cadastrados para o lead.',
    'files',
    '{"properties":{"assets":{"type":"array"}}}'::jsonb
  ),
  (
    'prescription_analyst', 1, 'Analista',
    'Le receituarios e recomenda lentes a partir de regras cadastradas.',
    'scan-line',
    '{"properties":{"priceTableConfigured":{"type":"boolean"}}}'::jsonb
  ),
  (
    'visagism', 1, 'Visagismo',
    'Qualifica, recomenda e aplica visualmente o produto escolhido.',
    'scan-face',
    '{"properties":{"catalogConfigured":{"type":"boolean"},"workflowConfigured":{"type":"boolean"}}}'::jsonb
  )
ON CONFLICT (tool_key, version) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  config_schema = EXCLUDED.config_schema,
  is_active = true,
  updated_at = now();

INSERT INTO agents.agent_templates (
  template_key, version, display_name, description, niche, agent_defaults
)
VALUES (
  'optics-consultant',
  1,
  'Consultor para Oticas',
  'Atendimento comercial com audio humanizado, encaminhamento, catalogos, receituario e visagismo.',
  'Oticas',
  jsonb_build_object(
    'model', 'gemini-2.5-flash',
    'temperature', 0.4,
    'systemPrompt', 'Voce e o Consultor Lavie, atendimento comercial de uma otica via WhatsApp. Seja natural, consultivo e objetivo. Nao invente precos, estoque, diagnosticos ou recomendacoes clinicas. Use apenas informacoes e Tools configuradas. Faca uma pergunta por vez e encaminhe para atendimento humano quando faltar informacao ou houver questao clinica.'
  )
)
ON CONFLICT (template_key, version) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  niche = EXCLUDED.niche,
  agent_defaults = EXCLUDED.agent_defaults,
  is_active = true,
  updated_at = now();

INSERT INTO agents.agent_template_tools (
  template_key, template_version, tool_key, tool_version,
  display_order, default_enabled, default_readiness, default_config
)
VALUES
  ('optics-consultant', 1, 'ai_audio', 1, 10, false, 'needs_config', '{"selectionRate":0.018,"voiceId":null}'::jsonb),
  ('optics-consultant', 1, 'forwarding', 1, 20, false, 'needs_config', '{}'::jsonb),
  ('optics-consultant', 1, 'send_media', 1, 30, false, 'needs_config', '{}'::jsonb),
  ('optics-consultant', 1, 'prescription_analyst', 1, 40, false, 'needs_config', '{}'::jsonb),
  ('optics-consultant', 1, 'visagism', 1, 50, false, 'needs_config', '{}'::jsonb)
ON CONFLICT (template_key, template_version, tool_key) DO UPDATE
SET
  tool_version = EXCLUDED.tool_version,
  display_order = EXCLUDED.display_order,
  default_enabled = EXCLUDED.default_enabled,
  default_readiness = EXCLUDED.default_readiness,
  default_config = EXCLUDED.default_config;

-- Atomic backend entrypoint. It is SECURITY INVOKER and executable only by service_role.
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
    WHERE i.aces_id = p_aces_id
      AND i.created_by = p_created_by
      AND i.instancia = btrim(p_instance_name)
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
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

CREATE OR REPLACE FUNCTION agents.configure_agent_audio(
  p_agent_id uuid,
  p_voice_id text,
  p_selection_rate numeric DEFAULT 0.018,
  p_activate_agent boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_agent agents.ai_agents%ROWTYPE;
  v_audio_tool_id uuid;
  v_rate numeric;
BEGIN
  IF NULLIF(btrim(p_voice_id), '') IS NULL THEN
    RAISE EXCEPTION 'voice_id e obrigatorio';
  END IF;

  v_rate := COALESCE(p_selection_rate, 0.018);
  IF v_rate < 0 OR v_rate > 1 THEN
    RAISE EXCEPTION 'selection_rate deve estar entre 0 e 1';
  END IF;

  SELECT *
  INTO v_agent
  FROM agents.ai_agents
  WHERE id = p_agent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agente nao encontrado';
  END IF;

  UPDATE agents.agent_tools
  SET is_enabled = false
  WHERE agent_id = p_agent_id;

  UPDATE agents.agent_tools
  SET
    is_enabled = true,
    readiness = 'ready',
    config = jsonb_set(
      jsonb_set(COALESCE(config, '{}'::jsonb), '{voiceId}', to_jsonb(btrim(p_voice_id)), true),
      '{selectionRate}',
      to_jsonb(v_rate),
      true
    ),
    last_validated_at = now(),
    updated_at = now()
  WHERE agent_id = p_agent_id
    AND tool_key = 'ai_audio'
  RETURNING id INTO v_audio_tool_id;

  IF v_audio_tool_id IS NULL THEN
    RAISE EXCEPTION 'Tool ai_audio nao instalada no agente';
  END IF;

  UPDATE agents.ai_agents
  SET is_active = COALESCE(p_activate_agent, true), updated_at = now()
  WHERE id = p_agent_id;

  INSERT INTO crm.bi_outbox (aces_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (
    v_agent.aces_id,
    'agent',
    p_agent_id,
    'agent.audio_configured',
    jsonb_build_object(
      'agent_id', p_agent_id,
      'tool_key', 'ai_audio',
      'selection_rate', v_rate,
      'agent_active', COALESCE(p_activate_agent, true)
    )
  );

  RETURN jsonb_build_object(
    'agent_id', p_agent_id,
    'audio_tool_id', v_audio_tool_id,
    'selection_rate', v_rate,
    'agent_active', COALESCE(p_activate_agent, true)
  );
END;
$$;

REVOKE ALL ON FUNCTION agents.configure_agent_audio(uuid, text, numeric, boolean)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION agents.configure_agent_audio(uuid, text, numeric, boolean)
  TO service_role;

-- Preserve the existing handoff configuration as a forwarding Tool binding.
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
  a.aces_id,
  a.id,
  'forwarding',
  1,
  a.handoff_enabled
    AND NULLIF(btrim(a.handoff_prompt), '') IS NOT NULL
    AND NULLIF(btrim(a.handoff_target_phone), '') IS NOT NULL,
  CASE
    WHEN NULLIF(btrim(a.handoff_prompt), '') IS NOT NULL
     AND NULLIF(btrim(a.handoff_target_phone), '') IS NOT NULL
    THEN 'ready'
    ELSE 'needs_config'
  END,
  jsonb_build_object('migratedFromLegacyHandoff', true)
FROM agents.ai_agents a
WHERE a.handoff_enabled IS TRUE
   OR NULLIF(btrim(a.handoff_prompt), '') IS NOT NULL
   OR NULLIF(btrim(a.handoff_target_phone), '') IS NOT NULL
ON CONFLICT (agent_id, tool_key) DO NOTHING;

INSERT INTO agents.forwarding_destinations (
  aces_id,
  agent_tool_id,
  destination_key,
  display_name,
  mode,
  target_phone,
  context_instruction
)
SELECT
  a.aces_id,
  at.id,
  'legacy-handoff',
  'Atendimento humano',
  'external_notification',
  a.handoff_target_phone,
  a.handoff_prompt
FROM agents.ai_agents a
JOIN agents.agent_tools at
  ON at.agent_id = a.id
 AND at.tool_key = 'forwarding'
WHERE NULLIF(btrim(a.handoff_target_phone), '') IS NOT NULL
ON CONFLICT (agent_tool_id, destination_key) DO NOTHING;

-- Rebuild policies using the new schema names.
DROP POLICY IF EXISTS ai_agents_select ON agents.ai_agents;
CREATE POLICY ai_agents_select ON agents.ai_agents FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_agents_insert ON agents.ai_agents;
CREATE POLICY ai_agents_insert ON agents.ai_agents FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_agents_update ON agents.ai_agents;
CREATE POLICY ai_agents_update ON agents.ai_agents FOR UPDATE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_agents_delete ON agents.ai_agents;
CREATE POLICY ai_agents_delete ON agents.ai_agents FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_stage_rules_select ON agents.ai_stage_rules;
CREATE POLICY ai_stage_rules_select ON agents.ai_stage_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM agents.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_stage_rules_insert ON agents.ai_stage_rules;
CREATE POLICY ai_stage_rules_insert ON agents.ai_stage_rules FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agents.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_stage_rules_update ON agents.ai_stage_rules;
CREATE POLICY ai_stage_rules_update ON agents.ai_stage_rules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM agents.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM agents.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_stage_rules_delete ON agents.ai_stage_rules;
CREATE POLICY ai_stage_rules_delete ON agents.ai_stage_rules FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM agents.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_lead_state_select ON agents.ai_lead_state;
CREATE POLICY ai_lead_state_select ON agents.ai_lead_state FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS ai_runs_select ON agents.ai_runs;
CREATE POLICY ai_runs_select ON agents.ai_runs FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

ALTER TABLE agents.tool_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.agent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.agent_template_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.agent_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.agent_tool_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.forwarding_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.agent_transfer_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.tool_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_tool_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_instance_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.bi_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE bi.lead_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bi.lead_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE bi.tool_events ENABLE ROW LEVEL SECURITY;

-- New domain tables are backend-only in V1. Browser access goes through the backend.
REVOKE ALL ON ALL TABLES IN SCHEMA agents FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA agents FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON ALL TABLES IN SCHEMA bi FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA bi FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON crm.lead_tool_answers, crm.lead_instance_memberships, crm.bi_outbox
  FROM PUBLIC, anon, authenticated, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agents TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bi TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bi TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON crm.lead_tool_answers, crm.lead_instance_memberships, crm.bi_outbox
  TO service_role;
GRANT USAGE, SELECT ON SEQUENCE crm.bi_outbox_id_seq TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA agents
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, authenticator;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA agents
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA agents
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA bi
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, authenticator;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA bi
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA bi
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

-- Updated-at triggers for new mutable tables.
DROP TRIGGER IF EXISTS trg_tool_definitions_updated_at ON agents.tool_definitions;
CREATE TRIGGER trg_tool_definitions_updated_at
BEFORE UPDATE ON agents.tool_definitions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_agent_templates_updated_at ON agents.agent_templates;
CREATE TRIGGER trg_agent_templates_updated_at
BEFORE UPDATE ON agents.agent_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_agent_tools_updated_at ON agents.agent_tools;
CREATE TRIGGER trg_agent_tools_updated_at
BEFORE UPDATE ON agents.agent_tools
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_agent_tool_runs_updated_at ON agents.agent_tool_runs;
CREATE TRIGGER trg_agent_tool_runs_updated_at
BEFORE UPDATE ON agents.agent_tool_runs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_forwarding_destinations_updated_at ON agents.forwarding_destinations;
CREATE TRIGGER trg_forwarding_destinations_updated_at
BEFORE UPDATE ON agents.forwarding_destinations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_agent_transfer_sessions_updated_at ON agents.agent_transfer_sessions;
CREATE TRIGGER trg_agent_transfer_sessions_updated_at
BEFORE UPDATE ON agents.agent_transfer_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_tool_media_assets_updated_at ON agents.tool_media_assets;
CREATE TRIGGER trg_tool_media_assets_updated_at
BEFORE UPDATE ON agents.tool_media_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_lead_tool_answers_updated_at ON crm.lead_tool_answers;
CREATE TRIGGER trg_lead_tool_answers_updated_at
BEFORE UPDATE ON crm.lead_tool_answers
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_lead_instance_memberships_updated_at ON crm.lead_instance_memberships;
CREATE TRIGGER trg_lead_instance_memberships_updated_at
BEFORE UPDATE ON crm.lead_instance_memberships
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_bi_lead_profiles_updated_at ON bi.lead_profiles;
CREATE TRIGGER trg_bi_lead_profiles_updated_at
BEFORE UPDATE ON bi.lead_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Functions whose PL/pgSQL bodies referenced the previous crm table names.
CREATE OR REPLACE FUNCTION crm.rpc_repair_automation_ai_freezes(
  p_lead_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_state record;
  v_repaired integer := 0;
  v_claims text;
  v_request_role text;
BEGIN
  v_request_role := current_setting('request.jwt.claim.role', TRUE);
  v_claims := NULLIF(current_setting('request.jwt.claims', TRUE), '');

  IF v_request_role IS NULL AND v_claims IS NOT NULL THEN
    v_request_role := v_claims::jsonb->>'role';
  END IF;

  IF v_request_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Apenas o backend pode reparar freezes da IA';
  END IF;

  FOR v_state IN
    SELECT
      als.agent_id,
      als.lead_id,
      als.pause_origin,
      als.pause_reference,
      COALESCE(als.paused_at, als.updated_at) AS paused_anchor_at
    FROM agents.ai_lead_state als
    JOIN agents.ai_agents ag ON ag.id = als.agent_id
    WHERE als.status = 'paused'
      AND als.freeze_until IS NOT NULL
      AND als.freeze_until > now()
      AND COALESCE(als.manual_ai_enabled, TRUE) = TRUE
      AND (p_lead_id IS NULL OR als.lead_id = p_lead_id)
      AND COALESCE(als.pause_origin, 'human_webhook') NOT IN ('manual_send', 'manual_override', 'ai_policy')
      AND EXISTS (
        SELECT 1
        FROM crm.message_history human_echo
        JOIN crm.message_history automation_msg
          ON automation_msg.lead_id = human_echo.lead_id
         AND automation_msg.direction = 'outbound'
         AND COALESCE(automation_msg.instance, '') = COALESCE(human_echo.instance, '')
         AND btrim(COALESCE(automation_msg.content, '')) = btrim(COALESCE(human_echo.content, ''))
         AND automation_msg.sent_at BETWEEN human_echo.sent_at - interval '10 minutes'
                                            AND human_echo.sent_at + interval '10 minutes'
         AND (
           automation_msg.source_type IN ('automation', 'ai')
           OR COALESCE(automation_msg.conversation_id, '') LIKE 'automation:%'
         )
        WHERE human_echo.lead_id = als.lead_id
          AND human_echo.direction = 'outbound'
          AND human_echo.source_type = 'human'
          AND human_echo.created_by IS NULL
          AND human_echo.sent_at >= COALESCE(als.paused_at, als.updated_at) - interval '10 minutes'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM crm.message_history manual_msg
        WHERE manual_msg.lead_id = als.lead_id
          AND manual_msg.direction = 'outbound'
          AND manual_msg.source_type = 'human'
          AND manual_msg.created_by IS NOT NULL
          AND manual_msg.sent_at >= COALESCE(als.paused_at, als.updated_at) - interval '10 minutes'
          AND manual_msg.sent_at <= COALESCE(als.freeze_until, now()) + interval '10 minutes'
      )
  LOOP
    UPDATE agents.ai_lead_state
    SET
      freeze_until = NULL,
      status = 'active',
      pause_origin = NULL,
      pause_reference = NULL,
      paused_at = NULL,
      updated_at = now()
    WHERE agent_id = v_state.agent_id
      AND lead_id = v_state.lead_id;

    INSERT INTO agents.ai_runs (
      agent_id,
      lead_id,
      input_snapshot,
      output_snapshot,
      action_taken
    )
    VALUES (
      v_state.agent_id,
      v_state.lead_id,
      jsonb_build_object(
        'reason', 'automation_echo_freeze_repair',
        'previous_pause_origin', v_state.pause_origin,
        'previous_pause_reference', v_state.pause_reference
      ),
      jsonb_build_object(
        'repaired', TRUE,
        'reference', COALESCE(p_reference, 'automation_repair')
      ),
      'freeze_repair'
    );

    v_repaired := v_repaired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'repaired', v_repaired,
    'lead_id', p_lead_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_claim_due_agent_followups(p_limit integer DEFAULT 25)
RETURNS TABLE (
  task_id uuid,
  aces_id integer,
  lead_id uuid,
  agent_id uuid,
  due_at timestamptz,
  requested_text text,
  message_text text,
  attempt_count integer,
  lead_name text,
  lead_phone text,
  instance_name text,
  agent_name text,
  agent_active boolean,
  agent_model text,
  manual_ai_enabled boolean,
  freeze_until timestamptz,
  last_lead_inbound_at timestamptz
)
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_limit integer;
BEGIN
  IF COALESCE(p_limit, 25) <= 0 THEN
    RETURN;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);

  RETURN QUERY
  WITH candidates AS (
    SELECT t.id
    FROM crm.follow_up_tasks t
    WHERE t.source = 'agent_followup'
      AND t.status = 'pending'
      AND t.completed IS NOT TRUE
      AND t.due_at <= v_now
      AND (
        t.last_attempt_at IS NULL
        OR t.last_attempt_at <= v_now - interval '5 minutes'
      )
    ORDER BY t.due_at ASC, t.created_at ASC, t.id ASC
    LIMIT v_limit
    FOR UPDATE OF t SKIP LOCKED
  ),
  claimed AS (
    UPDATE crm.follow_up_tasks t
    SET
      status = 'processing',
      attempt_count = t.attempt_count + 1,
      last_attempt_at = v_now,
      last_error = NULL,
      metadata = jsonb_set(
        jsonb_set(
          COALESCE(t.metadata, '{}'::jsonb),
          '{last_claimed_at}',
          to_jsonb(v_now::text),
          true
        ),
        '{claim_count}',
        to_jsonb(t.attempt_count + 1),
        true
      )
    FROM candidates c
    WHERE t.id = c.id
    RETURNING t.*
  )
  SELECT
    c.id AS task_id,
    c.aces_id,
    c.lead_id,
    c.agent_id,
    c.due_at,
    c.requested_text,
    c.message_text,
    c.attempt_count,
    l.name::text AS lead_name,
    l.contact_phone::text AS lead_phone,
    COALESCE(a.instance_name, l.instancia)::text AS instance_name,
    a.name::text AS agent_name,
    COALESCE(a.is_active, false) AS agent_active,
    a.model::text AS agent_model,
    als.manual_ai_enabled,
    als.freeze_until,
    (
      SELECT max(mh.sent_at)
      FROM crm.message_history mh
      WHERE mh.lead_id = c.lead_id
        AND mh.source_type = 'lead'
    ) AS last_lead_inbound_at
  FROM claimed c
  JOIN crm.leads l ON l.id = c.lead_id
  LEFT JOIN agents.ai_agents a ON a.id = c.agent_id
  LEFT JOIN agents.ai_lead_state als
    ON als.agent_id = c.agent_id
   AND als.lead_id = c.lead_id;
END;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_repair_automation_ai_freezes(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_agent_followups(integer) TO service_role;

-- Projects outbox events using the caller privileges. The function is intentionally
-- SECURITY INVOKER and only service_role can execute it.
CREATE OR REPLACE FUNCTION crm.rpc_project_bi_outbox_batch(p_limit integer DEFAULT 100)
RETURNS integer
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_event crm.bi_outbox%ROWTYPE;
  v_processed integer := 0;
  v_lead_id uuid;
  v_agent_id uuid;
  v_tool_run_id uuid;
  v_tool_key text;
  v_status text;
  v_error text;
BEGIN
  IF COALESCE(p_limit, 100) <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_event IN
    SELECT o.*
    FROM crm.bi_outbox o
    WHERE o.status = 'pending'
      AND o.available_at <= now()
    ORDER BY o.available_at, o.id
    LIMIT LEAST(GREATEST(p_limit, 1), 500)
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      IF v_event.event_type LIKE 'tool.%' THEN
        v_lead_id := NULLIF(v_event.payload->>'lead_id', '')::uuid;
        v_agent_id := NULLIF(v_event.payload->>'agent_id', '')::uuid;
        v_tool_run_id := COALESCE(
          CASE WHEN v_event.aggregate_type = 'tool_run' THEN v_event.aggregate_id ELSE NULL END,
          NULLIF(v_event.payload->>'tool_run_id', '')::uuid
        );
        v_tool_key := COALESCE(
          NULLIF(v_event.payload->>'tool_key', ''),
          split_part(v_event.event_type, '.', 2)
        );
        v_status := COALESCE(
          NULLIF(v_event.payload->>'status', ''),
          CASE
            WHEN v_event.event_type LIKE '%.succeeded' THEN 'succeeded'
            WHEN v_event.event_type LIKE '%.failed' THEN 'failed'
            WHEN v_event.event_type LIKE '%.fallback_to_text' THEN 'fallback'
            WHEN COALESCE((v_event.payload->>'selected')::boolean, false) THEN 'selected'
            ELSE 'not_selected'
          END
        );

        IF v_lead_id IS NOT NULL
           AND EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = v_lead_id) THEN
          INSERT INTO bi.lead_profiles (
            aces_id,
            lead_id,
            primary_instance_name,
            first_interaction_at,
            last_interaction_at,
            last_tool_key
          )
          SELECT
            v_event.aces_id,
            l.id,
            l.instancia,
            COALESCE(l.created_at, v_event.created_at),
            v_event.created_at,
            v_tool_key
          FROM crm.leads l
          WHERE l.id = v_lead_id
            AND l.aces_id = v_event.aces_id
          ON CONFLICT (aces_id, lead_id) DO UPDATE
          SET
            profile_version = bi.lead_profiles.profile_version + 1,
            primary_instance_name = COALESCE(EXCLUDED.primary_instance_name, bi.lead_profiles.primary_instance_name),
            last_interaction_at = GREATEST(
              COALESCE(bi.lead_profiles.last_interaction_at, '-infinity'::timestamptz),
              COALESCE(EXCLUDED.last_interaction_at, '-infinity'::timestamptz)
            ),
            last_tool_key = EXCLUDED.last_tool_key,
            updated_at = now();
        ELSE
          v_lead_id := NULL;
        END IF;

        IF v_agent_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM agents.ai_agents a WHERE a.id = v_agent_id) THEN
          v_agent_id := NULL;
        END IF;

        IF v_tool_run_id IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM agents.agent_tool_runs r WHERE r.id = v_tool_run_id) THEN
          v_tool_run_id := NULL;
        END IF;

        INSERT INTO bi.tool_events (
          event_id,
          aces_id,
          lead_id,
          agent_id,
          tool_run_id,
          tool_key,
          event_name,
          status,
          duration_ms,
          cost_amount,
          metrics,
          occurred_at
        )
        VALUES (
          v_event.event_id,
          v_event.aces_id,
          v_lead_id,
          v_agent_id,
          v_tool_run_id,
          v_tool_key,
          v_event.event_type,
          v_status,
          NULLIF(v_event.payload->>'duration_ms', '')::integer,
          NULLIF(v_event.payload->>'cost_amount', '')::numeric,
          v_event.payload,
          v_event.created_at
        )
        ON CONFLICT DO NOTHING;
      END IF;

      UPDATE crm.bi_outbox
      SET
        status = 'processed',
        processed_at = now(),
        locked_at = NULL,
        last_error = NULL
      WHERE id = v_event.id;

      v_processed := v_processed + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_error = MESSAGE_TEXT;
      UPDATE crm.bi_outbox
      SET
        status = CASE WHEN attempt_count + 1 >= 5 THEN 'failed' ELSE 'pending' END,
        attempt_count = attempt_count + 1,
        available_at = now() + make_interval(secs => LEAST(300, 5 * (attempt_count + 1))),
        locked_at = NULL,
        last_error = left(v_error, 1000)
      WHERE id = v_event.id;
    END;
  END LOOP;

  RETURN v_processed;
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_project_bi_outbox_batch(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.rpc_project_bi_outbox_batch(integer) TO service_role;

-- The project keeps an explicit PostgREST override on the authenticator role.
-- Add agents to the existing list; bi intentionally remains private.
ALTER ROLE authenticator SET pgrst.db_schemas = 'public,storage,graphql_public,crm,meta,calendar,agents';
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

COMMIT;
