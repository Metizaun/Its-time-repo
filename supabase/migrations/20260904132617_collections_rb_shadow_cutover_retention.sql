-- Safe RB shadow migration, guarded cutover and spreadsheet retention.
-- This migration is additive because the previously applied collections
-- migrations are frozen.

ALTER TABLE collections.spreadsheet_imports
  ADD COLUMN IF NOT EXISTS storage_deleted_at timestamptz;
ALTER TABLE collections.runtime_controls
  ADD COLUMN IF NOT EXISTS business_timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

CREATE OR REPLACE FUNCTION collections.account_business_timezone(p_aces_id integer)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT business_timezone FROM collections.runtime_controls WHERE aces_id = p_aces_id), 'America/Sao_Paulo');
$$;

CREATE OR REPLACE FUNCTION collections.set_account_business_timezone(
  p_aces_id integer,
  p_timezone text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = p_timezone) THEN
    RAISE EXCEPTION 'Timezone de negocio invalida';
  END IF;
  INSERT INTO collections.runtime_controls (aces_id, business_timezone, changed_by, change_reason)
  VALUES (p_aces_id, p_timezone, p_actor_id, 'Timezone de negocio atualizada')
  ON CONFLICT (aces_id) DO UPDATE SET business_timezone = EXCLUDED.business_timezone,
    changed_by = EXCLUDED.changed_by, change_reason = EXCLUDED.change_reason, updated_at = now();
  RETURN p_timezone;
END;
$$;

CREATE TABLE collections.rb_funnel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  legacy_funnel_id uuid NOT NULL,
  canonical_funnel_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rb_funnel_mappings_source_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT rb_funnel_mappings_legacy_tenant_fkey
    FOREIGN KEY (legacy_funnel_id, aces_id)
    REFERENCES crm.automation_funnels(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT rb_funnel_mappings_canonical_tenant_fkey
    FOREIGN KEY (canonical_funnel_id, aces_id)
    REFERENCES crm.automation_funnels(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT rb_funnel_mappings_legacy_unique UNIQUE (legacy_funnel_id),
  CONSTRAINT rb_funnel_mappings_canonical_unique UNIQUE (canonical_funnel_id)
);

ALTER TABLE collections.rb_funnel_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collections.rb_funnel_mappings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections.rb_funnel_mappings TO service_role;

CREATE OR REPLACE FUNCTION collections.canonicalize_rb_template(p_template text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE v_result text := p_template;
BEGIN
  IF v_result IS NULL THEN RETURN NULL; END IF;
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*rb_total_amount[[:space:]]*(\}|\])', '{collection.total_open_amount}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*rb_titles_count[[:space:]]*(\}|\])', '{collection.open_receivables_count}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*rb_next_due_date[[:space:]]*(\}|\])', '{collection.oldest_due_date}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*rb_pix_key[[:space:]]*(\}|\])', '{collection.pix_key}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*rb_store_emp_cpf_cnpj[[:space:]]*(\}|\])', '{collection.creditor_document}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*rb_store_emp_id[[:space:]]*(\}|\])', '{collection.creditor_name}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*pix[[:space:]]*(\}|\])', '{collection.pix_key}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*(vencimento|dtvencimento|data)[[:space:]]*(\}|\])', '{collection.oldest_due_date}', 'gi');
  v_result := regexp_replace(v_result, '(\{|\[)[[:space:]]*(valor|vl_liquido|valor_liquido)[[:space:]]*(\}|\])', '{collection.total_open_amount}', 'gi');
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION collections.clone_rb_funnel_for_shadow(
  p_aces_id integer,
  p_source_connection_id uuid,
  p_legacy_funnel_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_legacy crm.automation_funnels%ROWTYPE;
  v_existing uuid;
  v_canonical_id uuid;
  v_rule_id uuid;
  v_first_step record;
  v_relation text;
  v_days integer;
  v_name text;
BEGIN
  SELECT canonical_funnel_id INTO v_existing
  FROM collections.rb_funnel_mappings
  WHERE legacy_funnel_id = p_legacy_funnel_id AND aces_id = p_aces_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;

  SELECT * INTO v_legacy FROM crm.automation_funnels
  WHERE id = p_legacy_funnel_id AND aces_id = p_aces_id AND entry_source = 'rb'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funil RB nao encontrado para a conta'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collections.source_connections
    WHERE id = p_source_connection_id AND aces_id = p_aces_id AND source_type = 'rb'
  ) THEN RAISE EXCEPTION 'Fonte RB canonica nao encontrada para a conta'; END IF;

  SELECT s.rb_message_kind, s.rb_days_offset INTO v_first_step
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_legacy.id AND s.rb_message_kind IS NOT NULL
  ORDER BY s.position, s.created_at, s.id LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funil RB sem configuracao financeira'; END IF;
  v_days := GREATEST(COALESCE(v_first_step.rb_days_offset, 0), 0);
  v_relation := CASE WHEN v_first_step.rb_message_kind = 'charge' THEN 'after_due'
    WHEN v_days = 0 THEN 'on_due' ELSE 'before_due' END;
  v_name := left(v_legacy.name || ' (Canônico)', 240);
  IF EXISTS (SELECT 1 FROM crm.automation_funnels WHERE aces_id = p_aces_id AND name = v_name) THEN
    v_name := left(v_legacy.name, 190) || ' (Canônico ' || left(p_legacy_funnel_id::text, 8) || ')';
  END IF;

  INSERT INTO crm.automation_funnels (
    aces_id, name, trigger_stage_id, instance_name, is_active, created_by,
    entry_rule, exit_rule, anchor_event, reentry_mode, reply_target_stage_id,
    builder_version, humanized_dispatch_enabled, dispatch_limit_per_hour,
    humanized_dispatch_window_start, humanized_dispatch_window_end,
    entry_source, daily_dispatch_enabled, daily_dispatch_time,
    daily_dispatch_weekends_enabled, trigger_event_status
  ) VALUES (
    p_aces_id, v_name, v_legacy.trigger_stage_id, v_legacy.instance_name,
    v_legacy.is_active, v_legacy.created_by, v_legacy.entry_rule,
    v_legacy.exit_rule, COALESCE(v_legacy.anchor_event, 'stage_entered_at'),
    COALESCE(v_legacy.reentry_mode, 'ignore_if_active'), v_legacy.reply_target_stage_id,
    v_legacy.builder_version, v_legacy.humanized_dispatch_enabled,
    v_legacy.dispatch_limit_per_hour, v_legacy.humanized_dispatch_window_start,
    v_legacy.humanized_dispatch_window_end, 'collection',
    v_legacy.daily_dispatch_enabled, v_legacy.daily_dispatch_time,
    v_legacy.daily_dispatch_weekends_enabled, NULL
  ) RETURNING id INTO v_canonical_id;

  INSERT INTO crm.automation_steps (
    funnel_id, position, label, delay_minutes, message_template, channel,
    is_active, created_by, step_rule, content_mode, media_asset_id, media_kind,
    media_caption, gupshup_template_id, gupshup_template_name,
    gupshup_template_language, gupshup_template_params,
    rb_message_kind, rb_days_offset, rb_payment_type_ids
  )
  SELECT v_canonical_id, s.position, s.label, s.delay_minutes,
    collections.canonicalize_rb_template(s.message_template),
    s.channel, s.is_active, s.created_by, s.step_rule, s.content_mode,
    s.media_asset_id, s.media_kind, s.media_caption, s.gupshup_template_id,
    s.gupshup_template_name, s.gupshup_template_language,
    s.gupshup_template_params, NULL, NULL, '[]'::jsonb
  FROM crm.automation_steps s WHERE s.funnel_id = v_legacy.id
  ORDER BY s.position, s.created_at, s.id;

  INSERT INTO collections.journey_rules (
    aces_id, funnel_id, timing_relation, days_offset, priority,
    financial_statuses, payment_methods, is_active
  ) VALUES (
    p_aces_id, v_canonical_id, v_relation, v_days, 100,
    '["open"]'::jsonb, '[]'::jsonb, v_legacy.is_active
  ) RETURNING id INTO v_rule_id;
  INSERT INTO collections.journey_source_bindings (
    journey_rule_id, source_connection_id, aces_id
  ) VALUES (v_rule_id, p_source_connection_id, p_aces_id);
  INSERT INTO collections.rb_funnel_mappings (
    aces_id, source_connection_id, legacy_funnel_id, canonical_funnel_id
  ) VALUES (p_aces_id, p_source_connection_id, p_legacy_funnel_id, v_canonical_id);

  RETURN v_canonical_id;
EXCEPTION WHEN unique_violation THEN
  SELECT canonical_funnel_id INTO v_existing
  FROM collections.rb_funnel_mappings
  WHERE legacy_funnel_id = p_legacy_funnel_id AND aces_id = p_aces_id;
  IF v_existing IS NOT NULL THEN RETURN v_existing; END IF;
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION collections.activate_canonical_dispatcher_after_cutover(
  p_aces_id integer,
  p_reason text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS collections.runtime_controls
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_result collections.runtime_controls;
BEGIN
  IF COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = p_aces_id), 'legacy_rb') <> 'paused' THEN
    RAISE EXCEPTION 'A conta deve estar pausada antes do cutover';
  END IF;
  IF EXISTS (
    SELECT 1 FROM crm.automation_executions e
    JOIN crm.automation_funnels f ON f.id = e.funnel_id AND f.aces_id = e.aces_id
    WHERE e.aces_id = p_aces_id AND e.status = 'processing' AND f.entry_source = 'rb'
  ) THEN RAISE EXCEPTION 'Existem execucoes RB em processamento'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM collections.agent_source_bindings b
    JOIN agents.agent_tools t ON t.id = b.agent_tool_id AND t.aces_id = b.aces_id
    WHERE b.aces_id = p_aces_id AND b.is_enabled AND t.tool_key = 'collection_orchestration'
      AND t.is_enabled AND t.readiness = 'ready'
  ) THEN RAISE EXCEPTION 'Nenhuma rota canonica ativa e pronta'; END IF;

  INSERT INTO collections.runtime_controls (aces_id, active_dispatcher, changed_by, change_reason, changed_at)
  VALUES (p_aces_id, 'canonical', p_actor_id, left(COALESCE(p_reason, 'cutover RB'), 1000), now())
  ON CONFLICT (aces_id) DO UPDATE SET active_dispatcher = 'canonical',
    changed_by = EXCLUDED.changed_by, change_reason = EXCLUDED.change_reason,
    changed_at = now(), updated_at = now()
  RETURNING * INTO v_result;
  INSERT INTO collections.operational_events (aces_id, event_type, severity, actor_id, details)
  VALUES (p_aces_id, 'dispatcher.changed', 'info', p_actor_id,
    jsonb_build_object('activeDispatcher', 'canonical', 'reason', p_reason));
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION collections.claim_expired_spreadsheet_imports(p_limit integer DEFAULT 100)
RETURNS SETOF collections.spreadsheet_imports
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.spreadsheet_imports i SET status = 'expired', updated_at = now()
  FROM (
    SELECT id FROM collections.spreadsheet_imports
    WHERE expires_at <= now() AND storage_deleted_at IS NULL AND status <> 'publishing'
    ORDER BY expires_at, id LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
    FOR UPDATE SKIP LOCKED
  ) due
  WHERE i.id = due.id RETURNING i.*;
$$;

CREATE OR REPLACE FUNCTION collections.complete_import_file_retention(p_import_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.spreadsheet_imports
  SET storage_deleted_at = now(), status = 'expired', updated_at = now()
  WHERE id = p_import_id AND storage_deleted_at IS NULL
  RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION collections.clear_expired_import_error_details()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE collections.spreadsheet_imports SET
    failure_summary = '{}'::jsonb,
    preview_summary = preview_summary - 'errors' - 'sample',
    updated_at = now()
  WHERE error_details_expires_at IS NOT NULL AND error_details_expires_at <= now()
    AND (failure_summary <> '{}'::jsonb OR preview_summary ? 'errors' OR preview_summary ? 'sample');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION collections.get_collection_context_authorized(
  p_aces_id integer,
  p_agent_tool_id uuid,
  p_lead_id uuid,
  p_case_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_case collections.cases%ROWTYPE;
BEGIN
  SELECT * INTO v_case FROM collections.cases
  WHERE id = p_case_id AND aces_id = p_aces_id AND lead_id = p_lead_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM agents.agent_tools t
    JOIN collections.agent_source_bindings b
      ON b.agent_tool_id = t.id AND b.aces_id = t.aces_id AND b.is_enabled
    WHERE t.id = p_agent_tool_id AND t.aces_id = p_aces_id
      AND t.tool_key = 'collection_orchestration' AND t.is_enabled AND t.readiness = 'ready'
      AND b.source_connection_id = v_case.source_connection_id
      AND (b.creditor_external_id IS NULL OR b.creditor_external_id = v_case.creditor_external_id)
  ) THEN RAISE EXCEPTION 'Contexto de cobranca nao autorizado'; END IF;
  RETURN collections.get_collection_context(p_lead_id, p_case_id);
END;
$$;

CREATE OR REPLACE FUNCTION collections.get_execution_dispatch_context(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_case collections.cases%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_route jsonb;
  v_tool_id uuid;
  v_context jsonb;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Execucao nao encontrada'; END IF;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('collection', FALSE, 'action', 'continue');
  END IF;
  SELECT * INTO v_case FROM collections.cases
  WHERE id = v_execution.source_collection_case_id AND aces_id = v_execution.aces_id;
  SELECT * INTO v_source FROM collections.source_connections
  WHERE id = v_case.source_connection_id AND aces_id = v_case.aces_id;
  IF v_case.id IS NULL OR v_source.id IS NULL
     OR v_source.status <> 'active' OR v_case.source_freshness <> 'fresh'
     OR v_case.communication_status IN ('paused', 'in_service', 'completed', 'stale', 'error')
     OR v_case.open_receivables_count <= 0
     OR EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = v_case.lead_id AND l.aces_id = v_case.aces_id
       AND (l.view IS DISTINCT FROM TRUE OR lower(btrim(COALESCE(l.status::text, ''))) IN ('atendimento', 'em atendimento')))
     OR EXISTS (SELECT 1 FROM agents.ai_lead_state als WHERE als.lead_id = v_case.lead_id
       AND (als.manual_ai_enabled IS FALSE OR als.status = 'paused' OR als.freeze_until > now()))
     OR EXISTS (SELECT 1 FROM collections.contact_communication_controls cc
       WHERE cc.aces_id = v_case.aces_id
         AND cc.normalized_phone_hash = encode(extensions.digest(regexp_replace(v_case.customer_phone, '[^0-9]', '', 'g'), 'sha256'), 'hex')
         AND cc.status <> 'active')
     OR COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = v_case.aces_id), 'legacy_rb') <> 'canonical' THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_case_not_eligible');
  END IF;

  v_route := collections.get_case_route_status(v_case.id);
  IF v_route->>'status' <> 'resolved' THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_route_not_resolved');
  END IF;
  v_tool_id := (v_route->>'agentToolId')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM agents.agent_tools t
    JOIN agents.ai_agents a ON a.id = t.agent_id AND a.aces_id = t.aces_id
    WHERE t.id = v_tool_id AND t.aces_id = v_case.aces_id
      AND t.tool_key = 'collection_orchestration' AND t.is_enabled AND t.readiness = 'ready'
      AND a.is_active AND a.instance_name = v_execution.instance_snapshot
  ) THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_route_not_authorized');
  END IF;
  v_context := collections.get_collection_context_authorized(
    v_case.aces_id, v_tool_id, v_case.lead_id, v_case.id
  );
  RETURN jsonb_build_object('collection', TRUE, 'action', 'continue', 'caseId', v_case.id,
    'timezone', v_source.timezone, 'context', v_context);
END;
$$;

-- A retry that crosses midnight must keep the reservation owned by the same
-- execution. Without this lookup the unique execution constraint would defer
-- that execution forever after a provider failure near midnight.
CREATE OR REPLACE FUNCTION collections.reserve_collection_dispatch(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_case collections.cases%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_phone_hash text;
  v_local_date date;
  v_existing collections.contact_daily_dispatches%ROWTYPE;
  v_decision_key text;
  v_defer_until timestamptz;
  v_business_timezone text;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Execucao nao encontrada'; END IF;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('reserved', TRUE, 'collection', FALSE);
  END IF;
  SELECT * INTO v_existing FROM collections.contact_daily_dispatches
  WHERE execution_id = p_execution_id;
  IF FOUND THEN
    RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', TRUE,
      'reservedLocalDate', v_existing.local_date);
  END IF;

  SELECT * INTO v_case FROM collections.cases
  WHERE id = v_execution.source_collection_case_id AND aces_id = v_execution.aces_id;
  SELECT * INTO v_source FROM collections.source_connections
  WHERE id = v_case.source_connection_id AND aces_id = v_case.aces_id;
  IF v_case.id IS NULL OR v_source.id IS NULL THEN RAISE EXCEPTION 'Caso de cobranca invalido'; END IF;
  v_phone_hash := encode(extensions.digest(regexp_replace(v_case.customer_phone, '[^0-9]', '', 'g'), 'sha256'), 'hex');
  v_business_timezone := collections.account_business_timezone(v_case.aces_id);
  v_local_date := (now() AT TIME ZONE v_business_timezone)::date;
  v_decision_key := COALESCE((SELECT source_collection_decision_key FROM crm.automation_enrollments
    WHERE id = v_execution.enrollment_id), 'execution:' || p_execution_id::text);

  SELECT * INTO v_existing FROM collections.contact_daily_dispatches
  WHERE aces_id = v_case.aces_id AND normalized_phone_hash = v_phone_hash AND local_date = v_local_date;
  IF FOUND THEN
    v_defer_until := ((v_local_date + 1)::date + time '09:00') AT TIME ZONE v_business_timezone;
    RETURN jsonb_build_object('reserved', FALSE, 'collection', TRUE,
      'reason', 'deferred_contact_daily_limit', 'deferUntil', v_defer_until);
  END IF;
  INSERT INTO collections.contact_daily_dispatches (
    aces_id, normalized_phone_hash, local_date, case_id, execution_id, decision_key
  ) VALUES (v_case.aces_id, v_phone_hash, v_local_date, v_case.id, p_execution_id, v_decision_key);
  RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', FALSE);
EXCEPTION WHEN unique_violation THEN
  IF EXISTS (SELECT 1 FROM collections.contact_daily_dispatches WHERE execution_id = p_execution_id) THEN
    RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', TRUE);
  END IF;
  v_defer_until := ((v_local_date + 1)::date + time '09:00') AT TIME ZONE v_business_timezone;
  RETURN jsonb_build_object('reserved', FALSE, 'collection', TRUE,
    'reason', 'deferred_contact_daily_limit', 'deferUntil', v_defer_until);
END;
$$;

CREATE OR REPLACE FUNCTION collections.list_eligible_decisions(p_limit integer DEFAULT 500)
RETURNS TABLE (
  case_id uuid, aces_id integer, source_connection_id uuid,
  journey_rule_id uuid, funnel_id uuid, customer_phone text,
  priority integer, most_overdue_days integer, total_open_amount numeric,
  local_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.id, jr.id)
    c.id, c.aces_id, c.source_connection_id, jr.id, jr.funnel_id,
    c.customer_phone, jr.priority, COALESCE(c.most_overdue_days, 0),
    c.total_open_amount,
    (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date
  FROM collections.cases c
  JOIN collections.source_connections sc ON sc.id = c.source_connection_id AND sc.status = 'active'
  JOIN collections.receivables r ON r.case_id = c.id
    AND r.record_status = 'current' AND r.financial_status = 'open'
  JOIN collections.journey_rules jr ON jr.aces_id = c.aces_id AND jr.is_active IS TRUE
    AND (jr.currency IS NULL OR jr.currency = r.currency)
    AND (jsonb_array_length(jr.payment_methods) = 0 OR jr.payment_methods ? COALESCE(r.payment_method, ''))
    AND jr.financial_statuses ? r.financial_status
    AND (
      (jr.timing_relation = 'before_due' AND r.due_date -
        (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date = jr.days_offset)
      OR (jr.timing_relation = 'on_due' AND r.due_date =
        (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date)
      OR (jr.timing_relation = 'after_due' AND
        (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date - r.due_date = jr.days_offset)
    )
  JOIN crm.automation_funnels f ON f.id = jr.funnel_id
    AND f.entry_source = 'collection' AND f.is_active IS TRUE
  JOIN collections.runtime_controls rc ON rc.aces_id = c.aces_id AND rc.active_dispatcher = 'canonical'
  WHERE c.communication_status = 'eligible' AND c.source_freshness = 'fresh'
    AND c.lead_id IS NOT NULL
    AND (
      NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb WHERE jsb.journey_rule_id = jr.id)
      OR EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb
        WHERE jsb.journey_rule_id = jr.id AND jsb.source_connection_id = c.source_connection_id)
    )
  ORDER BY c.id, jr.id, r.due_date, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
$$;

CREATE OR REPLACE FUNCTION collections.get_operational_health(p_aces_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sources', jsonb_build_object(
      'active', (SELECT count(*) FROM collections.source_connections WHERE aces_id = p_aces_id AND status = 'active'),
      'stale', (SELECT count(*) FROM collections.source_connections WHERE aces_id = p_aces_id AND status = 'active'
        AND COALESCE(last_success_at, created_at) < now() - make_interval(mins => stale_after_minutes)),
      'error', (SELECT count(*) FROM collections.source_connections WHERE aces_id = p_aces_id AND status = 'error')
    ),
    'ingestions', jsonb_build_object(
      'failed24h', (SELECT count(*) FROM collections.ingestion_runs WHERE aces_id = p_aces_id
        AND status = 'failed' AND created_at >= now() - interval '24 hours'),
      'duplicates24h', (SELECT count(*) FROM collections.operational_events WHERE aces_id = p_aces_id
        AND event_type = 'ingestion.duplicate' AND created_at >= now() - interval '24 hours')
    ),
    'cases', jsonb_build_object(
      'eligible', (SELECT count(*) FROM collections.cases WHERE aces_id = p_aces_id AND communication_status = 'eligible'),
      'paused', (SELECT count(*) FROM collections.cases WHERE aces_id = p_aces_id AND communication_status IN ('paused', 'in_service')),
      'error', (SELECT count(*) FROM collections.cases WHERE aces_id = p_aces_id AND communication_status = 'error')
    ),
    'outbox', jsonb_build_object(
      'pending', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'pending'),
      'processing', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'processing'),
      'failed', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'failed'),
      'stuck', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'processing'
        AND locked_at < now() - interval '5 minutes')
    ),
    'imports', jsonb_build_object(
      'failed', (SELECT count(*) FROM collections.spreadsheet_imports WHERE aces_id = p_aces_id AND status = 'failed'),
      'publishingStuck', (SELECT count(*) FROM collections.spreadsheet_imports WHERE aces_id = p_aces_id
        AND status = 'publishing' AND publish_requested_at < now() - interval '30 minutes')
    ),
    'dispatches', jsonb_build_object(
      'reservedToday', (SELECT count(*) FROM collections.contact_daily_dispatches WHERE aces_id = p_aces_id
        AND local_date = (now() AT TIME ZONE collections.account_business_timezone(p_aces_id))::date),
      'pendingAfterClosure', (SELECT count(DISTINCT e.id) FROM crm.automation_executions e
        JOIN collections.cases c ON c.id = e.source_collection_case_id AND c.aces_id = e.aces_id
        WHERE e.aces_id = p_aces_id AND e.status IN ('pending', 'processing')
          AND (c.open_receivables_count = 0 OR c.communication_status IN ('completed', 'stale', 'paused', 'error')))
    ),
    'dispatcher', COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = p_aces_id), 'legacy_rb'),
    'criticalAlerts', (SELECT count(*) FROM collections.operational_events WHERE aces_id = p_aces_id
      AND severity IN ('error', 'critical') AND created_at >= now() - interval '24 hours')
  );
$$;

CREATE OR REPLACE FUNCTION collections.record_ingestion_observation(
  p_source_connection_id uuid,
  p_event_type text,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF p_event_type NOT IN ('ingestion.duplicate', 'ingestion.out_of_order') THEN
    RAISE EXCEPTION 'Tipo de observacao de ingestao invalido';
  END IF;
  INSERT INTO collections.operational_events (
    aces_id, source_connection_id, event_type, severity, details
  ) SELECT aces_id, id, p_event_type,
      CASE WHEN p_event_type = 'ingestion.out_of_order' THEN 'warning' ELSE 'info' END,
      COALESCE(p_details, '{}'::jsonb)
    FROM collections.source_connections WHERE id = p_source_connection_id
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Fonte de cobranca nao encontrada'; END IF;
  RETURN v_id;
END;
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collections FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA collections TO service_role;
GRANT EXECUTE ON FUNCTION collections.clone_rb_funnel_for_shadow(integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.activate_canonical_dispatcher_after_cutover(integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.claim_expired_spreadsheet_imports(integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.complete_import_file_retention(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.clear_expired_import_error_details() TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_collection_context_authorized(integer, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_execution_dispatch_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.reserve_collection_dispatch(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.list_eligible_decisions(integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_operational_health(integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.record_ingestion_observation(uuid, text, jsonb) TO service_role;
