-- Instagram Sets 5/6: explicit expired-token transition for manual operations.

CREATE OR REPLACE FUNCTION instagram.rpc_mark_reconnect_required(
  p_channel_id uuid,
  p_aces_id integer,
  p_error_code text DEFAULT 'token_expired'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE instagram.channels
  SET health_status = 'reconnect_required',
      next_refresh_at = NULL,
      refresh_claimed_by = NULL,
      refresh_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      last_error_code = left(COALESCE(NULLIF(btrim(p_error_code), ''), 'token_expired'), 120),
      last_error_at = now()
  WHERE channel_id = p_channel_id
    AND aces_id = p_aces_id
    AND health_status <> 'disabled';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE crm.instance_channels
    SET status = 'reconnect_required'
    WHERE id = p_channel_id
      AND aces_id = p_aces_id
      AND provider = 'instagram'
      AND status <> 'disabled';
  END IF;

  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION instagram.rpc_mark_reconnect_required(uuid, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION instagram.rpc_mark_reconnect_required(uuid, integer, text)
  TO service_role;

NOTIFY pgrst, 'reload schema';
