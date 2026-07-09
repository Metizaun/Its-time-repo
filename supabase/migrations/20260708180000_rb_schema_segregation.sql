-- =============================================================================
-- Migration: Segregação de Schema do Registro Base (RB)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS rb;

-- Conceder permissões para os roles do Supabase no novo schema
GRANT USAGE ON SCHEMA rb TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA rb TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA rb TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA rb GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA rb GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- 1. Tabela de metadados dos devedores (RB)
CREATE TABLE IF NOT EXISTS rb.lead_metadata (
  lead_id uuid PRIMARY KEY REFERENCES crm.leads(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id),
  clie_id text,
  cpf_cnpj text,
  store_emp_id text,
  store_emp_cpf_cnpj text,
  total_amount numeric(14,2) NOT NULL DEFAULT 0.00,
  titles_count integer NOT NULL DEFAULT 0,
  titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_due_date date,
  last_sync_at timestamp with time zone,
  pix_key text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- 2. Tabela de controle de execuções de sincronismo do RB
CREATE TABLE IF NOT EXISTS rb.sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id),
  agent_tool_id uuid NOT NULL, -- FK para agents.agent_tools
  agent_id uuid NOT NULL,
  local_run_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  due_records_count integer DEFAULT 0,
  overdue_records_count integer DEFAULT 0,
  grouped_contacts_count integer DEFAULT 0,
  created_leads_count integer DEFAULT 0,
  updated_leads_count integer DEFAULT 0,
  moved_leads_count integer DEFAULT 0,
  skipped_without_phone_count integer DEFAULT 0,
  payload_summary jsonb,
  error_message text,
  created_at timestamp with time zone DEFAULT now(),
  completed_at timestamp with time zone
);

-- 3. Índices de performance no novo schema
CREATE INDEX IF NOT EXISTS idx_rb_lead_metadata_clie ON rb.lead_metadata (aces_id, clie_id);
CREATE INDEX IF NOT EXISTS idx_rb_lead_metadata_cpf ON rb.lead_metadata (aces_id, cpf_cnpj);
CREATE INDEX IF NOT EXISTS idx_rb_sync_runs_agent_date ON rb.sync_runs (agent_id, local_run_date);

-- 4. Migração de dados de runs existentes (se houver)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'crm' AND tablename = 'rb_billing_sync_runs') THEN
    INSERT INTO rb.sync_runs (
      id, aces_id, agent_tool_id, agent_id, local_run_date, status,
      due_records_count, overdue_records_count, grouped_contacts_count,
      created_leads_count, updated_leads_count, moved_leads_count,
      skipped_without_phone_count, payload_summary, error_message,
      created_at, completed_at
    )
    SELECT
      id, aces_id, agent_tool_id, agent_id, local_run_date::date, status,
      due_records_count, overdue_records_count, grouped_contacts_count,
      created_leads_count, updated_leads_count, moved_leads_count,
      skipped_without_phone_count, payload_summary, error_message,
      created_at, completed_at
    FROM crm.rb_billing_sync_runs
    ON CONFLICT (id) DO NOTHING;
  END IF;
END
$$;

-- 5. Migração de dados de leads existentes (se houver)
INSERT INTO rb.lead_metadata (
  lead_id, aces_id, clie_id, cpf_cnpj, store_emp_id, store_emp_cpf_cnpj,
  total_amount, titles_count, titles, next_due_date, last_sync_at, pix_key
)
SELECT
  id, aces_id, rb_clie_id, rb_cpf_cnpj, rb_store_emp_id, rb_store_emp_cpf_cnpj,
  COALESCE(rb_total_amount, 0.00), COALESCE(rb_titles_count, 0), COALESCE(rb_titles, '[]'::jsonb),
  rb_next_due_date, rb_last_sync_at, rb_pix_key
FROM crm.leads
WHERE rb_source = TRUE OR rb_clie_id IS NOT NULL OR rb_cpf_cnpj IS NOT NULL
ON CONFLICT (lead_id) DO UPDATE
SET
  clie_id = EXCLUDED.clie_id,
  cpf_cnpj = EXCLUDED.cpf_cnpj,
  store_emp_id = EXCLUDED.store_emp_id,
  store_emp_cpf_cnpj = EXCLUDED.store_emp_cpf_cnpj,
  total_amount = EXCLUDED.total_amount,
  titles_count = EXCLUDED.titles_count,
  titles = EXCLUDED.titles,
  next_due_date = EXCLUDED.next_due_date,
  last_sync_at = EXCLUDED.last_sync_at,
  pix_key = EXCLUDED.pix_key;

-- 6. Remoção de dependências antigas na tabela crm.leads
DROP INDEX IF EXISTS crm.idx_leads_rb_clie_id;

ALTER TABLE crm.leads
  DROP COLUMN IF EXISTS rb_source,
  DROP COLUMN IF EXISTS rb_clie_id,
  DROP COLUMN IF EXISTS rb_cpf_cnpj,
  DROP COLUMN IF EXISTS rb_store_emp_id,
  DROP COLUMN IF EXISTS rb_store_emp_cpf_cnpj,
  DROP COLUMN IF EXISTS rb_total_amount,
  DROP COLUMN IF EXISTS rb_titles_count,
  DROP COLUMN IF EXISTS rb_titles,
  DROP COLUMN IF EXISTS rb_next_due_date,
  DROP COLUMN IF EXISTS rb_last_sync_at,
  DROP COLUMN IF EXISTS rb_pix_key;

DROP TABLE IF EXISTS crm.rb_billing_sync_runs;

-- 7. Recriação da função get_automation_context para ler do novo schema
CREATE OR REPLACE FUNCTION crm.get_automation_context(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm, rb
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
    'rb', CASE
      WHEN rbm.lead_id IS NULL THEN jsonb_build_object('source', FALSE)
      ELSE jsonb_build_object(
        'source', TRUE,
        'clie_id', rbm.clie_id,
        'cpf_cnpj', rbm.cpf_cnpj,
        'store_emp_id', rbm.store_emp_id,
        'store_emp_cpf_cnpj', rbm.store_emp_cpf_cnpj,
        'total_amount', rbm.total_amount,
        'titles_count', rbm.titles_count,
        'titles', COALESCE(rbm.titles, '[]'::jsonb),
        'next_due_date', rbm.next_due_date,
        'last_sync_at', rbm.last_sync_at,
        'pix_key', rbm.pix_key
      )
    END,
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
  LEFT JOIN rb.lead_metadata rbm
    ON rbm.lead_id = l.id
  LEFT JOIN crm.lead_automation_state las
    ON las.lead_id = l.id
  WHERE l.id = p_lead_id
  LIMIT 1;
$function$;

-- 8. Recriação da procedure rpc_claim_due_automation_executions_v2
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
SET search_path TO public, crm, agents, rb
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
      rbm.pix_key AS live_rb_pix_key,
      rbm.total_amount AS live_rb_total_amount,
      rbm.next_due_date AS live_rb_next_due_date,
      rbm.titles_count AS live_rb_titles_count,
      rbm.store_emp_id AS live_rb_store_emp_id,
      rbm.store_emp_cpf_cnpj AS live_rb_store_emp_cpf_cnpj
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    LEFT JOIN rb.lead_metadata rbm ON rbm.lead_id = l.id
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
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead fora da regra de entrada', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_exit_result := crm.evaluate_automation_rule_node(
      v_execution.exit_rule,
      v_context,
      crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
    );

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead na regra de saida', updated_at = now()
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
        SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead fora da regra da mensagem', updated_at = now()
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

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      claimed_by = 'worker',
      rendered_message = v_rendered_template,
      phone_snapshot = v_execution.live_phone,
      instance_snapshot = v_execution.live_instance_name,
      lead_name_snapshot = v_execution.live_lead_name,
      city_snapshot = v_execution.live_city,
      status_snapshot = v_execution.live_status,
      funnel_name_snapshot = v_execution.live_funnel_name,
      step_label_snapshot = v_execution.step_label,
      step_rule_snapshot = v_execution.step_rule,
      anchor_at_snapshot = crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context),
      updated_at = now()
    WHERE id = v_execution.id;

    execution_id := v_execution.id;
    enrollment_id := v_execution.enrollment_id;
    lead_id := v_execution.lead_id;
    aces_id := v_execution.aces_id;
    instance_name := v_execution.live_instance_name;
    phone := v_execution.live_phone;
    lead_name := v_execution.live_lead_name;
    city := v_execution.live_city;
    lead_status := v_execution.live_status;
    template := v_rendered_template;
    step_label := v_execution.step_label;
    funnel_name := v_execution.live_funnel_name;
    scheduled_at := v_execution.scheduled_at;
    attempt_count := v_execution.attempt_count;
    content_mode := v_execution.step_content_mode;
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
