-- RB same-day decisions -----------------------------------------------------
-- A stage is only a CRM visualization for enabled RB accounts. The RB worker
-- owns the concrete same-day dispatch decision, preventing historic step
-- progress or a later stage move from dropping an eligible message.

ALTER TABLE crm.accounts
  ADD COLUMN IF NOT EXISTS rb_same_day_dispatch_enabled boolean NOT NULL DEFAULT FALSE;

ALTER TABLE crm.automation_enrollments
  ADD COLUMN IF NOT EXISTS rb_decision_key text,
  ADD COLUMN IF NOT EXISTS rb_decision_local_date date,
  ADD COLUMN IF NOT EXISTS rb_decision_context jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS rb_decision_key text,
  ADD COLUMN IF NOT EXISTS rb_decision_local_date date,
  ADD COLUMN IF NOT EXISTS rb_decision_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rb_outcome_code text,
  ADD COLUMN IF NOT EXISTS rb_outcome_detail jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A pending decision from another RB day must not conflict with a fresh
-- occurrence. The generic one-pending-step index remains unchanged for every
-- other automation source.
DROP INDEX IF EXISTS crm.idx_automation_execution_pending_funnel_lead_step;
CREATE UNIQUE INDEX idx_automation_execution_pending_funnel_lead_step
  ON crm.automation_executions(funnel_id, lead_id, step_id)
  WHERE status IN ('pending', 'processing')
    AND funnel_id IS NOT NULL
    AND lead_id IS NOT NULL
    AND step_id IS NOT NULL
    AND source_calendar_event_id IS NULL
    AND source_collection_case_id IS NULL
    AND source_webhook_receipt_id IS NULL
    AND rb_decision_key IS NULL;

DROP INDEX IF EXISTS crm.automation_enrollments_rb_decision_unique;
CREATE UNIQUE INDEX automation_enrollments_rb_decision_unique
  ON crm.automation_enrollments (aces_id, funnel_id, lead_id, rb_decision_key, rb_decision_local_date)
  WHERE rb_decision_key IS NOT NULL;

DROP INDEX IF EXISTS crm.automation_executions_rb_decision_unique;
CREATE UNIQUE INDEX automation_executions_rb_decision_unique
  ON crm.automation_executions (aces_id, funnel_id, lead_id, rb_decision_key, rb_decision_local_date)
  WHERE rb_decision_key IS NOT NULL;

CREATE OR REPLACE FUNCTION crm.is_rb_same_day_dispatch_enabled(p_aces_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT COALESCE((
    SELECT a.rb_same_day_dispatch_enabled
    FROM crm.accounts AS a
    WHERE a.id = p_aces_id
  ), FALSE);
$$;

REVOKE ALL ON FUNCTION crm.is_rb_same_day_dispatch_enabled(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.is_rb_same_day_dispatch_enabled(integer) TO service_role;

CREATE OR REPLACE FUNCTION crm.fail_rb_same_day_execution(
  p_execution_id uuid,
  p_outcome_code text,
  p_reason text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
BEGIN
  SELECT *
  INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id
    AND rb_decision_key IS NOT NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE crm.automation_executions
  SET
    status = 'failed',
    completed_reason = COALESCE(NULLIF(p_outcome_code, ''), 'rb_send_failed'),
    last_error = COALESCE(NULLIF(p_reason, ''), 'Falha no disparo RB'),
    rb_outcome_code = COALESCE(NULLIF(p_outcome_code, ''), 'rb_send_failed'),
    rb_outcome_detail = COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
      'reason', COALESCE(NULLIF(p_reason, ''), 'Falha no disparo RB'),
      'terminal_at', now()
    ),
    claimed_by = NULL,
    attempt_count = CASE WHEN status = 'processing' THEN attempt_count + 1 ELSE attempt_count END,
    updated_at = now()
  WHERE id = v_execution.id
    AND status IN ('pending', 'processing');

  IF v_execution.enrollment_id IS NOT NULL THEN
    UPDATE crm.automation_enrollments
    SET
      status = 'failed',
      stopped_reason = COALESCE(NULLIF(p_outcome_code, ''), 'rb_send_failed'),
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_execution.enrollment_id
      AND status = 'active';
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION crm.fail_rb_same_day_execution(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.fail_rb_same_day_execution(uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION crm.cancel_rb_same_day_enrollment(
  p_enrollment_id uuid,
  p_outcome_code text,
  p_reason text,
  p_detail jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
BEGIN
  SELECT * INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
    AND rb_decision_key IS NOT NULL
    AND status = 'active'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE crm.automation_executions
  SET
    status = 'cancelled',
    cancelled_at = now(),
    completed_reason = COALESCE(NULLIF(p_outcome_code, ''), 'rb_cancelled_explicit'),
    last_error = COALESCE(NULLIF(p_reason, ''), 'Disparo RB cancelado por acao explicita'),
    rb_outcome_code = COALESCE(NULLIF(p_outcome_code, ''), 'rb_cancelled_explicit'),
    rb_outcome_detail = COALESCE(p_detail, '{}'::jsonb) || jsonb_build_object(
      'reason', COALESCE(NULLIF(p_reason, ''), 'Disparo RB cancelado por acao explicita'),
      'cancelled_at', now()
    ),
    claimed_by = NULL,
    updated_at = now()
  WHERE enrollment_id = v_enrollment.id
    AND status IN ('pending', 'processing');

  UPDATE crm.automation_enrollments
  SET
    status = 'cancelled',
    stopped_reason = COALESCE(NULLIF(p_outcome_code, ''), 'rb_cancelled_explicit'),
    last_evaluated_at = now(),
    updated_at = now()
  WHERE id = v_enrollment.id;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION crm.cancel_rb_same_day_enrollment(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.cancel_rb_same_day_enrollment(uuid, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION crm.enqueue_rb_same_day_dispatch(
  p_aces_id integer,
  p_lead_id uuid,
  p_funnel_id uuid,
  p_decision_key text,
  p_decision_local_date date,
  p_decision_context jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_step crm.automation_steps%ROWTYPE;
  v_step_count integer;
  v_enrollment_id uuid;
  v_execution_id uuid;
  v_scheduled_at timestamptz;
  v_now timestamptz := now();
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  v_dispatch_at time;
BEGIN
  IF NOT crm.is_rb_same_day_dispatch_enabled(p_aces_id) THEN
    RETURN jsonb_build_object('mode', 'legacy', 'created', FALSE, 'scheduled', FALSE);
  END IF;

  IF NULLIF(btrim(p_decision_key), '') IS NULL THEN
    RAISE EXCEPTION 'Chave da decisao RB e obrigatoria';
  END IF;

  IF p_decision_local_date IS DISTINCT FROM v_today THEN
    RAISE EXCEPTION 'Decisao RB deve ser processada na data local atual';
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = p_aces_id
    AND entry_source = 'rb'
    AND is_active IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jornada RB ativa nao encontrada para a conta';
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
    AND aces_id = p_aces_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead RB nao encontrado para a conta';
  END IF;

  SELECT count(*) INTO v_step_count
  FROM crm.automation_steps
  WHERE funnel_id = v_funnel.id
    AND is_active IS TRUE;

  IF v_step_count <> 1 THEN
    RAISE EXCEPTION 'A jornada RB precisa ter exatamente uma mensagem ativa';
  END IF;

  SELECT * INTO v_step
  FROM crm.automation_steps
  WHERE funnel_id = v_funnel.id
    AND is_active IS TRUE
  ORDER BY position ASC, created_at ASC
  LIMIT 1;

  INSERT INTO crm.automation_enrollments (
    aces_id,
    funnel_id,
    lead_id,
    status,
    anchor_event,
    anchor_at,
    current_stage_id,
    reply_target_stage_id,
    last_evaluated_at,
    rb_decision_key,
    rb_decision_local_date,
    rb_decision_context
  )
  VALUES (
    p_aces_id,
    v_funnel.id,
    v_lead.id,
    'active',
    'stage_entered_at',
    v_now,
    v_lead.stage_id,
    v_funnel.reply_target_stage_id,
    v_now,
    btrim(p_decision_key),
    p_decision_local_date,
    COALESCE(p_decision_context, '{}'::jsonb)
  )
  ON CONFLICT (aces_id, funnel_id, lead_id, rb_decision_key, rb_decision_local_date)
    WHERE rb_decision_key IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_enrollment_id;

  IF v_enrollment_id IS NULL THEN
    SELECT e.id INTO v_enrollment_id
    FROM crm.automation_enrollments AS e
    WHERE e.aces_id = p_aces_id
      AND e.funnel_id = v_funnel.id
      AND e.lead_id = v_lead.id
      AND e.rb_decision_key = btrim(p_decision_key)
      AND e.rb_decision_local_date = p_decision_local_date
    LIMIT 1;

    SELECT ae.id INTO v_execution_id
    FROM crm.automation_executions AS ae
    WHERE ae.aces_id = p_aces_id
      AND ae.funnel_id = v_funnel.id
      AND ae.lead_id = v_lead.id
      AND ae.rb_decision_key = btrim(p_decision_key)
      AND ae.rb_decision_local_date = p_decision_local_date
    LIMIT 1;

    RETURN jsonb_build_object(
      'mode', 'same_day',
      'created', FALSE,
      'duplicate', TRUE,
      'enrollment_id', v_enrollment_id,
      'execution_id', v_execution_id
    );
  END IF;

  v_dispatch_at := TIME '09:00';
  v_scheduled_at := (p_decision_local_date::timestamp + v_dispatch_at) AT TIME ZONE 'America/Sao_Paulo';
  IF v_scheduled_at < v_now THEN
    v_scheduled_at := v_now;
  END IF;

  IF COALESCE(v_lead.view, TRUE) IS FALSE OR COALESCE(btrim(v_lead.contact_phone), '') = '' THEN
    INSERT INTO crm.automation_executions (
      aces_id, funnel_id, step_id, enrollment_id, lead_id, source_stage_id,
      scheduled_at, phone_snapshot, instance_snapshot, lead_name_snapshot,
      city_snapshot, status_snapshot, funnel_name_snapshot, step_label_snapshot,
      rb_decision_key, rb_decision_local_date, rb_decision_context,
      rb_outcome_code, rb_outcome_detail, status, completed_reason, last_error
    ) VALUES (
      p_aces_id, v_funnel.id, v_step.id, v_enrollment_id, v_lead.id, v_lead.stage_id,
      v_now, v_lead.contact_phone, v_funnel.instance_name, v_lead.name,
      v_lead.last_city, v_lead.status, v_funnel.name, v_step.label,
      btrim(p_decision_key), p_decision_local_date, COALESCE(p_decision_context, '{}'::jsonb),
      'rb_missing_phone', jsonb_build_object('reason', 'Lead sem telefone valido para disparo RB', 'terminal_at', v_now),
      'failed', 'rb_missing_phone', 'Lead sem telefone valido para disparo RB'
    )
    RETURNING id INTO v_execution_id;

    UPDATE crm.automation_enrollments
    SET status = 'failed', stopped_reason = 'rb_missing_phone', updated_at = now()
    WHERE id = v_enrollment_id;

    RETURN jsonb_build_object(
      'mode', 'same_day', 'created', TRUE, 'scheduled', FALSE,
      'enrollment_id', v_enrollment_id, 'execution_id', v_execution_id,
      'status', 'failed', 'outcome_code', 'rb_missing_phone'
    );
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id, funnel_id, step_id, enrollment_id, lead_id, source_stage_id,
    scheduled_at, phone_snapshot, instance_snapshot, lead_name_snapshot,
    city_snapshot, status_snapshot, funnel_name_snapshot, step_label_snapshot,
    step_rule_snapshot, anchor_at_snapshot,
    rb_decision_key, rb_decision_local_date, rb_decision_context,
    rb_outcome_code, rb_outcome_detail
  ) VALUES (
    p_aces_id, v_funnel.id, v_step.id, v_enrollment_id, v_lead.id, v_lead.stage_id,
    v_scheduled_at, v_lead.contact_phone, v_funnel.instance_name, v_lead.name,
    v_lead.last_city, v_lead.status, v_funnel.name, v_step.label,
    v_step.step_rule, v_now,
    btrim(p_decision_key), p_decision_local_date, COALESCE(p_decision_context, '{}'::jsonb),
    'rb_scheduled', jsonb_build_object('scheduled_at', v_scheduled_at, 'decision_date', p_decision_local_date)
  )
  RETURNING id INTO v_execution_id;

  RETURN jsonb_build_object(
    'mode', 'same_day', 'created', TRUE, 'duplicate', FALSE, 'scheduled', TRUE,
    'enrollment_id', v_enrollment_id, 'execution_id', v_execution_id,
    'scheduled_at', v_scheduled_at
  );
END;
$$;

REVOKE ALL ON FUNCTION crm.enqueue_rb_same_day_dispatch(integer, uuid, uuid, text, date, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.enqueue_rb_same_day_dispatch(integer, uuid, uuid, text, date, jsonb) TO service_role;

-- Stage changes continue to be recorded, but no longer start a second, generic
-- enrollment for accounts using the RB decision dispatcher.
CREATE OR REPLACE FUNCTION crm.handle_entry_event(p_lead_id uuid, p_anchor_event text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_context jsonb;
  v_funnel_id uuid;
  v_total integer := 0;
  v_aces_id integer;
  v_instance_name text;
BEGIN
  v_context := crm.get_automation_context(p_lead_id);
  v_aces_id := NULLIF(v_context->>'aces_id', '')::integer;
  v_instance_name := NULLIF(v_context->>'instance_name', '');

  IF v_context IS NULL OR v_aces_id IS NULL OR v_instance_name IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_funnel_id IN
    SELECT f.id
    FROM crm.automation_funnels AS f
    WHERE f.aces_id = v_aces_id
      AND f.instance_name = v_instance_name
      AND f.is_active IS TRUE
      AND f.anchor_event = p_anchor_event
      AND NOT (f.entry_source = 'rb' AND crm.is_rb_same_day_dispatch_enabled(v_aces_id))
  LOOP
    v_total := v_total + crm.start_or_refresh_enrollment(v_funnel_id, p_lead_id, v_context);
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION crm.revalidate_active_enrollments_for_lead(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_lead crm.leads%ROWTYPE;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_total integer := 0;
BEGIN
  SELECT * INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR v_enrollment IN
    SELECT * FROM crm.automation_enrollments
    WHERE lead_id = p_lead_id AND status = 'active'
  LOOP
    SELECT * INTO v_funnel
    FROM crm.automation_funnels
    WHERE id = v_enrollment.funnel_id
    LIMIT 1;

    IF NOT FOUND THEN
      v_total := v_total + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead oculto ou jornada removida', FALSE
      );
      CONTINUE;
    END IF;

    IF v_funnel.entry_source = 'rb'
       AND crm.is_rb_same_day_dispatch_enabled(v_enrollment.aces_id) THEN
      IF COALESCE(v_lead.view, TRUE) = FALSE THEN
        IF crm.cancel_rb_same_day_enrollment(
          v_enrollment.id,
          'rb_cancelled_manual_block',
          'Lead ocultado por acao manual',
          jsonb_build_object('action', 'lead_hidden')
        ) THEN
          v_total := v_total + 1;
        END IF;
        CONTINUE;
      END IF;

      UPDATE crm.automation_enrollments
      SET current_stage_id = v_lead.stage_id, last_evaluated_at = now(), updated_at = now()
      WHERE id = v_enrollment.id;
      CONTINUE;
    END IF;

    IF COALESCE(v_lead.view, TRUE) = FALSE THEN
      v_total := v_total + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead oculto ou jornada removida', FALSE
      );
      CONTINUE;
    END IF;

    IF COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
      v_total := v_total + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead saiu da instancia da jornada', FALSE
      );
      CONTINUE;
    END IF;

    IF v_funnel.trigger_stage_id IS NOT NULL
       AND v_lead.stage_id IS DISTINCT FROM v_funnel.trigger_stage_id THEN
      v_total := v_total + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead saiu da etapa da jornada', FALSE
      );
      CONTINUE;
    END IF;

    UPDATE crm.automation_enrollments
    SET current_stage_id = v_lead.stage_id, last_evaluated_at = now(), updated_at = now()
    WHERE id = v_enrollment.id;
  END LOOP;

  RETURN v_total;
END;
$$;

-- An inbound reply is an explicit decision to stop the still-pending RB
-- occurrence. It is recorded separately from all stage-driven cancellation.
CREATE OR REPLACE FUNCTION crm.handle_inbound_exit_for_lead(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_context jsonb := crm.get_automation_context(p_lead_id);
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_exit_result jsonb;
  v_total integer := 0;
BEGIN
  IF v_context IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE lead_id = p_lead_id
      AND status = 'active'
  LOOP
    SELECT * INTO v_funnel
    FROM crm.automation_funnels
    WHERE id = v_enrollment.funnel_id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_funnel.entry_source = 'rb'
       AND v_enrollment.rb_decision_key IS NOT NULL
       AND crm.is_rb_same_day_dispatch_enabled(v_enrollment.aces_id) THEN
      IF crm.cancel_rb_same_day_enrollment(
        v_enrollment.id,
        'rb_cancelled_inbound',
        'Lead respondeu antes do disparo RB',
        jsonb_build_object('action', 'inbound_reply')
      ) THEN
        v_total := v_total + 1;
      END IF;
      CONTINUE;
    END IF;

    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);
    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) THEN
      v_total := v_total + crm.stop_automation_enrollment(
        v_enrollment.id,
        'completed',
        'Lead respondeu inbound',
        TRUE
      );
    ELSE
      UPDATE crm.automation_enrollments
      SET
        current_stage_id = NULLIF(v_context->>'stage_id', '')::uuid,
        last_evaluated_at = now(),
        updated_at = now()
      WHERE id = v_enrollment.id;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION crm.find_next_enrollment_step(p_enrollment_id uuid)
RETURNS TABLE(
  step_id uuid,
  is_active boolean,
  step_position integer,
  delay_minutes integer,
  message_template text,
  step_rule jsonb,
  label text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_scoped_progress boolean := FALSE;
BEGIN
  SELECT * INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_scoped_progress := v_enrollment.source_calendar_event_id IS NOT NULL
    OR v_enrollment.source_collection_case_id IS NOT NULL
    OR v_enrollment.source_webhook_receipt_id IS NOT NULL;

  IF NOT v_scoped_progress THEN
    SELECT COALESCE(
      f.entry_source = 'rb' AND crm.is_rb_same_day_dispatch_enabled(v_enrollment.aces_id),
      FALSE
    )
    INTO v_scoped_progress
    FROM crm.automation_funnels AS f
    WHERE f.id = v_enrollment.funnel_id
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT s.id, s.is_active, s.position, s.delay_minutes, s.message_template, s.step_rule, s.label, s.created_at
  FROM crm.automation_steps AS s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND NOT EXISTS (
      SELECT 1
      FROM crm.automation_step_progress AS asp
      WHERE asp.step_id = s.id
        AND (
          (v_scoped_progress AND asp.enrollment_id = v_enrollment.id)
          OR (
            NOT v_scoped_progress
            AND asp.enrollment_id IS NULL
            AND asp.funnel_id = v_enrollment.funnel_id
            AND asp.lead_id = v_enrollment.lead_id
          )
        )
    )
  ORDER BY s.position ASC, s.created_at ASC
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_sent_at timestamptz := now();
  v_scheduled integer := 0;
  v_scoped_progress boolean := FALSE;
  v_is_same_day_rb boolean := FALSE;
BEGIN
  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para conclusao';
  END IF;

  v_is_same_day_rb := v_execution.rb_decision_key IS NOT NULL
    AND crm.is_rb_same_day_dispatch_enabled(v_execution.aces_id);
  v_scoped_progress := v_execution.enrollment_id IS NOT NULL
    AND (
      v_execution.source_calendar_event_id IS NOT NULL
      OR v_execution.source_collection_case_id IS NOT NULL
      OR v_execution.source_webhook_receipt_id IS NOT NULL
      OR v_is_same_day_rb
    );

  UPDATE crm.automation_executions
  SET
    status = 'sent', sent_at = v_sent_at,
    rendered_message = COALESCE(p_rendered_message, rendered_message),
    completed_reason = CASE WHEN v_is_same_day_rb THEN 'rb_sent' ELSE 'sent' END,
    rb_outcome_code = CASE WHEN v_is_same_day_rb THEN 'rb_sent' ELSE rb_outcome_code END,
    rb_outcome_detail = CASE WHEN v_is_same_day_rb
      THEN rb_outcome_detail || jsonb_build_object('sent_at', v_sent_at)
      ELSE rb_outcome_detail END,
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_execution.id;

  IF v_execution.funnel_id IS NOT NULL AND v_execution.step_id IS NOT NULL THEN
    IF v_scoped_progress THEN
      INSERT INTO crm.automation_step_progress (
        aces_id, funnel_id, lead_id, step_id, enrollment_id, sent_execution_id, first_sent_at
      ) VALUES (
        v_execution.aces_id, v_execution.funnel_id, v_execution.lead_id,
        v_execution.step_id, v_execution.enrollment_id, v_execution.id, v_sent_at
      )
      ON CONFLICT (enrollment_id, step_id) WHERE enrollment_id IS NOT NULL DO UPDATE
      SET first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
          sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
          updated_at = now();
    ELSE
      INSERT INTO crm.automation_step_progress (
        aces_id, funnel_id, lead_id, step_id, sent_execution_id, first_sent_at
      ) VALUES (
        v_execution.aces_id, v_execution.funnel_id, v_execution.lead_id,
        v_execution.step_id, v_execution.id, v_sent_at
      )
      ON CONFLICT (funnel_id, lead_id, step_id) WHERE enrollment_id IS NULL DO UPDATE
      SET first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
          sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
          updated_at = now();
    END IF;
  END IF;

  IF v_execution.funnel_id IS NOT NULL AND COALESCE(v_execution.instance_snapshot, '') <> '' THEN
    PERFORM crm.recalculate_automation_funnel_dispatch_state(
      v_execution.aces_id, v_execution.funnel_id, v_execution.instance_snapshot
    );
  END IF;

  IF v_execution.enrollment_id IS NOT NULL THEN
    IF v_is_same_day_rb THEN
      UPDATE crm.automation_enrollments
      SET status = 'completed', stopped_reason = 'rb_decision_sent',
          last_evaluated_at = now(), updated_at = now()
      WHERE id = v_execution.enrollment_id AND status = 'active';
    ELSE
      v_scheduled := crm.schedule_enrollment_executions(v_execution.enrollment_id);
      UPDATE crm.automation_enrollments
      SET last_evaluated_at = now(), updated_at = now()
      WHERE id = v_execution.enrollment_id AND status = 'active';
    END IF;
  END IF;

  IF v_execution.source_collection_case_id IS NOT NULL AND v_scheduled = 0 THEN
    UPDATE collections.cases
    SET communication_status = CASE
          WHEN source_freshness = 'fresh' AND open_receivables_count > 0 THEN 'eligible'
          WHEN source_freshness <> 'fresh' THEN 'stale'
          ELSE 'completed'
        END,
        updated_at = now()
    WHERE id = v_execution.source_collection_case_id
      AND communication_status = 'scheduled';
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'scheduled', v_scheduled);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_fail_automation_execution(
  p_execution_id uuid,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
BEGIN
  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para falha';
  END IF;

  IF v_execution.rb_decision_key IS NOT NULL
     AND crm.is_rb_same_day_dispatch_enabled(v_execution.aces_id) THEN
    PERFORM crm.fail_rb_same_day_execution(
      v_execution.id,
      'rb_provider_failure',
      COALESCE(p_error, 'Falha no envio RB'),
      jsonb_build_object('failed_at', now())
    );
    RETURN jsonb_build_object('success', TRUE);
  END IF;

  UPDATE crm.automation_executions
  SET status = 'failed', last_error = COALESCE(p_error, 'Falha desconhecida'),
      completed_reason = 'failed', attempt_count = attempt_count + 1, updated_at = now()
  WHERE id = v_execution.id;

  IF v_execution.enrollment_id IS NOT NULL THEN
    PERFORM crm.stop_automation_enrollment(
      v_execution.enrollment_id, 'failed', COALESCE(p_error, 'Falha no envio'), FALSE
    );
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_cancel_automation_execution(
  p_execution_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
BEGIN
  SELECT * INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id
    AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para cancelamento';
  END IF;

  IF v_execution.rb_decision_key IS NOT NULL
     AND crm.is_rb_same_day_dispatch_enabled(v_execution.aces_id) THEN
    PERFORM crm.fail_rb_same_day_execution(
      v_execution.id,
      'rb_configuration_failure',
      COALESCE(p_reason, 'Configuracao invalida para o disparo RB'),
      jsonb_build_object('failed_at', now())
    );
    RETURN jsonb_build_object('success', TRUE, 'status', 'failed');
  END IF;

  UPDATE crm.automation_executions
  SET status = 'cancelled', cancelled_at = now(), completed_reason = p_reason,
      last_error = p_reason, claimed_by = NULL, updated_at = now()
  WHERE id = v_execution.id;

  RETURN jsonb_build_object('success', TRUE, 'status', 'cancelled');
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_cancel_automation_execution(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_cancel_automation_execution(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION crm.expire_rb_same_day_dispatches()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_execution_id uuid;
  v_total integer := 0;
  v_today date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  FOR v_execution_id IN
    SELECT ae.id
    FROM crm.automation_executions AS ae
    WHERE ae.rb_decision_key IS NOT NULL
      AND ae.status = 'pending'
      AND ae.rb_decision_local_date < v_today
      AND crm.is_rb_same_day_dispatch_enabled(ae.aces_id)
    FOR UPDATE SKIP LOCKED
  LOOP
    IF crm.fail_rb_same_day_execution(
      v_execution_id,
      'rb_same_day_deadline_exceeded',
      'O disparo RB nao foi concluido na data da decisao',
      jsonb_build_object('expired_at', now())
    ) THEN
      v_total := v_total + 1;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION crm.expire_rb_same_day_dispatches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.expire_rb_same_day_dispatches() TO service_role;

-- The generic claim path re-evaluates stage-based rules. Same-day RB decisions
-- were already validated by the RB query, so they must not be cancelled by a
-- later pipeline move while waiting for their concrete dispatch time.
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
  v_is_same_day_rb boolean := FALSE;
BEGIN
  FOR v_due IN
    SELECT ae.id
    FROM crm.automation_executions AS ae
    WHERE ae.status = 'pending'
      AND ae.scheduled_at <= now()
    ORDER BY ae.scheduled_at ASC, ae.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT
      ae.*,
      s.message_template,
      s.label AS step_label,
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
      f.entry_source,
      f.entry_rule,
      f.exit_rule,
      f.anchor_event,
      f.name AS live_funnel_name,
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
    FROM crm.automation_executions AS ae
    LEFT JOIN crm.automation_steps AS s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels AS f ON f.id = ae.funnel_id
    LEFT JOIN crm.leads AS l ON l.id = ae.lead_id
    LEFT JOIN rb.lead_metadata AS rbm ON rbm.lead_id = l.id
    LEFT JOIN crm.automation_media_assets AS ma
      ON ma.id = COALESCE(ae.media_asset_id_snapshot, s.media_asset_id)
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_is_same_day_rb := v_execution.entry_source = 'rb'
      AND v_execution.rb_decision_key IS NOT NULL
      AND crm.is_rb_same_day_dispatch_enabled(v_execution.aces_id);

    IF v_execution.funnel_is_active IS DISTINCT FROM TRUE THEN
      IF v_is_same_day_rb THEN
        PERFORM crm.fail_rb_same_day_execution(v_execution.id, 'rb_funnel_inactive', 'Automacao RB inativa');
      ELSE
        UPDATE crm.automation_executions
        SET status = 'cancelled', cancelled_at = now(), last_error = 'Automacao inativa', updated_at = now()
        WHERE id = v_execution.id;
      END IF;
      CONTINUE;
    END IF;

    IF v_execution.step_is_active IS DISTINCT FROM TRUE THEN
      IF v_is_same_day_rb THEN
        PERFORM crm.fail_rb_same_day_execution(v_execution.id, 'rb_step_inactive', 'Mensagem RB inativa');
      ELSE
        UPDATE crm.automation_executions
        SET status = 'cancelled', cancelled_at = now(), last_error = 'Mensagem inativa', updated_at = now()
        WHERE id = v_execution.id;
      END IF;
      CONTINUE;
    END IF;

    v_context := crm.get_automation_context(v_execution.lead_id);
    IF v_context IS NULL OR COALESCE((v_context->>'view')::boolean, TRUE) = FALSE THEN
      IF v_is_same_day_rb THEN
        PERFORM crm.fail_rb_same_day_execution(v_execution.id, 'rb_lead_unavailable', 'Lead invisivel ou inexistente');
      ELSE
        UPDATE crm.automation_executions
        SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead invisivel ou inexistente', updated_at = now()
        WHERE id = v_execution.id;
      END IF;
      CONTINUE;
    END IF;

    IF NOT v_is_same_day_rb THEN
      IF v_execution.entry_rule IS NULL
         OR (
           COALESCE(v_execution.entry_rule->>'type', 'group') = 'group'
           AND jsonb_typeof(v_execution.entry_rule->'children') = 'array'
           AND jsonb_array_length(v_execution.entry_rule->'children') = 0
         )
      THEN
        v_entry_result := jsonb_build_object('matched', TRUE);
      ELSE
        v_entry_result := crm.evaluate_automation_rule_node(
          v_execution.entry_rule,
          v_context,
          crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
        );
      END IF;

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
    END IF;

    v_rendered_template := crm.render_automation_text_or_null(
      v_execution.message_template, v_execution.live_lead_name, v_execution.live_phone,
      v_execution.live_city, v_execution.live_status, v_execution.live_rb_pix_key,
      v_execution.live_rb_total_amount, v_execution.live_rb_next_due_date,
      v_execution.live_rb_titles_count, v_execution.live_rb_store_emp_id,
      v_execution.live_rb_store_emp_cpf_cnpj
    );
    v_rendered_caption := crm.render_automation_text_or_null(
      v_execution.media_caption, v_execution.live_lead_name, v_execution.live_phone,
      v_execution.live_city, v_execution.live_status, v_execution.live_rb_pix_key,
      v_execution.live_rb_total_amount, v_execution.live_rb_next_due_date,
      v_execution.live_rb_titles_count, v_execution.live_rb_store_emp_id,
      v_execution.live_rb_store_emp_cpf_cnpj
    );

    UPDATE crm.automation_executions
    SET
      status = 'processing', claimed_by = 'worker', rendered_message = v_rendered_template,
      phone_snapshot = v_execution.live_phone, instance_snapshot = v_execution.live_instance_name,
      lead_name_snapshot = v_execution.live_lead_name, city_snapshot = v_execution.live_city,
      status_snapshot = v_execution.live_status, funnel_name_snapshot = v_execution.live_funnel_name,
      step_label_snapshot = COALESCE(v_execution.step_label_snapshot, v_execution.step_label),
      step_rule_snapshot = v_execution.step_rule,
        anchor_at_snapshot = CASE WHEN v_is_same_day_rb THEN v_execution.anchor_at_snapshot
        ELSE crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context) END,
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
    step_label := COALESCE(v_execution.step_label_snapshot, v_execution.step_label);
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

GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM PUBLIC, anon, authenticated;

-- Pilot activation: keep all other RB accounts on the legacy stage-driven
-- dispatcher until the two-cycle production validation is complete.
UPDATE crm.accounts
SET rb_same_day_dispatch_enabled = TRUE
WHERE id = 5;
