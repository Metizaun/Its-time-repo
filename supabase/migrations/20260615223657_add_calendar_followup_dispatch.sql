-- Calendar follow-up dispatch support applied to the remote Supabase project.
-- Adds an in-flight status and service-role RPCs used by the backend worker.

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'calendar'
    AND t.relname = 'events'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%followup_1h_status%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE calendar.events DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE calendar.events
    ADD CONSTRAINT calendar_events_followup_1h_status_check
    CHECK (followup_1h_status IN ('disabled', 'pending', 'sending', 'sent', 'failed', 'skipped'));
END;
$$;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'crm'
    AND t.relname = 'outbound_echo_registry'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%origin%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE crm.outbound_echo_registry DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE crm.outbound_echo_registry
    ADD CONSTRAINT outbound_echo_registry_origin_check
    CHECK (origin IN ('manual', 'ai', 'automation', 'calendar_followup'));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_calendar_events_followup_due
  ON calendar.events(followup_1h_status, start_time)
  WHERE deleted_at IS NULL
    AND followup_1h_enabled = true;

CREATE OR REPLACE FUNCTION calendar.rpc_claim_due_followup_events(p_limit integer DEFAULT 25)
RETURNS TABLE (
  event_id uuid,
  aces_id integer,
  lead_id uuid,
  title text,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  all_day boolean,
  location text,
  meeting_url text,
  metadata jsonb,
  lead_name text,
  contact_phone text,
  instance_name text,
  attempt_count integer
)
LANGUAGE plpgsql
SET search_path = calendar, crm, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_limit integer;
BEGIN
  IF COALESCE(p_limit, 25) <= 0 THEN
    RETURN;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);

  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM calendar.events e
    WHERE e.deleted_at IS NULL
      AND e.followup_1h_enabled = true
      AND e.followup_1h_status = 'pending'
      AND e.status IN ('scheduled', 'confirmed')
      AND e.start_time - interval '1 hour' <= v_now
      AND e.start_time > v_now
      AND (
        e.followup_1h_last_attempt_at IS NULL
        OR e.followup_1h_last_attempt_at <= v_now - interval '5 minutes'
      )
    ORDER BY e.start_time ASC, e.created_at ASC
    LIMIT v_limit
    FOR UPDATE OF e SKIP LOCKED
  ),
  claimed AS (
    UPDATE calendar.events e
    SET
      followup_1h_status = 'sending',
      followup_1h_last_attempt_at = v_now,
      followup_1h_error = NULL,
      metadata = jsonb_set(
        jsonb_set(
          COALESCE(e.metadata, '{}'::jsonb),
          '{followup_1h_attempt_count}',
          to_jsonb(
            (
              CASE
                WHEN COALESCE(e.metadata->>'followup_1h_attempt_count', '') ~ '^[0-9]+$'
                  THEN (e.metadata->>'followup_1h_attempt_count')::integer
                ELSE 0
              END
            ) + 1
          ),
          true
        ),
        '{followup_1h_claimed_at}',
        to_jsonb(v_now::text),
        true
      ),
      updated_at = v_now
    FROM candidates c
    WHERE e.id = c.id
    RETURNING e.*
  )
  SELECT
    c.id AS event_id,
    c.aces_id,
    c.lead_id,
    c.title,
    c.description,
    c.start_time,
    c.end_time,
    c.all_day,
    c.location,
    c.meeting_url,
    c.metadata,
    l.name AS lead_name,
    l.contact_phone,
    l.instancia AS instance_name,
    CASE
      WHEN COALESCE(c.metadata->>'followup_1h_attempt_count', '') ~ '^[0-9]+$'
        THEN (c.metadata->>'followup_1h_attempt_count')::integer
      ELSE 1
    END AS attempt_count
  FROM claimed c
  JOIN crm.leads l ON l.id = c.lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION calendar.rpc_mark_followup_sent(
  p_event_id uuid,
  p_sent_at timestamptz DEFAULT now(),
  p_provider_message_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = calendar, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE calendar.events
  SET
    followup_1h_status = 'sent',
    followup_1h_sent_at = COALESCE(p_sent_at, v_now),
    followup_1h_error = NULL,
    metadata = CASE
      WHEN p_provider_message_id IS NULL THEN COALESCE(metadata, '{}'::jsonb)
      ELSE jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{followup_1h_provider_message_id}',
        to_jsonb(p_provider_message_id),
        true
      )
    END,
    updated_at = v_now
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION calendar.rpc_mark_followup_failed(
  p_event_id uuid,
  p_error text,
  p_retry boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SET search_path = calendar, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE calendar.events
  SET
    followup_1h_status = CASE WHEN p_retry THEN 'pending' ELSE 'failed' END,
    followup_1h_error = LEFT(COALESCE(NULLIF(p_error, ''), 'Falha ao enviar lembrete'), 1000),
    metadata = jsonb_set(
      jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{followup_1h_last_failure_at}',
        to_jsonb(v_now::text),
        true
      ),
      '{followup_1h_retryable}',
      to_jsonb(p_retry),
      true
    ),
    updated_at = v_now
  WHERE id = p_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION calendar.rpc_skip_followup(
  p_event_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = calendar, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE calendar.events
  SET
    followup_1h_status = 'skipped',
    followup_1h_error = LEFT(COALESCE(NULLIF(p_reason, ''), 'Lembrete ignorado'), 1000),
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{followup_1h_skipped_at}',
      to_jsonb(v_now::text),
      true
    ),
    updated_at = v_now
  WHERE id = p_event_id;
END;
$$;

REVOKE ALL ON FUNCTION calendar.rpc_claim_due_followup_events(integer) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION calendar.rpc_mark_followup_sent(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION calendar.rpc_mark_followup_failed(uuid, text, boolean) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION calendar.rpc_skip_followup(uuid, text) FROM PUBLIC, anon, authenticated, authenticator;

GRANT EXECUTE ON FUNCTION calendar.rpc_claim_due_followup_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION calendar.rpc_mark_followup_sent(uuid, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION calendar.rpc_mark_followup_failed(uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION calendar.rpc_skip_followup(uuid, text) TO service_role;

NOTIFY pgrst, 'reload schema';
