-- The initial local application exposed two late-bound references caught by
-- plpgsql_check. Keep this follow-up idempotent for already provisioned stacks.
ALTER FUNCTION collections.ingest_envelope(uuid, text, text, text, jsonb, jsonb)
  SET search_path = pg_catalog, extensions;

CREATE OR REPLACE FUNCTION collections.get_execution_dispatch_context(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_case collections.cases%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_context jsonb;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('collection', FALSE, 'action', 'continue');
  END IF;
  SELECT * INTO v_case FROM collections.cases WHERE id = v_execution.source_collection_case_id;
  SELECT * INTO v_source FROM collections.source_connections WHERE id = v_case.source_connection_id;
  IF v_case.id IS NULL OR v_source.id IS NULL
     OR v_source.status <> 'active' OR v_case.source_freshness <> 'fresh'
     OR v_case.communication_status IN ('paused', 'in_service', 'completed', 'stale', 'error')
     OR v_case.open_receivables_count <= 0
     OR EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = v_case.lead_id
       AND (l.view IS DISTINCT FROM TRUE OR lower(btrim(COALESCE(l.status::text, ''))) IN ('atendimento', 'em atendimento')))
     OR EXISTS (SELECT 1 FROM agents.ai_lead_state als WHERE als.lead_id = v_case.lead_id
       AND (als.manual_ai_enabled IS FALSE OR als.status = 'paused' OR als.freeze_until > now()))
     OR COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = v_case.aces_id), 'legacy_rb') <> 'canonical' THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_case_not_eligible');
  END IF;
  v_context := collections.get_collection_context(v_case.lead_id, v_case.id);
  RETURN jsonb_build_object('collection', TRUE, 'action', 'continue', 'caseId', v_case.id,
    'timezone', v_source.timezone, 'context', v_context);
END;
$$;

CREATE OR REPLACE FUNCTION collections.reserve_collection_dispatch(p_execution_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_case collections.cases%ROWTYPE;
  v_source collections.source_connections%ROWTYPE;
  v_phone_hash text;
  v_local_date date;
  v_existing collections.contact_daily_dispatches%ROWTYPE;
  v_decision_key text;
  v_defer_until timestamptz;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id FOR UPDATE;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('reserved', TRUE, 'collection', FALSE);
  END IF;
  SELECT * INTO v_case FROM collections.cases WHERE id = v_execution.source_collection_case_id;
  SELECT * INTO v_source FROM collections.source_connections WHERE id = v_case.source_connection_id;
  v_phone_hash := encode(extensions.digest(regexp_replace(v_case.customer_phone, '[^0-9]', '', 'g'), 'sha256'), 'hex');
  v_local_date := (now() AT TIME ZONE v_source.timezone)::date;
  v_decision_key := COALESCE((SELECT source_collection_decision_key FROM crm.automation_enrollments
    WHERE id = v_execution.enrollment_id), 'execution:' || p_execution_id::text);

  SELECT * INTO v_existing FROM collections.contact_daily_dispatches
  WHERE aces_id = v_case.aces_id AND normalized_phone_hash = v_phone_hash AND local_date = v_local_date;
  IF FOUND THEN
    IF v_existing.execution_id = p_execution_id THEN
      RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', TRUE);
    END IF;
    v_defer_until := ((v_local_date + 1)::date + time '09:00') AT TIME ZONE v_source.timezone;
    RETURN jsonb_build_object('reserved', FALSE, 'collection', TRUE,
      'reason', 'deferred_contact_daily_limit', 'deferUntil', v_defer_until);
  END IF;

  INSERT INTO collections.contact_daily_dispatches (
    aces_id, normalized_phone_hash, local_date, case_id, execution_id, decision_key
  ) VALUES (
    v_case.aces_id, v_phone_hash, v_local_date, v_case.id, p_execution_id, v_decision_key
  );
  RETURN jsonb_build_object('reserved', TRUE, 'collection', TRUE, 'duplicate', FALSE);
EXCEPTION WHEN unique_violation THEN
  v_defer_until := ((v_local_date + 1)::date + time '09:00') AT TIME ZONE v_source.timezone;
  RETURN jsonb_build_object('reserved', FALSE, 'collection', TRUE,
    'reason', 'deferred_contact_daily_limit', 'deferUntil', v_defer_until);
END;
$$;

REVOKE ALL ON FUNCTION collections.get_execution_dispatch_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION collections.reserve_collection_dispatch(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.get_execution_dispatch_context(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION collections.reserve_collection_dispatch(uuid) TO service_role;
