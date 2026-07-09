ALTER TABLE crm.automation_funnels
  ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'conditions';

ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS rb_message_kind text,
  ADD COLUMN IF NOT EXISTS rb_days_offset integer,
  ADD COLUMN IF NOT EXISTS rb_payment_type_ids jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_funnels_entry_source_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels
      ADD CONSTRAINT automation_funnels_entry_source_check
      CHECK (entry_source IN ('conditions', 'rb'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_rb_message_kind_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_rb_message_kind_check
      CHECK (rb_message_kind IS NULL OR rb_message_kind IN ('reminder', 'charge'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_rb_payment_type_ids_array_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_rb_payment_type_ids_array_check
      CHECK (jsonb_typeof(rb_payment_type_ids) = 'array');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_rb_config_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_rb_config_check
      CHECK (
        rb_message_kind IS NULL
        OR (
          rb_days_offset IS NOT NULL
          AND rb_days_offset >= 0
        )
      );
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_automation_funnels_entry_source
  ON crm.automation_funnels(aces_id, instance_name, entry_source)
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_automation_steps_rb_message_kind
  ON crm.automation_steps(funnel_id, rb_message_kind, rb_days_offset)
  WHERE rb_message_kind IS NOT NULL;

UPDATE agents.tool_definitions
SET
  description = 'Sincroniza titulos do Registro Base e injeta os leads nas automacoes de cobranca do CRM.',
  config_schema = '{
    "required": ["rb_token_api", "rb_empresa_ids"],
    "properties": {
      "rb_mode": { "type": "string", "enum": ["live", "mock"], "default": "live" },
      "rb_base_url": { "type": "string", "default": "https://app.registrobase.com.br:32077" },
      "rb_token_api": { "type": "string" },
      "rb_empresa_ids": { "type": "array", "items": { "type": "string" } },
      "pix_mapping_by_store": { "type": "object" },
      "gupshup_defaults": { "type": "object" },
      "trigger_time": { "type": "string", "default": "10:00" },
      "timezone": { "type": "string", "default": "America/Sao_Paulo" },
      "is_dr_oculos_bootstrap": { "type": "boolean", "default": false },
      "last_run_on_local_date": { "type": "string" }
    }
  }'::jsonb,
  updated_at = now()
WHERE tool_key = 'rb_billing'
  AND version = 1;

DELETE FROM agents.agent_template_tools
WHERE template_key = 'optics-consultant'
  AND template_version = 1
  AND tool_key = 'rb_billing';

ALTER TABLE agents.agent_templates
  DROP CONSTRAINT IF EXISTS agent_templates_key_check;

ALTER TABLE agents.agent_templates
  ADD CONSTRAINT agent_templates_key_check
  CHECK (template_key ~ '^[a-z][a-z0-9_-]{1,63}$');

INSERT INTO agents.agent_templates (
  template_key,
  version,
  display_name,
  description,
  niche,
  agent_defaults
)
VALUES (
  'cobranca_rb',
  1,
  'Cobranca com Registro Base',
  'Agente focado em cobranca com audio e sincronismo via Registro Base.',
  'Cobranca',
  jsonb_build_object(
    'model', 'gemini-2.5-flash',
    'temperature', 0.35,
    'systemPrompt', 'Voce atua em cobranca via WhatsApp com linguagem respeitosa, objetiva e profissional. Nao invente valores, descontos ou acordos. Use apenas os dados recebidos do CRM e respeite o contexto de cada lead.'
  )
)
ON CONFLICT (template_key, version) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  niche = EXCLUDED.niche,
  agent_defaults = EXCLUDED.agent_defaults,
  is_active = TRUE,
  updated_at = now();

INSERT INTO agents.agent_template_tools (
  template_key,
  template_version,
  tool_key,
  tool_version,
  display_order,
  default_enabled,
  default_readiness,
  default_config
)
VALUES
  (
    'cobranca_rb',
    1,
    'ai_audio',
    1,
    10,
    FALSE,
    'needs_config',
    '{"selectionRate":0.018,"voiceId":null}'::jsonb
  ),
  (
    'cobranca_rb',
    1,
    'rb_billing',
    1,
    20,
    FALSE,
    'needs_config',
    '{"rb_mode":"live","rb_base_url":"https://app.registrobase.com.br:32077","trigger_time":"10:00","timezone":"America/Sao_Paulo","pix_mapping_by_store":{},"gupshup_defaults":{},"rb_empresa_ids":[]}'::jsonb
  )
ON CONFLICT (template_key, template_version, tool_key) DO UPDATE
SET
  tool_version = EXCLUDED.tool_version,
  display_order = EXCLUDED.display_order,
  default_enabled = EXCLUDED.default_enabled,
  default_readiness = EXCLUDED.default_readiness,
  default_config = EXCLUDED.default_config;

UPDATE agents.agent_tools
SET
  config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
    'rb_mode', COALESCE(NULLIF(config->>'rb_mode', ''), 'live'),
    'rb_base_url', COALESCE(NULLIF(config->>'rb_base_url', ''), 'https://app.registrobase.com.br:32077'),
    'rb_token_api', COALESCE(config->>'rb_token_api', ''),
    'rb_empresa_ids',
      CASE
        WHEN jsonb_typeof(config->'rb_empresa_ids') = 'array' THEN config->'rb_empresa_ids'
        ELSE '[]'::jsonb
      END,
    'pix_mapping_by_store',
      CASE
        WHEN jsonb_typeof(config->'pix_mapping_by_store') = 'object' THEN config->'pix_mapping_by_store'
        ELSE '{}'::jsonb
      END,
    'gupshup_defaults',
      CASE
        WHEN jsonb_typeof(config->'gupshup_defaults') = 'object' THEN config->'gupshup_defaults'
        ELSE '{}'::jsonb
      END,
    'trigger_time', COALESCE(NULLIF(config->>'trigger_time', ''), '10:00'),
    'timezone', COALESCE(NULLIF(config->>'timezone', ''), 'America/Sao_Paulo'),
    'is_dr_oculos_bootstrap', COALESCE((config->>'is_dr_oculos_bootstrap')::boolean, FALSE),
    'last_run_on_local_date', NULLIF(config->>'last_run_on_local_date', '')
  ),
  updated_at = now()
WHERE tool_key = 'rb_billing';

UPDATE crm.automation_funnels
SET entry_source = 'rb'
WHERE aces_id = 5
  AND name LIKE 'RB Dr Oculos - %';

UPDATE crm.automation_steps AS step
SET
  rb_message_kind = 'reminder',
  rb_days_offset = 2,
  rb_payment_type_ids = '["6"]'::jsonb
FROM crm.automation_funnels AS funnel
WHERE step.funnel_id = funnel.id
  AND funnel.aces_id = 5
  AND funnel.name = 'RB Dr Oculos - A vencer (2 dias)'
  AND step.position = 0;

UPDATE crm.automation_steps AS step
SET
  rb_message_kind = 'reminder',
  rb_days_offset = 0,
  rb_payment_type_ids = '["6"]'::jsonb
FROM crm.automation_funnels AS funnel
WHERE step.funnel_id = funnel.id
  AND funnel.aces_id = 5
  AND funnel.name = 'RB Dr Oculos - Vence hoje'
  AND step.position = 0;

UPDATE crm.automation_steps AS step
SET
  rb_message_kind = 'charge',
  rb_days_offset = 1,
  rb_payment_type_ids = '["6"]'::jsonb
FROM crm.automation_funnels AS funnel
WHERE step.funnel_id = funnel.id
  AND funnel.aces_id = 5
  AND funnel.name = 'RB Dr Oculos - Atrasado 1 dia'
  AND step.position = 0;

UPDATE crm.automation_steps AS step
SET
  rb_message_kind = 'charge',
  rb_days_offset = 4,
  rb_payment_type_ids = '["6"]'::jsonb
FROM crm.automation_funnels AS funnel
WHERE step.funnel_id = funnel.id
  AND funnel.aces_id = 5
  AND funnel.name = 'RB Dr Oculos - Cobranca suave 4 dias'
  AND step.position = 0;

UPDATE crm.automation_steps AS step
SET
  rb_message_kind = 'charge',
  rb_days_offset = 15,
  rb_payment_type_ids = '["6"]'::jsonb
FROM crm.automation_funnels AS funnel
WHERE step.funnel_id = funnel.id
  AND funnel.aces_id = 5
  AND funnel.name = 'RB Dr Oculos - Cobranca critica 15 dias'
  AND step.position = 0;
