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
  v_limit_per_hour integer;
  v_base_gap_seconds integer;
  v_random_offset_seconds integer;
  v_effective_gap_seconds integer;
  v_effective_gap interval;
  v_base_at timestamptz;
  v_dispatch_at timestamptz;
  v_preparation_interval interval;
  v_active_latest_at timestamptz;
  v_effective_next_available_at timestamptz;
  v_min_dispatch_at timestamptz;
  v_floor_base_at timestamptz;
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
  v_limit_per_hour := GREATEST(COALESCE(v_execution.dispatch_limit_per_hour, 40), 1);

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

  SELECT max(occupied_at)
  INTO v_active_latest_at
  FROM (
    SELECT ae.sent_at AS occupied_at
    FROM crm.automation_executions ae
    WHERE ae.funnel_id = v_execution.funnel_id
      AND ae.instance_snapshot = v_execution.instance_name
      AND ae.status = 'sent'
      AND ae.sent_at IS NOT NULL

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

  v_effective_next_available_at := COALESCE(v_state.next_available_at, v_active_latest_at);

  IF v_state.next_available_at IS NOT NULL
    AND (
      v_active_latest_at IS NULL
      OR v_state.next_available_at > v_active_latest_at + interval '10 minutes'
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
    v_base_gap_seconds := GREATEST(
      COALESCE(NULLIF(v_existing_meta->>'base_gap_seconds', '')::integer, ceil(3600.0 / v_limit_per_hour)::integer),
      60
    );
    v_effective_gap_seconds := GREATEST(
      COALESCE(NULLIF(v_existing_meta->>'effective_gap_seconds', '')::integer, v_base_gap_seconds),
      60
    );
    v_random_offset_seconds := COALESCE(
      NULLIF(v_existing_meta->>'random_offset_seconds', '')::integer,
      v_effective_gap_seconds - v_base_gap_seconds
    );
    v_effective_gap_seconds := GREATEST(v_base_gap_seconds + v_random_offset_seconds, 60);
    v_random_offset_seconds := v_effective_gap_seconds - v_base_gap_seconds;
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
    v_base_gap_seconds := GREATEST(ceil(3600.0 / v_limit_per_hour)::integer, 60);
    v_random_offset_seconds := round((((random() * 55.0) - 20.0) / 100.0) * v_base_gap_seconds)::integer;
    v_effective_gap_seconds := GREATEST(v_base_gap_seconds + v_random_offset_seconds, 60);
    v_random_offset_seconds := v_effective_gap_seconds - v_base_gap_seconds;
  END IF;

  v_preparation_interval := (v_preparation_ms::text || ' milliseconds')::interval;
  v_effective_gap := (v_effective_gap_seconds::text || ' seconds')::interval;

  IF v_waiting_slot AND v_existing_planned_at IS NOT NULL THEN
    v_base_at := GREATEST(v_existing_planned_at - v_preparation_interval, v_now - v_preparation_interval);
  ELSE
    v_base_at := GREATEST(v_now, COALESCE(v_effective_next_available_at, v_now));
  END IF;

  v_dispatch_at := crm.resolve_humanized_dispatch_at(v_base_at, v_preparation_ms);

  IF v_active_latest_at IS NOT NULL THEN
    v_min_dispatch_at := v_active_latest_at + v_effective_gap;

    IF v_dispatch_at < v_min_dispatch_at THEN
      v_floor_base_at := v_min_dispatch_at - v_preparation_interval;
      v_dispatch_at := crm.resolve_humanized_dispatch_at(v_floor_base_at, v_preparation_ms);
    END IF;
  END IF;

  UPDATE crm.automation_funnel_dispatch_state
  SET
    next_available_at = v_dispatch_at,
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
      'dispatch_limit_per_hour', v_limit_per_hour,
      'rate_limit_scope', 'automation',
      'cadence_version', 2,
      'base_gap_seconds', v_base_gap_seconds,
      'random_offset_seconds', v_random_offset_seconds,
      'effective_gap_seconds', v_effective_gap_seconds,
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

CREATE OR REPLACE FUNCTION crm.replan_pending_humanized_funnel_dispatches(p_funnel_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_execution record;
  v_plan jsonb;
  v_replanned integer := 0;
BEGIN
  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(v_funnel.humanized_dispatch_enabled, FALSE) = FALSE THEN
    RETURN 0;
  END IF;

  UPDATE crm.automation_executions
  SET
    dispatch_meta = jsonb_strip_nulls(
      (
        COALESCE(dispatch_meta, '{}'::jsonb) - ARRAY[
          'planned_dispatch_at',
          'planned_at',
          'base_gap_seconds',
          'random_offset_seconds',
          'effective_gap_seconds',
          'rate_limit_scope',
          'cadence_version'
        ]::text[]
      ) || jsonb_build_object('awaiting_humanized_slot', FALSE)
    ),
    updated_at = now()
  WHERE funnel_id = v_funnel.id
    AND status = 'pending'
    AND COALESCE(instance_snapshot, '') = COALESCE(v_funnel.instance_name, '');

  PERFORM crm.recalculate_automation_funnel_dispatch_state(
    v_funnel.aces_id,
    v_funnel.id,
    v_funnel.instance_name
  );

  FOR v_execution IN
    SELECT
      ae.id,
      COALESCE(ae.rendered_message, s.message_template, '') AS message_text
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s
      ON s.id = ae.step_id
    WHERE ae.funnel_id = v_funnel.id
      AND ae.status = 'pending'
      AND COALESCE(ae.instance_snapshot, '') = COALESCE(v_funnel.instance_name, '')
    ORDER BY ae.scheduled_at ASC, ae.created_at ASC, ae.id ASC
  LOOP
    v_plan := crm.rpc_plan_humanized_dispatch(
      v_execution.id,
      char_length(COALESCE(v_execution.message_text, ''))
    );

    UPDATE crm.automation_executions
    SET
      scheduled_at = COALESCE(NULLIF(v_plan->>'dispatch_at', '')::timestamptz, scheduled_at),
      dispatch_meta = COALESCE(NULLIF(v_plan->'dispatch_meta', 'null'::jsonb), dispatch_meta, '{}'::jsonb),
      updated_at = now()
    WHERE id = v_execution.id;

    v_replanned := v_replanned + 1;
  END LOOP;

  RETURN v_replanned;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.replan_pending_humanized_funnel_dispatches(uuid) TO service_role;

REVOKE ALL ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.replan_pending_humanized_funnel_dispatches(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION crm.replan_pending_humanized_funnel_dispatches(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.replan_pending_humanized_funnel_dispatches(uuid) FROM PUBLIC;
