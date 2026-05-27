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
  IF p_aces_id IS NULL OR p_funnel_id IS NULL OR COALESCE(btrim(p_instance_name), '') = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'updated', FALSE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.aces_id = p_aces_id
      AND i.instancia = p_instance_name
  ) THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'updated', FALSE,
      'skipped', TRUE,
      'reason', 'instance_not_found'
    );
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
  IF p_aces_id IS NULL OR COALESCE(btrim(p_instance_name), '') = '' THEN
    RETURN jsonb_build_object('success', FALSE, 'updated', FALSE);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.aces_id = p_aces_id
      AND i.instancia = p_instance_name
  ) THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'updated', FALSE,
      'skipped', TRUE,
      'reason', 'instance_not_found'
    );
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
      RETURNING aces_id, funnel_id, instance_snapshot
    )
    SELECT aces_id, funnel_id, instance_snapshot, count(*)::integer AS row_count
    FROM cancelled
    GROUP BY aces_id, funnel_id, instance_snapshot
  LOOP
    v_count := v_count + v_affected.row_count;

    IF v_affected.funnel_id IS NOT NULL
      AND COALESCE(btrim(v_affected.instance_snapshot), '') <> '' THEN
      PERFORM crm.recalculate_automation_funnel_dispatch_state(
        v_affected.aces_id,
        v_affected.funnel_id,
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
      RETURNING aces_id, funnel_id, instance_snapshot
    )
    SELECT aces_id, funnel_id, instance_snapshot, count(*)::integer AS row_count
    FROM cancelled
    GROUP BY aces_id, funnel_id, instance_snapshot
  LOOP
    v_count := v_count + v_affected.row_count;

    IF v_affected.funnel_id IS NOT NULL
      AND COALESCE(btrim(v_affected.instance_snapshot), '') <> '' THEN
      PERFORM crm.recalculate_automation_funnel_dispatch_state(
        v_affected.aces_id,
        v_affected.funnel_id,
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
      RETURNING aces_id, funnel_id, instance_snapshot
    )
    SELECT aces_id, funnel_id, instance_snapshot, count(*)::integer AS row_count
    FROM cancelled
    GROUP BY aces_id, funnel_id, instance_snapshot
  LOOP
    v_count := v_count + v_affected.row_count;

    IF v_affected.funnel_id IS NOT NULL
      AND COALESCE(btrim(v_affected.instance_snapshot), '') <> '' THEN
      PERFORM crm.recalculate_automation_funnel_dispatch_state(
        v_affected.aces_id,
        v_affected.funnel_id,
        v_affected.instance_snapshot
      );
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

WITH stale_pending AS (
  SELECT ae.id
  FROM crm.automation_executions ae
  LEFT JOIN crm.automation_funnels af
    ON af.id = ae.funnel_id
  LEFT JOIN crm.instance i
    ON i.aces_id = ae.aces_id
   AND i.instancia = ae.instance_snapshot
  WHERE ae.status = 'pending'
    AND (
      COALESCE(ae.instance_snapshot, '') = ''
      OR i.instancia IS NULL
      OR (
        af.id IS NOT NULL
        AND COALESCE(ae.instance_snapshot, '') <> COALESCE(af.instance_name, '')
      )
    )
)
UPDATE crm.automation_executions ae
SET
  status = 'cancelled',
  cancelled_at = now(),
  completed_reason = COALESCE(ae.completed_reason, 'Snapshot de instancia invalido ou antigo'),
  last_error = COALESCE(ae.last_error, 'Snapshot de instancia invalido ou antigo'),
  updated_at = now()
FROM stale_pending sp
WHERE ae.id = sp.id;

GRANT EXECUTE ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.cancel_pending_executions_for_funnel(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.cancel_pending_executions_for_step(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.cancel_pending_executions_for_enrollment(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.recalculate_automation_funnel_dispatch_state(integer, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) FROM anon;
REVOKE ALL ON FUNCTION crm.recalculate_automation_instance_dispatch_state(integer, text) FROM PUBLIC;
