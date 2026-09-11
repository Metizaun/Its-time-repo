CREATE TABLE collections.webhook_rate_limits (
  source_connection_id uuid NOT NULL REFERENCES collections.source_connections(id) ON DELETE CASCADE,
  ip_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  PRIMARY KEY (source_connection_id, ip_hash, window_started_at)
);

ALTER TABLE collections.webhook_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collections.webhook_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections.webhook_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION collections.consume_webhook_rate_limit(
  p_source_connection_id uuid,
  p_ip text,
  p_limit integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  DELETE FROM collections.webhook_rate_limits
  WHERE window_started_at < now() - interval '10 minutes';

  INSERT INTO collections.webhook_rate_limits (
    source_connection_id, ip_hash, window_started_at, request_count
  ) VALUES (
    p_source_connection_id,
    encode(extensions.digest(COALESCE(p_ip, 'unknown'), 'sha256'), 'hex'),
    v_window,
    1
  )
  ON CONFLICT (source_connection_id, ip_hash, window_started_at)
  DO UPDATE SET request_count = collections.webhook_rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= LEAST(GREATEST(COALESCE(p_limit, 120), 1), 10000);
END;
$$;

REVOKE ALL ON FUNCTION collections.consume_webhook_rate_limit(uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.consume_webhook_rate_limit(uuid, text, integer)
  TO service_role;
