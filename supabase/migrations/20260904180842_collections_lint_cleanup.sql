CREATE OR REPLACE FUNCTION collections.set_active_dispatcher(
  p_aces_id integer,
  p_dispatcher text,
  p_reason text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_dispatcher NOT IN ('legacy_rb', 'canonical', 'paused') THEN
    RAISE EXCEPTION 'COLLECTION_INVALID_DISPATCHER';
  END IF;

  INSERT INTO collections.runtime_controls (aces_id, active_dispatcher)
  VALUES (p_aces_id, p_dispatcher)
  ON CONFLICT (aces_id) DO UPDATE
  SET active_dispatcher = EXCLUDED.active_dispatcher,
      changed_by = p_actor_id,
      change_reason = left(p_reason, 500),
      changed_at = now(),
      updated_at = now();

  INSERT INTO collections.operational_events (aces_id, event_type, severity, actor_id, details)
  VALUES (
    p_aces_id,
    'dispatcher_changed',
    CASE WHEN p_dispatcher = 'paused' THEN 'warning' ELSE 'info' END,
    p_actor_id,
    jsonb_build_object('dispatcher', p_dispatcher, 'reason', left(p_reason, 500))
  );

  RETURN jsonb_build_object('activeDispatcher', p_dispatcher);
END;
$$;

GRANT EXECUTE ON FUNCTION collections.set_active_dispatcher(integer, text, text, uuid) TO service_role;
