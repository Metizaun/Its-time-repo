ALTER TABLE crm.automation_funnels
  ADD COLUMN IF NOT EXISTS humanized_dispatch_enabled boolean NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS dispatch_limit_per_hour integer NOT NULL DEFAULT 40
    CHECK (dispatch_limit_per_hour > 0);

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS dispatch_meta jsonb;

CREATE TABLE IF NOT EXISTS crm.automation_instance_dispatch_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  next_available_at timestamptz,
  last_dispatch_at timestamptz,
  streak_without_long_pause integer NOT NULL DEFAULT 0 CHECK (streak_without_long_pause >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_instance_dispatch_state_account_instance_unique UNIQUE (aces_id, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_automation_executions_sent_rate_limit
  ON crm.automation_executions(funnel_id, instance_snapshot, sent_at DESC)
  WHERE status = 'sent'
    AND sent_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_automation_executions_planned_dispatch
  ON crm.automation_executions(
    funnel_id,
    instance_snapshot,
    scheduled_at
  )
  WHERE status IN ('pending', 'processing');

CREATE OR REPLACE FUNCTION crm.is_humanized_dispatch_window(
  p_at timestamptz,
  p_timezone text DEFAULT 'America/Sao_Paulo'
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT
    (p_at AT TIME ZONE COALESCE(NULLIF(btrim(p_timezone), ''), 'America/Sao_Paulo'))::time >= time '08:00:00'
    AND (p_at AT TIME ZONE COALESCE(NULLIF(btrim(p_timezone), ''), 'America/Sao_Paulo'))::time < time '19:00:00';
$function$;

CREATE OR REPLACE FUNCTION crm.resolve_humanized_dispatch_at(
  p_base_at timestamptz,
  p_preparation_ms integer,
  p_timezone text DEFAULT 'America/Sao_Paulo'
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_timezone text := COALESCE(NULLIF(btrim(p_timezone), ''), 'America/Sao_Paulo');
  v_preparation interval := ((GREATEST(COALESCE(p_preparation_ms, 0), 0))::text || ' milliseconds')::interval;
  v_start_local timestamp;
  v_dispatch_local timestamp;
  v_day date;
BEGIN
  v_start_local := p_base_at AT TIME ZONE v_timezone;
  v_day := v_start_local::date;

  IF v_start_local::time < time '08:00:00' THEN
    v_start_local := v_day::timestamp + time '08:00:00';
  ELSIF v_start_local::time >= time '18:00:00' THEN
    v_start_local := (v_day + 1)::timestamp + time '08:00:00';
  END IF;

  v_dispatch_local := v_start_local + v_preparation;

  IF v_dispatch_local::date > v_start_local::date OR v_dispatch_local::time >= time '19:00:00' THEN
    v_start_local := (v_start_local::date + 1)::timestamp + time '08:00:00';
    v_dispatch_local := v_start_local + v_preparation;
  END IF;

  RETURN v_dispatch_local AT TIME ZONE v_timezone;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.find_next_rate_limited_dispatch_at(
  p_candidate timestamptz,
  p_limit integer,
  p_occupied_slots timestamptz[]
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_candidate timestamptz := p_candidate;
  v_slot timestamptz;
  v_oldest timestamptz;
  v_count integer;
BEGIN
  IF COALESCE(p_limit, 0) <= 0 THEN
    RETURN v_candidate;
  END IF;

  LOOP
    v_count := 0;
    v_oldest := NULL;

    FOREACH v_slot IN ARRAY COALESCE(p_occupied_slots, ARRAY[]::timestamptz[])
    LOOP
      IF v_slot > v_candidate - interval '1 hour' AND v_slot <= v_candidate THEN
        v_count := v_count + 1;

        IF v_oldest IS NULL OR v_slot < v_oldest THEN
          v_oldest := v_slot;
        END IF;
      END IF;
    END LOOP;

    EXIT WHEN v_count < p_limit OR v_oldest IS NULL;

    v_candidate := v_oldest + interval '1 hour';
  END LOOP;

  RETURN v_candidate;
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

  v_last_activity_at := GREATEST(
    COALESCE(v_state.last_dispatch_at, '-infinity'::timestamptz),
    COALESCE(v_state.next_available_at, '-infinity'::timestamptz)
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

  IF v_waiting_slot AND v_existing_planned_at IS NOT NULL THEN
    v_base_at := GREATEST(v_existing_planned_at - v_preparation_interval, v_now - v_preparation_interval);
  ELSE
    v_base_at := GREATEST(v_now, COALESCE(v_state.next_available_at, v_now));
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
    ae.instance_snapshot AS instance_name,
    af.humanized_dispatch_enabled
  INTO v_execution
  FROM crm.automation_executions ae
  LEFT JOIN crm.automation_funnels af
    ON af.id = ae.funnel_id
  WHERE ae.id = p_execution_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(v_execution.humanized_dispatch_enabled, FALSE) = FALSE THEN
    RETURN jsonb_build_object('success', TRUE, 'updated', FALSE);
  END IF;

  UPDATE crm.automation_instance_dispatch_state
  SET
    last_dispatch_at = GREATEST(COALESCE(last_dispatch_at, p_sent_at), p_sent_at),
    updated_at = now()
  WHERE aces_id = v_execution.aces_id
    AND instance_name = v_execution.instance_name;

  RETURN jsonb_build_object('success', TRUE, 'updated', TRUE);
END;
$function$;

DROP TRIGGER IF EXISTS trg_automation_instance_dispatch_state_updated_at
  ON crm.automation_instance_dispatch_state;
CREATE TRIGGER trg_automation_instance_dispatch_state_updated_at
BEFORE UPDATE ON crm.automation_instance_dispatch_state
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_instance_dispatch_state TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) TO service_role;

REVOKE ALL ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_plan_humanized_dispatch(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_mark_humanized_dispatch_sent(uuid, timestamptz) FROM PUBLIC;
