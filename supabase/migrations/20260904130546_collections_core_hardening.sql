-- Hardening additive for the canonical collections core. The v1 foundation is
-- already part of the migration history and must not be rewritten.

CREATE TABLE collections.operational_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid,
  case_id uuid,
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info',
  actor_id uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_events_source_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT operational_events_case_tenant_fkey
    FOREIGN KEY (case_id, aces_id)
    REFERENCES collections.cases(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT operational_events_severity_check
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT operational_events_details_object_check
    CHECK (jsonb_typeof(details) = 'object' AND octet_length(details::text) <= 32768)
);

CREATE INDEX operational_events_tenant_created_idx
  ON collections.operational_events(aces_id, created_at DESC);
CREATE INDEX operational_events_alert_idx
  ON collections.operational_events(severity, event_type, created_at DESC)
  WHERE severity IN ('warning', 'error', 'critical');

CREATE TABLE collections.rb_migration_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  phase text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  legacy_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  differences jsonb NOT NULL DEFAULT '{}'::jsonb,
  conflict_report jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT rb_migration_runs_source_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT rb_migration_runs_phase_check
    CHECK (phase IN ('backfill', 'shadow', 'cutover', 'legacy_cleanup')),
  CONSTRAINT rb_migration_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed', 'requires_review')),
  CONSTRAINT rb_migration_runs_json_check CHECK (
    jsonb_typeof(legacy_counts) = 'object'
    AND jsonb_typeof(canonical_counts) = 'object'
    AND jsonb_typeof(differences) = 'object'
    AND jsonb_typeof(conflict_report) = 'array'
  )
);

CREATE INDEX rb_migration_runs_tenant_idx
  ON collections.rb_migration_runs(aces_id, started_at DESC);

CREATE TABLE collections.contact_communication_controls (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  normalized_phone_hash text NOT NULL,
  status text NOT NULL,
  reason text,
  updated_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, normalized_phone_hash),
  CONSTRAINT contact_communication_controls_status_check
    CHECK (status IN ('active', 'paused', 'in_service', 'opt_out', 'disputed')),
  CONSTRAINT contact_communication_controls_hash_check
    CHECK (normalized_phone_hash ~ '^[a-f0-9]{64}$')
);

ALTER TABLE collections.spreadsheet_imports
  ADD COLUMN publish_requested_at timestamptz,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN failure_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN error_details_expires_at timestamptz;

ALTER TABLE collections.source_connections
  ADD COLUMN pull_locked_at timestamptz,
  ADD COLUMN pull_locked_by text;

ALTER TABLE collections.spreadsheet_imports
  DROP CONSTRAINT IF EXISTS spreadsheet_imports_status_check;
ALTER TABLE collections.spreadsheet_imports
  ADD CONSTRAINT spreadsheet_imports_status_check
  CHECK (status IN ('uploaded', 'previewing', 'ready', 'publishing', 'succeeded', 'failed', 'expired'));
ALTER TABLE collections.spreadsheet_imports
  ADD CONSTRAINT spreadsheet_imports_failure_object_check
  CHECK (jsonb_typeof(failure_summary) = 'object' AND octet_length(failure_summary::text) <= 32768);

CREATE OR REPLACE FUNCTION collections.jsonb_top_level_key_count(p_value jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT count(*)::integer FROM jsonb_object_keys(p_value);
$$;

ALTER TABLE collections.receivables
  ADD CONSTRAINT receivables_metadata_size_check
  CHECK (
    octet_length(source_metadata::text) <= 16384
    AND collections.jsonb_top_level_key_count(source_metadata) <= 32
  ) NOT VALID;

ALTER TABLE collections.receivables
  ADD CONSTRAINT receivables_payment_data_size_check
  CHECK (octet_length(trusted_payment_data::text) <= 4096) NOT VALID;

CREATE OR REPLACE FUNCTION collections.cancel_pending_for_case(p_case_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE crm.automation_executions
  SET status = 'cancelled', cancelled_at = now(), completed_reason = left(p_reason, 500),
      last_error = left(p_reason, 2000), claimed_by = NULL, updated_at = now()
  WHERE source_collection_case_id = p_case_id
    AND status IN ('pending', 'processing');
  GET DIAGNOSTICS v_count = ROW_COUNT;

  UPDATE crm.automation_enrollments
  SET status = 'cancelled', stopped_reason = left(p_reason, 500), updated_at = now()
  WHERE source_collection_case_id = p_case_id AND status = 'active';
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION collections.cancel_case_when_non_communicable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.open_receivables_count = 0
     OR NEW.source_freshness <> 'fresh'
     OR NEW.communication_status IN ('paused', 'in_service', 'completed', 'stale', 'error') THEN
    PERFORM collections.cancel_pending_for_case(
      NEW.id,
      CASE
        WHEN NEW.open_receivables_count = 0 THEN 'collection_no_open_receivables'
        WHEN NEW.source_freshness <> 'fresh' THEN 'collection_source_not_fresh'
        ELSE 'collection_case_' || NEW.communication_status
      END
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_case_when_non_communicable ON collections.cases;
CREATE TRIGGER trg_cancel_case_when_non_communicable
  AFTER INSERT OR UPDATE OF open_receivables_count, source_freshness, communication_status
  ON collections.cases
  FOR EACH ROW EXECUTE FUNCTION collections.cancel_case_when_non_communicable();

CREATE OR REPLACE FUNCTION collections.rebuild_case_projections(
  p_aces_id integer,
  p_source_connection_id uuid DEFAULT NULL,
  p_case_id uuid DEFAULT NULL,
  p_reason text DEFAULT 'manual_rebuild',
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer := 0;
  v_outbox integer := 0;
BEGIN
  IF p_source_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM collections.source_connections
    WHERE id = p_source_connection_id AND aces_id = p_aces_id
  ) THEN
    RAISE EXCEPTION 'COLLECTION_SOURCE_TENANT_MISMATCH';
  END IF;
  IF p_case_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM collections.cases WHERE id = p_case_id AND aces_id = p_aces_id
  ) THEN
    RAISE EXCEPTION 'COLLECTION_CASE_TENANT_MISMATCH';
  END IF;

  WITH projection AS (
    SELECT c.id,
      COALESCE(sum(r.remaining_amount) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      ), 0)::numeric(18,2) AS total_open_amount,
      count(r.id) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      )::integer AS open_receivables_count,
      min(r.due_date) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      ) AS oldest_due_date,
      max(r.due_date) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      ) AS newest_due_date,
      max(GREATEST((now() AT TIME ZONE sc.timezone)::date - r.due_date, 0)) FILTER (
        WHERE r.financial_status = 'open' AND r.record_status = 'current'
      )::integer AS most_overdue_days
    FROM collections.cases c
    JOIN collections.source_connections sc ON sc.id = c.source_connection_id
    LEFT JOIN collections.receivables r ON r.case_id = c.id
    WHERE c.aces_id = p_aces_id
      AND (p_source_connection_id IS NULL OR c.source_connection_id = p_source_connection_id)
      AND (p_case_id IS NULL OR c.id = p_case_id)
    GROUP BY c.id, sc.timezone
  ), changed AS (
    UPDATE collections.cases c
    SET total_open_amount = p.total_open_amount,
        open_receivables_count = p.open_receivables_count,
        oldest_due_date = p.oldest_due_date,
        newest_due_date = p.newest_due_date,
        most_overdue_days = p.most_overdue_days,
        communication_status = CASE
          WHEN c.communication_status IN ('paused', 'in_service', 'error') THEN c.communication_status
          WHEN c.source_freshness <> 'fresh' THEN 'stale'
          WHEN p.open_receivables_count = 0 THEN 'completed'
          ELSE 'eligible'
        END,
        updated_at = now()
    FROM projection p
    WHERE c.id = p.id
    RETURNING c.id, c.aces_id
  )
  SELECT count(*) INTO v_count FROM changed;

  INSERT INTO collections.outbox (
    aces_id, topic, aggregate_type, aggregate_id, idempotency_key, payload
  )
  SELECT c.aces_id, 'case.reevaluate', 'collection_case', c.id,
    'rebuild:' || txid_current()::text || ':case:' || c.id::text,
    jsonb_build_object('caseId', c.id, 'reason', left(p_reason, 500))
  FROM collections.cases c
  WHERE c.aces_id = p_aces_id
    AND (p_source_connection_id IS NULL OR c.source_connection_id = p_source_connection_id)
    AND (p_case_id IS NULL OR c.id = p_case_id)
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS v_outbox = ROW_COUNT;

  INSERT INTO collections.operational_events (
    aces_id, source_connection_id, case_id, event_type, actor_id, details
  ) VALUES (
    p_aces_id, p_source_connection_id, p_case_id, 'case_projection_rebuilt', p_actor_id,
    jsonb_build_object('reason', left(p_reason, 500), 'cases', v_count, 'outboxItems', v_outbox)
  );
  RETURN jsonb_build_object('rebuiltCases', v_count, 'outboxItems', v_outbox);
END;
$$;

CREATE OR REPLACE FUNCTION collections.set_contact_communication_status(
  p_aces_id integer,
  p_phone text,
  p_status text,
  p_reason text,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_digits text := regexp_replace(COALESCE(p_phone, ''), '[^0-9]', '', 'g');
  v_hash text;
  v_cases integer := 0;
  v_cancelled integer := 0;
  v_case record;
BEGIN
  IF length(v_digits) < 10 THEN RAISE EXCEPTION 'COLLECTION_INVALID_PHONE'; END IF;
  IF p_status NOT IN ('active', 'paused', 'in_service', 'opt_out', 'disputed') THEN
    RAISE EXCEPTION 'COLLECTION_INVALID_CONTACT_STATUS';
  END IF;
  v_hash := encode(extensions.digest(v_digits, 'sha256'), 'hex');

  INSERT INTO collections.contact_communication_controls (
    aces_id, normalized_phone_hash, status, reason, updated_by
  ) VALUES (p_aces_id, v_hash, p_status, left(p_reason, 500), p_actor_id)
  ON CONFLICT (aces_id, normalized_phone_hash) DO UPDATE
  SET status = EXCLUDED.status, reason = EXCLUDED.reason,
      updated_by = EXCLUDED.updated_by, updated_at = now();

  FOR v_case IN
    UPDATE collections.cases c
    SET communication_status = CASE
          WHEN p_status = 'active' AND c.source_freshness = 'fresh' AND c.open_receivables_count > 0 THEN 'eligible'
          WHEN p_status = 'active' AND c.source_freshness <> 'fresh' THEN 'stale'
          WHEN p_status = 'active' THEN 'completed'
          WHEN p_status = 'in_service' THEN 'in_service'
          ELSE 'paused'
        END,
        pause_reason = CASE WHEN p_status = 'active' THEN NULL ELSE left(p_reason, 500) END,
        updated_at = now()
    WHERE c.aces_id = p_aces_id
      AND regexp_replace(c.customer_phone, '[^0-9]', '', 'g') = v_digits
    RETURNING c.id
  LOOP
    v_cases := v_cases + 1;
    IF p_status <> 'active' THEN
      v_cancelled := v_cancelled + collections.cancel_pending_for_case(v_case.id, p_reason);
    END IF;
  END LOOP;

  INSERT INTO collections.operational_events (aces_id, event_type, actor_id, details)
  VALUES (p_aces_id, 'contact_communication_status_changed', p_actor_id,
    jsonb_build_object('phoneHash', v_hash, 'status', p_status,
      'affectedCases', v_cases, 'cancelledExecutions', v_cancelled,
      'reason', left(p_reason, 500)));
  RETURN jsonb_build_object('affectedCases', v_cases, 'cancelledExecutions', v_cancelled);
END;
$$;

CREATE OR REPLACE FUNCTION collections.get_case_route_status(p_case_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH target AS (
    SELECT * FROM collections.cases WHERE id = p_case_id
  ), candidates AS (
    SELECT b.id, b.agent_tool_id, b.priority,
      row_number() OVER (ORDER BY b.priority DESC, b.id) AS position,
      lead(b.priority) OVER (ORDER BY b.priority DESC, b.id) AS next_priority
    FROM target c
    JOIN collections.agent_source_bindings b
      ON b.aces_id = c.aces_id AND b.source_connection_id = c.source_connection_id
     AND b.is_enabled IS TRUE
     AND (b.creditor_external_id = c.creditor_external_id OR b.creditor_external_id IS NULL)
    WHERE NOT EXISTS (
      SELECT 1 FROM collections.agent_source_bindings exact_binding
      WHERE exact_binding.aces_id = c.aces_id
        AND exact_binding.source_connection_id = c.source_connection_id
        AND exact_binding.creditor_external_id = c.creditor_external_id
        AND exact_binding.is_enabled IS TRUE
        AND b.creditor_external_id IS NULL
    )
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM candidates) THEN jsonb_build_object('status', 'missing')
    WHEN EXISTS (SELECT 1 FROM candidates WHERE position = 1 AND priority = next_priority)
      THEN jsonb_build_object('status', 'conflict')
    ELSE jsonb_build_object('status', 'resolved', 'bindingId',
      (SELECT id FROM candidates WHERE position = 1), 'agentToolId',
      (SELECT agent_tool_id FROM candidates WHERE position = 1))
  END;
$$;

CREATE OR REPLACE FUNCTION collections.record_ingestion_failure(
  p_source_connection_id uuid,
  p_external_idempotency_key text,
  p_payload_hash text,
  p_mode text,
  p_scope jsonb,
  p_received_count integer,
  p_error_code text,
  p_error_message text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer;
  v_id uuid;
BEGIN
  SELECT aces_id INTO v_aces_id FROM collections.source_connections
  WHERE id = p_source_connection_id;
  IF v_aces_id IS NULL THEN RAISE EXCEPTION 'COLLECTION_SOURCE_NOT_FOUND'; END IF;

  INSERT INTO collections.ingestion_runs (
    aces_id, source_connection_id, external_idempotency_key, payload_hash,
    mode, scope, status, received_count, rejected_count, error_summary,
    started_at, completed_at
  ) VALUES (
    v_aces_id, p_source_connection_id,
    NULLIF(trim(COALESCE(p_external_idempotency_key, '')), ''), p_payload_hash,
    p_mode, COALESCE(p_scope, '{}'::jsonb), 'failed', GREATEST(p_received_count, 0),
    GREATEST(p_received_count, 0),
    jsonb_build_object('code', left(p_error_code, 120), 'message', left(p_error_message, 2000)),
    now(), now()
  )
  ON CONFLICT (source_connection_id, external_idempotency_key)
    WHERE external_idempotency_key IS NOT NULL
  DO UPDATE SET
    status = CASE
      WHEN collections.ingestion_runs.payload_hash = EXCLUDED.payload_hash
        THEN collections.ingestion_runs.status ELSE collections.ingestion_runs.status END,
    error_summary = CASE
      WHEN collections.ingestion_runs.payload_hash = EXCLUDED.payload_hash
        THEN EXCLUDED.error_summary ELSE collections.ingestion_runs.error_summary END,
    completed_at = CASE
      WHEN collections.ingestion_runs.payload_hash = EXCLUDED.payload_hash
        THEN now() ELSE collections.ingestion_runs.completed_at END
  RETURNING id INTO v_id;

  UPDATE collections.source_connections
  SET last_error_at = now(), last_error_code = left(p_error_code, 120), updated_at = now()
  WHERE id = p_source_connection_id;

  INSERT INTO collections.operational_events (
    aces_id, source_connection_id, event_type, severity, details
  ) VALUES (
    v_aces_id, p_source_connection_id, 'ingestion_failed', 'error',
    jsonb_build_object('ingestionId', v_id, 'code', left(p_error_code, 120))
  );
  RETURN v_id;
END;
$$;

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
DECLARE
  v_previous text;
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
      updated_at = now()
  RETURNING active_dispatcher INTO v_previous;

  INSERT INTO collections.operational_events (aces_id, event_type, severity, actor_id, details)
  VALUES (p_aces_id, 'dispatcher_changed',
    CASE WHEN p_dispatcher = 'paused' THEN 'warning' ELSE 'info' END,
    p_actor_id, jsonb_build_object('dispatcher', p_dispatcher, 'reason', left(p_reason, 500)));
  RETURN jsonb_build_object('activeDispatcher', p_dispatcher);
END;
$$;

CREATE OR REPLACE FUNCTION collections.get_operational_health(p_aces_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sources', jsonb_build_object(
      'active', count(*) FILTER (WHERE status = 'active'),
      'stale', count(*) FILTER (WHERE status = 'active'
        AND COALESCE(last_success_at, created_at) < now() - make_interval(mins => stale_after_minutes)),
      'error', count(*) FILTER (WHERE status = 'error')
    ),
    'cases', jsonb_build_object(
      'eligible', (SELECT count(*) FROM collections.cases WHERE aces_id = p_aces_id AND communication_status = 'eligible'),
      'paused', (SELECT count(*) FROM collections.cases WHERE aces_id = p_aces_id AND communication_status IN ('paused', 'in_service')),
      'error', (SELECT count(*) FROM collections.cases WHERE aces_id = p_aces_id AND communication_status = 'error')
    ),
    'outbox', jsonb_build_object(
      'pending', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'pending'),
      'processing', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'processing'),
      'failed', (SELECT count(*) FROM collections.outbox WHERE aces_id = p_aces_id AND status = 'failed')
    ),
    'dispatcher', COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = p_aces_id), 'legacy_rb')
  )
  FROM collections.source_connections
  WHERE aces_id = p_aces_id;
$$;

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
    WHERE sc.status = 'active' AND sc.delivery_mode = 'pull'
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

CREATE OR REPLACE FUNCTION collections.complete_source_pull(
  p_source_connection_id uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.source_connections
  SET pull_locked_at = NULL, pull_locked_by = NULL, updated_at = now()
  WHERE id = p_source_connection_id AND pull_locked_by = left(p_worker_id, 200)
  RETURNING TRUE;
$$;

CREATE OR REPLACE FUNCTION collections.fail_source_pull(
  p_source_connection_id uuid,
  p_worker_id text,
  p_error_code text
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  UPDATE collections.source_connections
  SET pull_locked_at = NULL, pull_locked_by = NULL, last_error_at = now(),
      last_error_code = left(p_error_code, 120), updated_at = now()
  WHERE id = p_source_connection_id AND pull_locked_by = left(p_worker_id, 200)
  RETURNING TRUE;
$$;

ALTER TABLE collections.operational_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections.contact_communication_controls ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections.rb_migration_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON collections.operational_events, collections.contact_communication_controls,
  collections.rb_migration_runs
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  collections.operational_events, collections.contact_communication_controls,
  collections.rb_migration_runs TO service_role;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA collections FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.cancel_pending_for_case(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION collections.rebuild_case_projections(integer, uuid, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.set_contact_communication_status(integer, text, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_case_route_status(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.record_ingestion_failure(uuid, text, text, text, jsonb, integer, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION collections.set_active_dispatcher(integer, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.get_operational_health(integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.claim_due_pull_sources(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION collections.complete_source_pull(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION collections.fail_source_pull(uuid, text, text) TO service_role;
