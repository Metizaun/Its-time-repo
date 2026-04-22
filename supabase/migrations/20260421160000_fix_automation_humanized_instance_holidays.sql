CREATE TABLE IF NOT EXISTS crm.automation_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL DEFAULT 'BR',
  holiday_date date NOT NULL,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'national',
  source text NOT NULL DEFAULT 'brasilapi',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_holidays_country_date_type_unique UNIQUE (country_code, holiday_date, type)
);

CREATE INDEX IF NOT EXISTS idx_automation_holidays_country_date
  ON crm.automation_holidays(country_code, holiday_date);

DROP TRIGGER IF EXISTS trg_automation_holidays_updated_at ON crm.automation_holidays;
CREATE TRIGGER trg_automation_holidays_updated_at
BEFORE UPDATE ON crm.automation_holidays
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT ON crm.automation_holidays TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_holidays TO service_role;

CREATE OR REPLACE FUNCTION crm.is_automation_holiday(
  p_local_date date,
  p_country_code text DEFAULT 'BR'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM crm.automation_holidays ah
    WHERE ah.country_code = COALESCE(NULLIF(btrim(p_country_code), ''), 'BR')
      AND ah.type = 'national'
      AND ah.holiday_date = p_local_date
  );
$function$;

CREATE OR REPLACE FUNCTION crm.is_humanized_dispatch_window(
  p_at timestamptz,
  p_timezone text DEFAULT 'America/Sao_Paulo'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
  WITH local_value AS (
    SELECT (p_at AT TIME ZONE COALESCE(NULLIF(btrim(p_timezone), ''), 'America/Sao_Paulo')) AS local_at
  )
  SELECT
    local_at::time >= time '08:00:00'
    AND local_at::time < time '19:00:00'
    AND crm.is_automation_holiday(local_at::date, 'BR') = FALSE
  FROM local_value;
$function$;

CREATE OR REPLACE FUNCTION crm.resolve_humanized_dispatch_at(
  p_base_at timestamptz,
  p_preparation_ms integer,
  p_timezone text DEFAULT 'America/Sao_Paulo'
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_timezone text := COALESCE(NULLIF(btrim(p_timezone), ''), 'America/Sao_Paulo');
  v_preparation interval := ((GREATEST(COALESCE(p_preparation_ms, 0), 0))::text || ' milliseconds')::interval;
  v_start_local timestamp;
  v_dispatch_local timestamp;
  v_day date;
  v_guard integer := 0;
BEGIN
  v_start_local := p_base_at AT TIME ZONE v_timezone;

  LOOP
    v_guard := v_guard + 1;
    IF v_guard > 370 THEN
      RAISE EXCEPTION 'Nao foi possivel encontrar janela humanizada valida em ate 370 dias';
    END IF;

    v_day := v_start_local::date;

    IF crm.is_automation_holiday(v_day, 'BR') THEN
      v_start_local := (v_day + 1)::timestamp + time '08:00:00';
      CONTINUE;
    END IF;

    IF v_start_local::time < time '08:00:00' THEN
      v_start_local := v_day::timestamp + time '08:00:00';
    ELSIF v_start_local::time >= time '18:00:00' THEN
      v_start_local := (v_day + 1)::timestamp + time '08:00:00';
      CONTINUE;
    END IF;

    v_dispatch_local := v_start_local + v_preparation;

    IF v_dispatch_local::date > v_start_local::date
      OR v_dispatch_local::time >= time '19:00:00'
      OR crm.is_automation_holiday(v_dispatch_local::date, 'BR') THEN
      v_start_local := (v_start_local::date + 1)::timestamp + time '08:00:00';
      CONTINUE;
    END IF;

    RETURN v_dispatch_local AT TIME ZONE v_timezone;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.recalculate_automation_instance_dispatch_state(
  p_aces_id integer,
  p_instance_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_next_available_at timestamptz;
  v_last_dispatch_at timestamptz;
BEGIN
  IF p_aces_id IS NULL OR COALESCE(p_instance_name, '') = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'updated', FALSE);
  END IF;

  SELECT max(
    COALESCE(
      NULLIF(ae.dispatch_meta->>'planned_dispatch_at', '')::timestamptz,
      ae.scheduled_at
    )
  )
  INTO v_next_available_at
  FROM crm.automation_executions ae
  WHERE ae.aces_id = p_aces_id
    AND ae.instance_snapshot = p_instance_name
    AND ae.status IN ('pending', 'processing')
    AND COALESCE((ae.dispatch_meta->>'awaiting_humanized_slot')::boolean, FALSE) = TRUE;

  SELECT max(ae.sent_at)
  INTO v_last_dispatch_at
  FROM crm.automation_executions ae
  WHERE ae.aces_id = p_aces_id
    AND ae.instance_snapshot = p_instance_name
    AND ae.status = 'sent'
    AND ae.sent_at IS NOT NULL;

  INSERT INTO crm.automation_instance_dispatch_state (
    aces_id,
    instance_name,
    next_available_at,
    last_dispatch_at,
    streak_without_long_pause
  )
  VALUES (
    p_aces_id,
    p_instance_name,
    v_next_available_at,
    v_last_dispatch_at,
    0
  )
  ON CONFLICT (aces_id, instance_name)
  DO UPDATE SET
    next_available_at = EXCLUDED.next_available_at,
    last_dispatch_at = EXCLUDED.last_dispatch_at,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', TRUE,
    'updated', TRUE,
    'next_available_at', v_next_available_at,
    'last_dispatch_at', v_last_dispatch_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cancel_pending_executions_for_funnel(p_funnel_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_affected record;
  v_count integer := 0;
BEGIN
  FOR v_affected IN
    WITH cancelled AS (
      UPDATE crm.automation_executions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        updated_at = now(),
        last_error = COALESCE(last_error, 'Cancelado por alteracao do funil')
      WHERE funnel_id = p_funnel_id
        AND status = 'pending'
      RETURNING aces_id, instance_snapshot
    )
    SELECT aces_id, instance_snapshot, count(*)::integer AS row_count
    FROM cancelled
    GROUP BY aces_id, instance_snapshot
  LOOP
    v_count := v_count + v_affected.row_count;
    IF v_affected.instance_snapshot IS NOT NULL THEN
      PERFORM crm.recalculate_automation_instance_dispatch_state(
        v_affected.aces_id,
        v_affected.instance_snapshot
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cancel_pending_executions_for_step(p_step_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_affected record;
  v_count integer := 0;
BEGIN
  FOR v_affected IN
    WITH cancelled AS (
      UPDATE crm.automation_executions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        updated_at = now(),
        last_error = COALESCE(last_error, 'Cancelado por alteracao do disparo')
      WHERE step_id = p_step_id
        AND status = 'pending'
      RETURNING aces_id, instance_snapshot
    )
    SELECT aces_id, instance_snapshot, count(*)::integer AS row_count
    FROM cancelled
    GROUP BY aces_id, instance_snapshot
  LOOP
    v_count := v_count + v_affected.row_count;
    IF v_affected.instance_snapshot IS NOT NULL THEN
      PERFORM crm.recalculate_automation_instance_dispatch_state(
        v_affected.aces_id,
        v_affected.instance_snapshot
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cancel_pending_executions_for_enrollment(
  p_enrollment_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_affected record;
  v_count integer := 0;
BEGIN
  FOR v_affected IN
    WITH cancelled AS (
      UPDATE crm.automation_executions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        completed_reason = COALESCE(completed_reason, p_reason),
        last_error = COALESCE(last_error, p_reason),
        updated_at = now()
      WHERE enrollment_id = p_enrollment_id
        AND status = 'pending'
      RETURNING aces_id, instance_snapshot
    )
    SELECT aces_id, instance_snapshot, count(*)::integer AS row_count
    FROM cancelled
    GROUP BY aces_id, instance_snapshot
  LOOP
    v_count := v_count + v_affected.row_count;
    IF v_affected.instance_snapshot IS NOT NULL THEN
      PERFORM crm.recalculate_automation_instance_dispatch_state(
        v_affected.aces_id,
        v_affected.instance_snapshot
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.schedule_enrollment_executions(p_enrollment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND OR v_enrollment.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = v_enrollment.lead_id
    AND aces_id = v_enrollment.aces_id
  LIMIT 1;

  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) = FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id,
    funnel_id,
    step_id,
    enrollment_id,
    lead_id,
    source_stage_id,
    scheduled_at,
    phone_snapshot,
    instance_snapshot,
    lead_name_snapshot,
    city_snapshot,
    status_snapshot,
    funnel_name_snapshot,
    step_label_snapshot,
    step_rule_snapshot,
    anchor_at_snapshot
  )
  SELECT
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    s.id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.anchor_at + make_interval(mins => s.delay_minutes),
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    s.label,
    s.step_rule,
    v_enrollment.anchor_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND s.is_active = TRUE
  ORDER BY s.position ASC, s.created_at ASC
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.start_or_refresh_enrollment(
  p_funnel_id uuid,
  p_lead_id uuid,
  p_context jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_context jsonb := COALESCE(p_context, crm.get_automation_context(p_lead_id));
  v_anchor jsonb;
  v_anchor_at timestamptz;
  v_anchor_message_id uuid;
  v_entry_result jsonb;
  v_existing crm.automation_enrollments%ROWTYPE;
  v_same_enrollment_id uuid;
  v_restarted_count integer := 0;
BEGIN
  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_context IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE((v_context->>'view')::boolean, TRUE) = FALSE THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_context->>'contact_phone', '') = '' THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  v_anchor := crm.get_anchor_details_from_context(v_context, v_funnel.anchor_event);
  v_anchor_at := NULLIF(v_anchor->>'anchor_at', '')::timestamptz;
  v_anchor_message_id := NULLIF(v_anchor->>'anchor_message_id', '')::uuid;

  IF v_anchor_at IS NULL THEN
    RETURN 0;
  END IF;

  v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_anchor_at);
  IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
    RETURN 0;
  END IF;

  SELECT id
  INTO v_same_enrollment_id
  FROM crm.automation_enrollments
  WHERE funnel_id = v_funnel.id
    AND lead_id = p_lead_id
    AND status = 'active'
    AND anchor_event = v_funnel.anchor_event
    AND anchor_at = v_anchor_at
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_same_enrollment_id IS NOT NULL THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_existing
  FROM crm.automation_enrollments
  WHERE funnel_id = v_funnel.id
    AND lead_id = p_lead_id
    AND status = 'active'
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_funnel.reentry_mode = 'ignore_if_active' THEN
      RETURN 0;
    END IF;

    IF v_funnel.reentry_mode = 'restart_on_match' THEN
      v_restarted_count := COALESCE(v_existing.restarted_count, 0) + 1;
      PERFORM crm.stop_automation_enrollment(v_existing.id, 'cancelled', 'Reentrada por novo evento ancora', FALSE);
    END IF;
  END IF;

  INSERT INTO crm.automation_enrollments (
    aces_id,
    funnel_id,
    lead_id,
    status,
    anchor_event,
    anchor_at,
    anchor_message_id,
    current_stage_id,
    reply_target_stage_id,
    restarted_count,
    last_evaluated_at
  )
  VALUES (
    v_funnel.aces_id,
    v_funnel.id,
    p_lead_id,
    'active',
    v_funnel.anchor_event,
    v_anchor_at,
    v_anchor_message_id,
    NULLIF(v_context->>'stage_id', '')::uuid,
    v_funnel.reply_target_stage_id,
    v_restarted_count,
    now()
  );

  RETURN crm.schedule_enrollment_executions(
    (
      SELECT id
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND lead_id = p_lead_id
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.handle_entry_event(
  p_lead_id uuid,
  p_anchor_event text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_context jsonb;
  v_funnel_id uuid;
  v_total integer := 0;
  v_aces_id integer;
  v_instance_name text;
BEGIN
  v_context := crm.get_automation_context(p_lead_id);
  v_aces_id := NULLIF(v_context->>'aces_id', '')::integer;
  v_instance_name := v_context->>'instance_name';

  IF v_context IS NULL OR v_aces_id IS NULL OR COALESCE(v_instance_name, '') = '' THEN
    RETURN 0;
  END IF;

  FOR v_funnel_id IN
    SELECT id
    FROM crm.automation_funnels
    WHERE aces_id = v_aces_id
      AND is_active = TRUE
      AND anchor_event = p_anchor_event
      AND instance_name = v_instance_name
  LOOP
    v_total := v_total + crm.start_or_refresh_enrollment(v_funnel_id, p_lead_id, v_context);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.revalidate_active_enrollments_for_lead(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_lead crm.leads%ROWTYPE;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_total integer := 0;
BEGIN
  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE lead_id = p_lead_id
      AND status = 'active'
  LOOP
    SELECT *
    INTO v_funnel
    FROM crm.automation_funnels
    WHERE id = v_enrollment.funnel_id
    LIMIT 1;

    IF NOT FOUND OR COALESCE(v_lead.view, TRUE) = FALSE THEN
      v_total := v_total + crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead oculto ou jornada removida', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
      v_total := v_total + crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead saiu da instancia da jornada', FALSE);
      CONTINUE;
    END IF;

    IF v_funnel.trigger_stage_id IS NOT NULL AND v_lead.stage_id IS DISTINCT FROM v_funnel.trigger_stage_id THEN
      v_total := v_total + crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead saiu da etapa da jornada', FALSE);
      CONTINUE;
    END IF;

    UPDATE crm.automation_enrollments
    SET
      current_stage_id = v_lead.stage_id,
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_enrollment.id;
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_sync_automation_funnel_v2(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_cancelled integer := 0;
  v_scheduled integer := 0;
  v_lead_id uuid;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode sincronizar automacoes';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

  IF COALESCE(v_funnel.is_active, TRUE) = FALSE THEN
    FOR v_enrollment IN
      SELECT *
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND status = 'active'
    LOOP
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Automacao desativada', FALSE);
    END LOOP;

    RETURN jsonb_build_object(
      'success', TRUE,
      'cancelled', v_cancelled,
      'scheduled', 0
    );
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE funnel_id = v_funnel.id
      AND status = 'active'
  LOOP
    v_context := crm.get_automation_context(v_enrollment.lead_id);

    IF v_context IS NULL THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead nao encontrado na sincronizacao', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead saiu da instancia da jornada', FALSE);
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_enrollment.anchor_at);
    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Regra de entrada nao bate mais', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'completed', 'Regra de saida ja atendida', TRUE);
      CONTINUE;
    END IF;

    v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment.id);
  END LOOP;

  FOR v_lead_id IN
    SELECT id
    FROM crm.leads
    WHERE aces_id = v_funnel.aces_id
      AND COALESCE(view, TRUE) = TRUE
      AND COALESCE(instancia, '') = COALESCE(v_funnel.instance_name, '')
  LOOP
    v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(v_funnel.id, v_lead_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'cancelled', v_cancelled,
    'scheduled', v_scheduled
  );
END;
$function$;

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
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_due record;
  v_execution record;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
  v_step_result jsonb;
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
      f.is_active AS funnel_is_active,
      f.entry_rule,
      f.exit_rule,
      f.trigger_stage_id,
      f.instance_name AS funnel_instance_name,
      e.status AS enrollment_status,
      e.anchor_at,
      e.reply_target_stage_id,
      l.contact_phone AS live_phone,
      l.stage_id AS live_stage_id,
      l.instancia AS live_instance_name,
      COALESCE(l.view, TRUE) AS live_view
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.automation_enrollments e ON e.id = ae.enrollment_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_reason := NULL;

    IF v_execution.funnel_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Automacao inativa';
    ELSIF v_execution.step_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Mensagem inativa';
    ELSIF COALESCE(v_execution.enrollment_status, '') <> 'active' THEN
      v_reason := 'Enrollment inativo';
    ELSIF COALESCE(v_execution.live_view, TRUE) = FALSE THEN
      v_reason := 'Lead oculto';
    ELSIF COALESCE(v_execution.live_phone, '') = '' THEN
      v_reason := 'Lead sem telefone';
    ELSIF COALESCE(v_execution.live_instance_name, '') <> COALESCE(v_execution.funnel_instance_name, '') THEN
      v_reason := 'Lead fora da instancia da automacao';
    END IF;

    IF v_reason IS NULL THEN
      v_context := crm.get_automation_context(v_execution.lead_id);
      v_entry_result := crm.evaluate_automation_rule_node(v_execution.entry_rule, v_context, v_execution.anchor_at);
      v_exit_result := crm.evaluate_automation_rule_node(v_execution.exit_rule, v_context, v_execution.anchor_at);
      v_step_result := CASE
        WHEN v_execution.step_rule IS NULL THEN jsonb_build_object('matched', TRUE)
        ELSE crm.evaluate_automation_rule_node(v_execution.step_rule, v_context, v_execution.anchor_at)
      END;

      IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
        v_reason := 'Regra de entrada nao corresponde mais';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'cancelled', v_reason, FALSE);
      ELSIF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
        v_reason := 'Jornada encerrada por regra de saida';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'completed', v_reason, TRUE);
      ELSIF COALESCE((v_step_result->>'matched')::boolean, FALSE) = FALSE THEN
        v_reason := 'Regra extra da mensagem nao bate mais';
      ELSIF v_execution.trigger_stage_id IS NOT NULL AND v_execution.live_stage_id IS DISTINCT FROM v_execution.trigger_stage_id THEN
        v_reason := 'Lead saiu da etapa da jornada';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'cancelled', v_reason, FALSE);
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE crm.automation_executions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        completed_reason = COALESCE(completed_reason, v_reason),
        last_error = COALESCE(last_error, v_reason),
        updated_at = now()
      WHERE id = v_execution.id
        AND status = 'pending';

      IF v_execution.instance_snapshot IS NOT NULL THEN
        PERFORM crm.recalculate_automation_instance_dispatch_state(
          v_execution.aces_id,
          v_execution.instance_snapshot
        );
      END IF;

      CONTINUE;
    END IF;

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      claimed_by = COALESCE(auth.uid()::text, 'service_role'),
      updated_at = now()
    WHERE id = v_execution.id
      AND status = 'pending';

    IF FOUND THEN
      RETURN QUERY
      SELECT
        v_execution.id,
        v_execution.enrollment_id,
        v_execution.lead_id,
        v_execution.aces_id,
        v_execution.instance_snapshot,
        v_execution.phone_snapshot,
        v_execution.lead_name_snapshot,
        v_execution.city_snapshot,
        v_execution.status_snapshot,
        v_execution.message_template,
        v_execution.step_label_snapshot,
        v_execution.funnel_name_snapshot,
        v_execution.scheduled_at,
        v_execution.attempt_count;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_plan_humanized_dispatch(
  p_execution_id uuid,
  p_message_length integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_now timestamptz := now();
  v_execution record;
  v_state crm.automation_instance_dispatch_state%ROWTYPE;
  v_lock_key bigint;
  v_existing_meta jsonb := '{}'::jsonb;
  v_existing_planned_at timestamptz;
  v_existing_preparation_ms integer;
  v_waiting_slot boolean := FALSE;
  v_last_activity_at timestamptz;
  v_streak integer := 0;
  v_conversation_switch_ms integer;
  v_typing_ms integer;
  v_long_pause_ms integer;
  v_preparation_ms integer;
  v_probability numeric;
  v_base_at timestamptz;
  v_dispatch_at timestamptz;
  v_rate_limit_candidate timestamptz;
  v_preparation_interval interval;
  v_occupied_slots timestamptz[] := ARRAY[]::timestamptz[];
  v_active_latest_at timestamptz;
  v_effective_next_available_at timestamptz;
  v_dispatch_meta jsonb;
BEGIN
  SELECT
    ae.id,
    ae.aces_id,
    ae.funnel_id,
    ae.instance_snapshot AS instance_name,
    ae.dispatch_meta,
    af.humanized_dispatch_enabled,
    af.dispatch_limit_per_hour
  INTO v_execution
  FROM crm.automation_executions ae
  LEFT JOIN crm.automation_funnels af
    ON af.id = ae.funnel_id
  WHERE ae.id = p_execution_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para planejamento humanizado';
  END IF;

  v_existing_meta := COALESCE(v_execution.dispatch_meta, '{}'::jsonb);
  v_waiting_slot := COALESCE((v_existing_meta->>'awaiting_humanized_slot')::boolean, FALSE);
  v_existing_planned_at := NULLIF(v_existing_meta->>'planned_dispatch_at', '')::timestamptz;
  v_existing_preparation_ms := NULLIF(v_existing_meta->>'preparation_ms', '')::integer;

  IF COALESCE(v_execution.humanized_dispatch_enabled, FALSE) = FALSE THEN
    RETURN jsonb_build_object(
      'action', 'send_now',
      'humanized', FALSE,
      'dispatch_at', v_now,
      'dispatch_meta', v_existing_meta
    );
  END IF;

  IF COALESCE(v_execution.instance_name, '') = '' THEN
    RETURN jsonb_build_object(
      'action', 'send_now',
      'humanized', TRUE,
      'dispatch_at', v_now,
      'dispatch_meta', v_existing_meta
    );
  END IF;

  v_lock_key := hashtextextended(
    format('automation_dispatch:%s:%s', v_execution.aces_id, v_execution.instance_name),
    0
  );

  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT *
  INTO v_state
  FROM crm.automation_instance_dispatch_state
  WHERE aces_id = v_execution.aces_id
    AND instance_name = v_execution.instance_name
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO crm.automation_instance_dispatch_state (
      aces_id,
      instance_name,
      next_available_at,
      last_dispatch_at,
      streak_without_long_pause
    )
    VALUES (
      v_execution.aces_id,
      v_execution.instance_name,
      NULL,
      NULL,
      0
    )
    RETURNING *
    INTO v_state;
  END IF;

  SELECT COALESCE(array_agg(occupied_at ORDER BY occupied_at ASC), ARRAY[]::timestamptz[])
  INTO v_occupied_slots
  FROM (
    SELECT ae.sent_at AS occupied_at
    FROM crm.automation_executions ae
    WHERE ae.funnel_id = v_execution.funnel_id
      AND ae.instance_snapshot = v_execution.instance_name
      AND ae.status = 'sent'
      AND ae.sent_at IS NOT NULL
      AND ae.sent_at >= v_now - interval '1 hour'

    UNION ALL

    SELECT COALESCE(
      NULLIF(ae.dispatch_meta->>'planned_dispatch_at', '')::timestamptz,
      ae.scheduled_at
    ) AS occupied_at
    FROM crm.automation_executions ae
    WHERE ae.funnel_id = v_execution.funnel_id
      AND ae.instance_snapshot = v_execution.instance_name
      AND ae.id <> p_execution_id
      AND ae.status IN ('pending', 'processing')
      AND COALESCE((ae.dispatch_meta->>'awaiting_humanized_slot')::boolean, FALSE) = TRUE
      AND COALESCE(
        NULLIF(ae.dispatch_meta->>'planned_dispatch_at', '')::timestamptz,
        ae.scheduled_at
      ) IS NOT NULL
  ) occupied;

  SELECT max(slot_value)
  INTO v_active_latest_at
  FROM unnest(v_occupied_slots) AS slot(slot_value);

  IF v_state.next_available_at IS NOT NULL
    AND (
      v_active_latest_at IS NULL
      OR v_state.next_available_at > v_active_latest_at + interval '5 minutes'
    ) THEN
    v_effective_next_available_at := v_active_latest_at;

    UPDATE crm.automation_instance_dispatch_state
    SET
      next_available_at = v_effective_next_available_at,
      updated_at = now()
    WHERE id = v_state.id;
  ELSE
    v_effective_next_available_at := v_state.next_available_at;
  END IF;

  v_last_activity_at := GREATEST(
    COALESCE(v_state.last_dispatch_at, '-infinity'::timestamptz),
    COALESCE(v_effective_next_available_at, '-infinity'::timestamptz)
  );

  IF v_last_activity_at = '-infinity'::timestamptz OR v_now - v_last_activity_at > interval '15 minutes' THEN
    v_streak := 0;
  ELSE
    v_streak := COALESCE(v_state.streak_without_long_pause, 0);
  END IF;

  IF v_waiting_slot AND v_existing_planned_at IS NOT NULL AND COALESCE(v_existing_preparation_ms, 0) > 0 THEN
    v_conversation_switch_ms := COALESCE(NULLIF(v_existing_meta->>'conversation_switch_ms', '')::integer, 0);
    v_typing_ms := COALESCE(NULLIF(v_existing_meta->>'typing_ms', '')::integer, 0);
    v_long_pause_ms := COALESCE(NULLIF(v_existing_meta->>'long_pause_ms', '')::integer, 0);
    v_probability := COALESCE(NULLIF(v_existing_meta->>'long_pause_probability', '')::numeric, 0);
    v_preparation_ms := v_existing_preparation_ms;
  ELSE
    v_conversation_switch_ms := 8000 + floor(random() * 17001)::integer;
    v_typing_ms := LEAST(
      GREATEST(
        GREATEST(COALESCE(p_message_length, 0), 0) * (45 + floor(random() * 26)::integer),
        2500
      ),
      45000
    );

    v_probability := CASE
      WHEN v_streak >= 20 THEN 0.33
      ELSE 0.16
    END;

    IF random() < v_probability THEN
      v_long_pause_ms := 180000 + floor(random() * 120001)::integer;
      v_streak := 0;
    ELSE
      v_long_pause_ms := 0;
      v_streak := v_streak + 1;
    END IF;

    v_preparation_ms := v_conversation_switch_ms + v_typing_ms + v_long_pause_ms;
  END IF;

  v_preparation_interval := (v_preparation_ms::text || ' milliseconds')::interval;

  IF v_waiting_slot AND v_existing_planned_at IS NOT NULL THEN
    v_base_at := GREATEST(v_existing_planned_at - v_preparation_interval, v_now - v_preparation_interval);
  ELSE
    v_base_at := GREATEST(v_now, COALESCE(v_effective_next_available_at, v_now));
  END IF;

  LOOP
    v_dispatch_at := crm.resolve_humanized_dispatch_at(v_base_at, v_preparation_ms);
    v_rate_limit_candidate := crm.find_next_rate_limited_dispatch_at(
      v_dispatch_at,
      GREATEST(COALESCE(v_execution.dispatch_limit_per_hour, 40), 1),
      v_occupied_slots
    );

    EXIT WHEN v_rate_limit_candidate = v_dispatch_at;

    v_base_at := v_rate_limit_candidate - v_preparation_interval;
  END LOOP;

  UPDATE crm.automation_instance_dispatch_state
  SET
    next_available_at = GREATEST(COALESCE(next_available_at, v_dispatch_at), v_dispatch_at),
    streak_without_long_pause = v_streak,
    updated_at = now()
  WHERE id = v_state.id;

  v_dispatch_meta := jsonb_strip_nulls(
    v_existing_meta ||
    jsonb_build_object(
      'humanized_dispatch', TRUE,
      'awaiting_humanized_slot', TRUE,
      'planned_dispatch_at', v_dispatch_at,
      'planned_at', v_now,
      'timezone', 'America/Sao_Paulo',
      'holiday_scope', 'BR:national',
      'dispatch_limit_per_hour', GREATEST(COALESCE(v_execution.dispatch_limit_per_hour, 40), 1),
      'conversation_switch_ms', v_conversation_switch_ms,
      'typing_ms', v_typing_ms,
      'long_pause_ms', v_long_pause_ms,
      'long_pause_probability', v_probability,
      'preparation_ms', v_preparation_ms
    )
  );

  RETURN jsonb_build_object(
    'action', CASE WHEN v_dispatch_at <= v_now AND crm.is_humanized_dispatch_window(v_now) THEN 'send_now' ELSE 'defer' END,
    'humanized', TRUE,
    'dispatch_at', v_dispatch_at,
    'dispatch_meta', v_dispatch_meta
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.is_automation_holiday(date, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.is_humanized_dispatch_window(timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.resolve_humanized_dispatch_at(timestamptz, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;

REVOKE ALL ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) FROM anon;
REVOKE ALL ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) FROM PUBLIC;
