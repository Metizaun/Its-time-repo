-- RB billing integration: tool definition, sync audit, lead fields and automation placeholders.

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS rb_source boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rb_clie_id text,
  ADD COLUMN IF NOT EXISTS rb_cpf_cnpj text,
  ADD COLUMN IF NOT EXISTS rb_store_emp_id text,
  ADD COLUMN IF NOT EXISTS rb_store_emp_cpf_cnpj text,
  ADD COLUMN IF NOT EXISTS rb_total_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS rb_titles_count integer,
  ADD COLUMN IF NOT EXISTS rb_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rb_next_due_date date,
  ADD COLUMN IF NOT EXISTS rb_last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS rb_pix_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_rb_titles_array_check'
      AND conrelid = 'crm.leads'::regclass
  ) THEN
    ALTER TABLE crm.leads
      ADD CONSTRAINT leads_rb_titles_array_check
      CHECK (jsonb_typeof(rb_titles) = 'array');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_leads_rb_clie_id
  ON crm.leads(aces_id, rb_clie_id)
  WHERE rb_clie_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_rb_cpf_cnpj
  ON crm.leads(aces_id, rb_cpf_cnpj)
  WHERE rb_cpf_cnpj IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_leads_rb_store_emp_id
  ON crm.leads(aces_id, rb_store_emp_id)
  WHERE rb_store_emp_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm.rb_billing_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL REFERENCES agents.agent_tools(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  local_run_date date NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  due_records_count integer NOT NULL DEFAULT 0 CHECK (due_records_count >= 0),
  overdue_records_count integer NOT NULL DEFAULT 0 CHECK (overdue_records_count >= 0),
  grouped_contacts_count integer NOT NULL DEFAULT 0 CHECK (grouped_contacts_count >= 0),
  created_leads_count integer NOT NULL DEFAULT 0 CHECK (created_leads_count >= 0),
  updated_leads_count integer NOT NULL DEFAULT 0 CHECK (updated_leads_count >= 0),
  moved_leads_count integer NOT NULL DEFAULT 0 CHECK (moved_leads_count >= 0),
  skipped_without_phone_count integer NOT NULL DEFAULT 0 CHECK (skipped_without_phone_count >= 0),
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rb_billing_sync_runs_payload_summary_object_check
    CHECK (jsonb_typeof(payload_summary) = 'object'),
  CONSTRAINT rb_billing_sync_runs_unique_per_day
    UNIQUE (agent_tool_id, local_run_date)
);

CREATE INDEX IF NOT EXISTS idx_rb_billing_sync_runs_agent_date
  ON crm.rb_billing_sync_runs(agent_id, local_run_date DESC);

ALTER TABLE crm.rb_billing_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rb_billing_sync_runs_service_only ON crm.rb_billing_sync_runs;
CREATE POLICY rb_billing_sync_runs_service_only
ON crm.rb_billing_sync_runs
FOR ALL
USING (false)
WITH CHECK (false);

DROP TRIGGER IF EXISTS trg_rb_billing_sync_runs_updated_at ON crm.rb_billing_sync_runs;
CREATE TRIGGER trg_rb_billing_sync_runs_updated_at
BEFORE UPDATE ON crm.rb_billing_sync_runs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO agents.tool_definitions (
  tool_key,
  version,
  display_name,
  description,
  icon,
  config_schema
)
VALUES (
  'rb_billing',
  1,
  'Cobranca RB',
  'Sincroniza titulos do Registro Base, move o lead no pipeline e reaproveita as automacoes do CRM.',
  'wallet',
  '{
    "required": ["rb_base_url", "rb_empresa_ids", "pipeline_id", "trigger_time", "timezone", "stage_mapping"],
    "properties": {
      "rb_mode": { "type": "string", "enum": ["live", "mock"], "default": "live" },
      "rb_base_url": { "type": "string" },
      "rb_token_api": { "type": "string" },
      "rb_empresa_ids": { "type": "array", "items": { "type": "string" } },
      "pipeline_id": { "type": "string" },
      "trigger_time": { "type": "string" },
      "timezone": { "type": "string", "default": "America/Sao_Paulo" },
      "dispatch_mode": { "type": "string", "enum": ["punctual", "humanized"], "default": "humanized" },
      "stage_mapping": { "type": "object" },
      "pix_mapping_by_store": { "type": "object" },
      "gupshup_defaults": { "type": "object" },
      "is_dr_oculos_bootstrap": { "type": "boolean", "default": false },
      "last_run_on_local_date": { "type": "string" }
    }
  }'::jsonb
)
ON CONFLICT (tool_key, version) DO UPDATE
SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  config_schema = EXCLUDED.config_schema,
  is_active = true,
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
VALUES (
  'optics-consultant',
  1,
  'rb_billing',
  1,
  35,
  false,
  'needs_config',
  '{"rb_mode":"live","dispatch_mode":"humanized","timezone":"America/Sao_Paulo","stage_mapping":{},"pix_mapping_by_store":{},"gupshup_defaults":{},"rb_empresa_ids":[]}'::jsonb
)
ON CONFLICT (template_key, template_version, tool_key) DO UPDATE
SET
  tool_version = EXCLUDED.tool_version,
  display_order = EXCLUDED.display_order,
  default_enabled = EXCLUDED.default_enabled,
  default_readiness = EXCLUDED.default_readiness,
  default_config = EXCLUDED.default_config;

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
  'rb_billing',
  1,
  false,
  'needs_config',
  '{"rb_mode":"live","dispatch_mode":"humanized","timezone":"America/Sao_Paulo","stage_mapping":{},"pix_mapping_by_store":{},"gupshup_defaults":{},"rb_empresa_ids":[]}'::jsonb
FROM agents.ai_agents a
WHERE a.template_key = 'optics-consultant'
  AND COALESCE(a.template_version, 1) = 1
  AND NOT EXISTS (
    SELECT 1
    FROM agents.agent_tools t
    WHERE t.agent_id = a.id
      AND t.tool_key = 'rb_billing'
  );

CREATE OR REPLACE FUNCTION crm.get_automation_context(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
  SELECT jsonb_build_object(
    'lead_id', l.id,
    'aces_id', l.aces_id,
    'stage_id', l.stage_id,
    'status', l.status,
    'owner_id', l.owner_id,
    'instance_name', l.instancia,
    'view', COALESCE(l.view, TRUE),
    'contact_phone', l.contact_phone,
    'rb', jsonb_build_object(
      'source', COALESCE(l.rb_source, FALSE),
      'clie_id', l.rb_clie_id,
      'cpf_cnpj', l.rb_cpf_cnpj,
      'store_emp_id', l.rb_store_emp_id,
      'store_emp_cpf_cnpj', l.rb_store_emp_cpf_cnpj,
      'total_amount', l.rb_total_amount,
      'titles_count', l.rb_titles_count,
      'titles', COALESCE(l.rb_titles, '[]'::jsonb),
      'next_due_date', l.rb_next_due_date,
      'last_sync_at', l.rb_last_sync_at,
      'pix_key', l.rb_pix_key
    ),
    'state', jsonb_build_object(
      'current_stage_id', las.current_stage_id,
      'stage_entered_at', las.stage_entered_at,
      'last_direction', las.last_direction,
      'last_message_id', las.last_message_id,
      'last_message_at', las.last_message_at,
      'last_outbound_at', las.last_outbound_at,
      'last_inbound_at', las.last_inbound_at,
      'last_outbound_message_id', las.last_outbound_message_id,
      'last_inbound_message_id', las.last_inbound_message_id,
      'last_reply_at', las.last_reply_at
    )
  )
  FROM crm.leads l
  LEFT JOIN crm.lead_automation_state las
    ON las.lead_id = l.id
  WHERE l.id = p_lead_id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION crm.render_automation_message_template(
  p_template text,
  p_lead_name text,
  p_phone text,
  p_city text,
  p_status text,
  p_rb_pix_key text,
  p_rb_total_amount numeric,
  p_rb_next_due_date date,
  p_rb_titles_count integer,
  p_rb_store_emp_id text,
  p_rb_store_emp_cpf_cnpj text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_rendered text := COALESCE(p_template, '');
  v_company text := crm.normalize_automation_business_name(p_lead_name);
  v_rb_total_amount text := CASE
    WHEN p_rb_total_amount IS NULL THEN ''
    ELSE to_char(p_rb_total_amount, 'FM999G999G999G990D00')
  END;
  v_rb_next_due_date text := CASE
    WHEN p_rb_next_due_date IS NULL THEN ''
    ELSE to_char(p_rb_next_due_date, 'DD/MM/YYYY')
  END;
BEGIN
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*empresas?[[:space:]]*[\}\]]', v_company, 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*nome[[:space:]]*[\}\]]', COALESCE(p_lead_name, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*telefone[[:space:]]*[\}\]]', COALESCE(p_phone, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*cidade[[:space:]]*[\}\]]', COALESCE(p_city, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*status[[:space:]]*[\}\]]', COALESCE(p_status, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*rb_pix_key[[:space:]]*[\}\]]', COALESCE(p_rb_pix_key, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*rb_total_amount[[:space:]]*[\}\]]', COALESCE(v_rb_total_amount, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*rb_next_due_date[[:space:]]*[\}\]]', COALESCE(v_rb_next_due_date, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*rb_titles_count[[:space:]]*[\}\]]', COALESCE(p_rb_titles_count, 0)::text, 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*rb_store_emp_id[[:space:]]*[\}\]]', COALESCE(p_rb_store_emp_id, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*rb_store_emp_cpf_cnpj[[:space:]]*[\}\]]', COALESCE(p_rb_store_emp_cpf_cnpj, ''), 'gi');

  RETURN v_rendered;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.render_automation_text_or_null(
  p_template text,
  p_lead_name text,
  p_phone text,
  p_city text,
  p_status text,
  p_rb_pix_key text,
  p_rb_total_amount numeric,
  p_rb_next_due_date date,
  p_rb_titles_count integer,
  p_rb_store_emp_id text,
  p_rb_store_emp_cpf_cnpj text
)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_template, '')), '') IS NULL THEN NULL
    ELSE crm.render_automation_message_template(
      p_template,
      p_lead_name,
      p_phone,
      p_city,
      p_status,
      p_rb_pix_key,
      p_rb_total_amount,
      p_rb_next_due_date,
      p_rb_titles_count,
      p_rb_store_emp_id,
      p_rb_store_emp_cpf_cnpj
    )
  END;
$function$;

DROP FUNCTION IF EXISTS crm.rpc_claim_due_automation_executions_v2(integer);

CREATE OR REPLACE FUNCTION crm.rpc_claim_due_automation_executions_v2(p_limit integer DEFAULT 50)
RETURNS TABLE (
  execution_id uuid,
  enrollment_id uuid,
  lead_id uuid,
  aces_id integer,
  instance_name text,
  phone text,
  lead_name text,
  city text,
  lead_status text,
  template text,
  step_label text,
  funnel_name text,
  scheduled_at timestamptz,
  attempt_count integer,
  content_mode text,
  media_asset_id uuid,
  media_kind text,
  media_caption text,
  media_source_url text,
  media_mime_type text,
  media_file_name text,
  gupshup_template_id text,
  gupshup_template_name text,
  gupshup_template_language text,
  gupshup_template_params jsonb,
  rb_pix_key text,
  rb_total_amount numeric,
  rb_next_due_date date,
  rb_titles_count integer,
  rb_store_emp_id text,
  rb_store_emp_cpf_cnpj text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm, agents
AS $function$
DECLARE
  v_due record;
  v_execution record;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
  v_step_result jsonb;
  v_rendered_template text;
  v_rendered_caption text;
  v_reason text;
BEGIN
  FOR v_due IN
    SELECT ae.id
    FROM crm.automation_executions ae
    WHERE ae.status = 'pending'
      AND ae.scheduled_at <= now()
    ORDER BY ae.scheduled_at ASC, ae.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT
      ae.*,
      s.message_template,
      s.is_active AS step_is_active,
      s.step_rule,
      COALESCE(ae.content_mode_snapshot, s.content_mode, 'text') AS step_content_mode,
      COALESCE(ae.media_asset_id_snapshot, s.media_asset_id) AS media_asset_id,
      COALESCE(ae.media_kind_snapshot, s.media_kind) AS media_kind,
      COALESCE(ae.media_caption_snapshot, s.media_caption) AS media_caption,
      COALESCE(ae.media_source_url_snapshot, ma.source_url) AS media_source_url,
      COALESCE(ae.media_mime_type_snapshot, ma.mime_type) AS media_mime_type,
      COALESCE(ae.media_file_name_snapshot, ma.file_name) AS media_file_name,
      CASE WHEN ae.media_source_url_snapshot IS NOT NULL THEN TRUE ELSE ma.is_active END AS media_is_active,
      COALESCE(ae.gupshup_template_id_snapshot, s.gupshup_template_id) AS gupshup_template_id,
      COALESCE(ae.gupshup_template_name_snapshot, s.gupshup_template_name) AS gupshup_template_name,
      COALESCE(ae.gupshup_template_language_snapshot, s.gupshup_template_language, 'pt_BR') AS gupshup_template_language,
      COALESCE(ae.gupshup_template_params_snapshot, s.gupshup_template_params, '[]'::jsonb) AS gupshup_template_params,
      f.is_active AS funnel_is_active,
      f.entry_rule,
      f.exit_rule,
      f.anchor_event,
      f.name AS live_funnel_name,
      f.reply_target_stage_id,
      f.instance_name AS live_instance_name,
      l.name AS live_lead_name,
      l.contact_phone AS live_phone,
      l.last_city AS live_city,
      l.status AS live_status,
      l.view AS lead_visible,
      l.rb_pix_key AS live_rb_pix_key,
      l.rb_total_amount AS live_rb_total_amount,
      l.rb_next_due_date AS live_rb_next_due_date,
      l.rb_titles_count AS live_rb_titles_count,
      l.rb_store_emp_id AS live_rb_store_emp_id,
      l.rb_store_emp_cpf_cnpj AS live_rb_store_emp_cpf_cnpj
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    LEFT JOIN crm.automation_media_assets ma ON ma.id = COALESCE(ae.media_asset_id_snapshot, s.media_asset_id)
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_execution.funnel_is_active IS DISTINCT FROM TRUE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Automacao inativa', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    IF v_execution.step_is_active IS DISTINCT FROM TRUE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Mensagem inativa', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_context := crm.get_automation_context(v_execution.lead_id);

    IF v_context IS NULL OR COALESCE((v_context->>'view')::boolean, TRUE) = FALSE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead invisivel ou inexistente', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(
      v_execution.entry_rule,
      v_context,
      crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
    );

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead saiu da regra de entrada', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_exit_result := crm.evaluate_automation_rule_node(
      v_execution.exit_rule,
      v_context,
      crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
    );

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      PERFORM crm.stop_automation_enrollment(
        v_execution.enrollment_id,
        'completed',
        'Regra de saida atendida',
        TRUE
      );
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Regra de saida atendida', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    IF v_execution.step_rule IS NOT NULL THEN
      v_step_result := crm.evaluate_automation_rule_node(
        v_execution.step_rule,
        v_context,
        crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
      );

      IF COALESCE((v_step_result->>'matched')::boolean, FALSE) = FALSE THEN
        UPDATE crm.automation_executions
        SET status = 'cancelled', cancelled_at = now(), last_error = 'Regra adicional da mensagem nao atendida', updated_at = now()
        WHERE id = v_execution.id;
        CONTINUE;
      END IF;
    END IF;

    v_rendered_template := crm.render_automation_text_or_null(
      v_execution.message_template,
      v_execution.live_lead_name,
      v_execution.live_phone,
      v_execution.live_city,
      v_execution.live_status,
      v_execution.live_rb_pix_key,
      v_execution.live_rb_total_amount,
      v_execution.live_rb_next_due_date,
      v_execution.live_rb_titles_count,
      v_execution.live_rb_store_emp_id,
      v_execution.live_rb_store_emp_cpf_cnpj
    );

    v_rendered_caption := crm.render_automation_text_or_null(
      v_execution.media_caption,
      v_execution.live_lead_name,
      v_execution.live_phone,
      v_execution.live_city,
      v_execution.live_status,
      v_execution.live_rb_pix_key,
      v_execution.live_rb_total_amount,
      v_execution.live_rb_next_due_date,
      v_execution.live_rb_titles_count,
      v_execution.live_rb_store_emp_id,
      v_execution.live_rb_store_emp_cpf_cnpj
    );

    IF COALESCE(v_execution.step_content_mode, 'text') = 'text'
      AND crm.has_unresolved_automation_template_vars(COALESCE(v_rendered_template, '')) THEN
      v_reason := 'Mensagem contem variavel nao resolvida';
      UPDATE crm.automation_executions
      SET status = 'failed', last_error = v_reason, attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    IF COALESCE(v_execution.step_content_mode, 'text') = 'media'
      AND crm.has_unresolved_automation_template_vars(COALESCE(v_rendered_caption, '')) THEN
      v_reason := 'Legenda contem variavel nao resolvida';
      UPDATE crm.automation_executions
      SET status = 'failed', last_error = v_reason, attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    IF COALESCE(v_execution.step_content_mode, 'text') = 'media'
      AND (v_execution.media_asset_id IS NULL OR v_execution.media_kind IS NULL OR v_execution.media_is_active IS DISTINCT FROM TRUE) THEN
      v_reason := 'Midia da automacao indisponivel';
      UPDATE crm.automation_executions
      SET status = 'failed', last_error = v_reason, attempt_count = attempt_count + 1, updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      rendered_message = CASE
        WHEN COALESCE(v_execution.step_content_mode, 'text') = 'media' THEN v_rendered_caption
        ELSE v_rendered_template
      END,
      attempt_count = attempt_count + 1,
      updated_at = now()
    WHERE id = v_execution.id;

    execution_id := v_execution.id;
    enrollment_id := v_execution.enrollment_id;
    lead_id := v_execution.lead_id;
    aces_id := v_execution.aces_id;
    instance_name := COALESCE(v_execution.live_instance_name, v_execution.instance_snapshot);
    phone := COALESCE(v_execution.live_phone, v_execution.phone_snapshot);
    lead_name := COALESCE(v_execution.live_lead_name, v_execution.lead_name_snapshot);
    city := COALESCE(v_execution.live_city, v_execution.city_snapshot);
    lead_status := COALESCE(v_execution.live_status, v_execution.status_snapshot);
    template := v_execution.message_template;
    step_label := COALESCE(v_execution.step_label_snapshot, v_execution.step_label);
    funnel_name := COALESCE(v_execution.live_funnel_name, v_execution.funnel_name_snapshot);
    scheduled_at := v_execution.scheduled_at;
    attempt_count := v_execution.attempt_count + 1;
    content_mode := COALESCE(v_execution.step_content_mode, 'text');
    media_asset_id := v_execution.media_asset_id;
    media_kind := v_execution.media_kind;
    media_caption := v_rendered_caption;
    media_source_url := v_execution.media_source_url;
    media_mime_type := v_execution.media_mime_type;
    media_file_name := v_execution.media_file_name;
    gupshup_template_id := v_execution.gupshup_template_id;
    gupshup_template_name := v_execution.gupshup_template_name;
    gupshup_template_language := v_execution.gupshup_template_language;
    gupshup_template_params := v_execution.gupshup_template_params;
    rb_pix_key := v_execution.live_rb_pix_key;
    rb_total_amount := v_execution.live_rb_total_amount;
    rb_next_due_date := v_execution.live_rb_next_due_date;
    rb_titles_count := v_execution.live_rb_titles_count;
    rb_store_emp_id := v_execution.live_rb_store_emp_id;
    rb_store_emp_cpf_cnpj := v_execution.live_rb_store_emp_cpf_cnpj;

    RETURN NEXT;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.render_automation_message_template(
  text, text, text, text, text, text, numeric, date, integer, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION crm.render_automation_text_or_null(
  text, text, text, text, text, text, numeric, date, integer, text, text
) TO service_role;

GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;
