-- Keep pull eligibility on the same per-source resolver used by case
-- enrollment, execution validation, and the legacy RB worker guard.
CREATE OR REPLACE FUNCTION collections.claim_due_pull_sources(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 900
)
RETURNS SETOF collections.source_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT sc.id
    FROM collections.source_connections sc
    WHERE sc.status = 'active'
      AND sc.delivery_mode = 'pull'
      AND collections.resolve_source_dispatcher(sc.id) = 'canonical'
      AND (
        sc.pull_locked_at IS NULL
        OR sc.pull_locked_at < now() - make_interval(secs => GREATEST(p_lease_seconds, 60))
      )
      AND COALESCE(sc.config->>'lastPullLocalDate', '')
        <> (now() AT TIME ZONE sc.timezone)::date::text
      AND COALESCE(NULLIF(sc.config->>'triggerTime', ''), '08:00')
        <= to_char(now() AT TIME ZONE sc.timezone, 'HH24:MI')
    ORDER BY sc.last_success_at NULLS FIRST, sc.created_at, sc.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 100)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE collections.source_connections sc
  SET pull_locked_at = now(), pull_locked_by = left(p_worker_id, 200), updated_at = now()
  FROM candidates c
  WHERE sc.id = c.id
  RETURNING sc.*;
END;
$$;

GRANT EXECUTE ON FUNCTION collections.claim_due_pull_sources(text, integer, integer) TO service_role;
