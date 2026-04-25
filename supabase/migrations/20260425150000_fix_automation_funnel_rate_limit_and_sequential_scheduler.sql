CREATE TABLE IF NOT EXISTS crm.automation_funnel_dispatch_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES crm.automation_funnels(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  next_available_at timestamptz,
  last_dispatch_at timestamptz,
  streak_without_long_pause integer NOT NULL DEFAULT 0 CHECK (streak_without_long_pause >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_funnel_dispatch_state_scope_unique UNIQUE (aces_id, funnel_id, instance_name)
);

DROP TRIGGER IF EXISTS trg_automation_funnel_dispatch_state_updated_at
  ON crm.automation_funnel_dispatch_state;
CREATE TRIGGER trg_automation_funnel_dispatch_state_updated_at
BEFORE UPDATE ON crm.automation_funnel_dispatch_state
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION crm.recalculate_automation_funnel_dispatch_state(
  p_aces_id integer,
  p_funnel_id uuid,
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
  IF p_aces_id IS NULL OR p_funnel_id IS NULL OR COALESCE(p_instance_name, '') = '' THEN
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
    AND ae.funnel_id = p_funnel_id
    AND ae.instance_snapshot = p_instance_name
    AND ae.status IN ('pending', 'processing')
    AND COALESCE((ae.dispatch_meta->>'awaiting_humanized_slot')::boolean, FALSE) = TRUE;

  SELECT max(ae.sent_at)
  INTO v_last_dispatch_at
  FROM crm.automation_executions ae
  WHERE ae.aces_id = p_aces_id
    AND ae.funnel_id = p_funnel_id
    AND ae.instance_snapshot = p_instance_name
    AND ae.status = 'sent'
    AND ae.sent_at IS NOT NULL;

  INSERT INTO crm.automation_funnel_dispatch_state (
    aces_id,
    funnel_id,
    instance_name,
    next_available_at,
    last_dispatch_at,
    streak_without_long_pause
  )
  VALUES (
    p_aces_id,
    p_funnel_id,
    p_instance_name,
    v_next_available_at,
    v_last_dispatch_at,
    0
  )
  ON CONFLICT (aces_id, funnel_id, instance_name)
  DO UPDATE SET
    next_available_at = EXCLUDED.next_available_at,
    last_dispatch_at = COALESCE(EXCLUDED.last_dispatch_at, crm.automation_funnel_dispatch_state.last_dispatch_at),
    streak_without_long_pause = CASE
      WHEN EXCLUDED.last_dispatch_at IS NULL
        OR now() - EXCLUDED.last_dispatch_at > interval '15 minutes'
      THEN 0
      ELSE crm.automation_funnel_dispatch_state.streak_without_long_pause
    END,
    updated_at = now();

  RETURN jsonb_build_object(
    'success', TRUE,
    'updated', TRUE,
    'next_available_at', v_next_available_at,
    'last_dispatch_at', v_last_dispatch_at
  );
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
  v_state crm.automation_funnel_dispatch_state%ROWTYPE;
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

  IF COALESCE(v_execution.humanized_dispatch_enabled, FALSE) = FALSE
    OR v_execution.funnel_id IS NULL THEN
    RETURN jsonb_build_object(
      'action', 'send_now',
      'humanized', COALESCE(v_execution.humanized_dispatch_enabled, FALSE),
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
    format(
      'automation_dispatch:%s:%s:%s',
      v_execution.aces_id,
      v_execution.funnel_id,
      v_execution.instance_name
    ),
    0
  );

  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT *
  INTO v_state
  FROM crm.automation_funnel_dispatch_state
  WHERE aces_id = v_execution.aces_id
    AND funnel_id = v_execution.funnel_id
    AND instance_name = v_execution.instance_name
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO crm.automation_funnel_dispatch_state (
      aces_id,
      funnel_id,
      instance_name,
      next_available_at,
      last_dispatch_at,
      streak_without_long_pause
    )
    VALUES (
      v_execution.aces_id,
      v_execution.funnel_id,
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

  v_effective_next_available_at := COALESCE(v_state.next_available_at, v_active_latest_at);

  IF v_state.next_available_at IS NOT NULL
    AND (
      v_active_latest_at IS NULL
      OR v_state.next_available_at > v_active_latest_at + interval '5 minutes'
    ) THEN
    v_effective_next_available_at := v_active_latest_at;
  END IF;

  IF v_state.next_available_at IS DISTINCT FROM v_effective_next_available_at THEN
    UPDATE crm.automation_funnel_dispatch_state
    SET
      next_available_at = v_effective_next_available_at,
      updated_at = now()
    WHERE id = v_state.id;
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

  UPDATE crm.automation_funnel_dispatch_state
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

CREATE OR REPLACE FUNCTION crm.find_next_enrollment_step(p_enrollment_id uuid)
RETURNS TABLE (
  step_id uuid,
  is_active boolean,
  step_position integer,
  delay_minutes integer,
  message_template text,
  step_rule jsonb,
  label text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.is_active,
    s.position AS step_position,
    s.delay_minutes,
    s.message_template,
    s.step_rule,
    s.label,
    s.created_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND NOT EXISTS (
      SELECT 1
      FROM crm.automation_step_progress asp
      WHERE asp.funnel_id = v_enrollment.funnel_id
        AND asp.lead_id = v_enrollment.lead_id
        AND asp.step_id = s.id
    )
  ORDER BY s.position ASC, s.created_at ASC
  LIMIT 1;
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
  v_count integer := 0;
  v_next record;
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
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '')
    OR v_lead.owner_id IS DISTINCT FROM v_funnel.created_by THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.automation_executions ae
    WHERE ae.enrollment_id = v_enrollment.id
      AND ae.status IN ('pending', 'processing')
  ) THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_next
  FROM crm.find_next_enrollment_step(v_enrollment.id)
  LIMIT 1;

  IF NOT FOUND OR v_next.step_id IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_next.is_active, TRUE) = FALSE THEN
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
  VALUES (
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    v_next.step_id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.anchor_at + make_interval(mins => v_next.delay_minutes),
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    v_next.label,
    v_next.step_rule,
    v_enrollment.anchor_at
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_sent_at timestamptz := now();
  v_scheduled integer := 0;
BEGIN
  SELECT *
  INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id
    AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para conclusao';
  END IF;

  UPDATE crm.automation_executions
  SET
    status = 'sent',
    sent_at = v_sent_at,
    rendered_message = COALESCE(p_rendered_message, rendered_message),
    completed_reason = 'sent',
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_execution.id;

  IF v_execution.funnel_id IS NOT NULL
    AND v_execution.step_id IS NOT NULL THEN
    INSERT INTO crm.automation_step_progress (
      aces_id,
      funnel_id,
      lead_id,
      step_id,
      sent_execution_id,
      first_sent_at
    )
    VALUES (
      v_execution.aces_id,
      v_execution.funnel_id,
      v_execution.lead_id,
      v_execution.step_id,
      v_execution.id,
      v_sent_at
    )
    ON CONFLICT (funnel_id, lead_id, step_id) DO UPDATE
    SET
      first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
      sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
      updated_at = now();
  END IF;

  IF v_execution.funnel_id IS NOT NULL
    AND COALESCE(v_execution.instance_snapshot, '') <> '' THEN
    PERFORM crm.recalculate_automation_funnel_dispatch_state(
      v_execution.aces_id,
      v_execution.funnel_id,
      v_execution.instance_snapshot
    );
  END IF;

  IF v_execution.enrollment_id IS NOT NULL THEN
    v_scheduled := crm.schedule_enrollment_executions(v_execution.enrollment_id);

    UPDATE crm.automation_enrollments
    SET
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_execution.enrollment_id
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'scheduled', v_scheduled
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_humanized_dispatch_sent(
  p_execution_id uuid,
  p_sent_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_execution record;
BEGIN
  SELECT
    ae.aces_id,
    ae.funnel_id,
    ae.instance_snapshot AS instance_name,
    af.humanized_dispatch_enabled
  INTO v_execution
  FROM crm.automation_executions ae
  LEFT JOIN crm.automation_funnels af
    ON af.id = ae.funnel_id
  WHERE ae.id = p_execution_id
  LIMIT 1;

  IF NOT FOUND
    OR COALESCE(v_execution.humanized_dispatch_enabled, FALSE) = FALSE
    OR v_execution.funnel_id IS NULL
    OR COALESCE(v_execution.instance_name, '') = '' THEN
    RETURN jsonb_build_object('success', TRUE, 'updated', FALSE);
  END IF;

  INSERT INTO crm.automation_funnel_dispatch_state (
    aces_id,
    funnel_id,
    instance_name,
    next_available_at,
    last_dispatch_at,
    streak_without_long_pause
  )
  VALUES (
    v_execution.aces_id,
    v_execution.funnel_id,
    v_execution.instance_name,
    NULL,
    p_sent_at,
    0
  )
  ON CONFLICT (aces_id, funnel_id, instance_name)
  DO UPDATE SET
    last_dispatch_at = GREATEST(
      COALESCE(crm.automation_funnel_dispatch_state.last_dispatch_at, p_sent_at),
      p_sent_at
    ),
    updated_at = now();

  RETURN jsonb_build_object('success', TRUE, 'updated', TRUE);
END;
$function$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_funnel_dispatch_state TO service_role;
GRANT EXECUTE ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.find_next_enrollment_step(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.schedule_enrollment_executions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.find_next_enrollment_step(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.find_next_enrollment_step(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.schedule_enrollment_executions(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION crm.schedule_enrollment_executions(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.schedule_enrollment_executions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) FROM PUBLIC;
