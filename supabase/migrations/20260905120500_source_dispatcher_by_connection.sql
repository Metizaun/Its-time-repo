-- The dispatcher is resolved per source. The account-level runtime remains
-- available as an explicit pause override for incidents.
CREATE OR REPLACE FUNCTION collections.resolve_source_dispatcher(p_source_connection_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN sc.status <> 'active' THEN 'paused'
    WHEN COALESCE((SELECT rc.active_dispatcher
                   FROM collections.runtime_controls rc
                   WHERE rc.aces_id = sc.aces_id), '') = 'paused' THEN 'paused'
    WHEN sc.source_type = 'rb' AND NOT EXISTS (
      SELECT 1
      FROM rb.connections connection
      WHERE connection.aces_id = sc.aces_id
        AND connection.is_active IS TRUE
        AND connection.billing_enabled IS TRUE
        AND connection.rb_token_api IS NOT NULL
    ) THEN 'paused'
    WHEN sc.source_type = 'rb'
      AND COALESCE(sc.config->>'dispatcherMode', 'legacy_rb') <> 'canonical' THEN 'legacy_rb'
    ELSE 'canonical'
  END
  FROM collections.source_connections sc
  WHERE sc.id = p_source_connection_id;
$$;

GRANT EXECUTE ON FUNCTION collections.resolve_source_dispatcher(uuid) TO service_role;

CREATE OR REPLACE FUNCTION collections.enroll_collection_case(
  p_case_id uuid,
  p_journey_rule_id uuid,
  p_decision_key text,
  p_anchor_at timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_case collections.cases%ROWTYPE;
  v_rule collections.journey_rules%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_enrollment_id uuid;
  v_scheduled integer := 0;
BEGIN
  SELECT * INTO v_case FROM collections.cases WHERE id = p_case_id FOR UPDATE;
  SELECT * INTO v_rule FROM collections.journey_rules WHERE id = p_journey_rule_id AND is_active IS TRUE;
  IF v_case.id IS NULL OR v_rule.id IS NULL OR v_case.aces_id <> v_rule.aces_id THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'case_or_rule_not_found');
  END IF;
  IF v_case.lead_id IS NULL OR v_case.communication_status <> 'eligible'
     OR v_case.source_freshness <> 'fresh' OR v_case.open_receivables_count <= 0 THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'case_not_eligible');
  END IF;
  IF COALESCE(collections.resolve_source_dispatcher(v_case.source_connection_id), 'paused') <> 'canonical' THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'canonical_dispatcher_inactive');
  END IF;
  IF EXISTS (SELECT 1 FROM collections.journey_source_bindings WHERE journey_rule_id = v_rule.id)
     AND NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings
       WHERE journey_rule_id = v_rule.id AND source_connection_id = v_case.source_connection_id) THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'source_not_bound');
  END IF;

  SELECT * INTO v_funnel FROM crm.automation_funnels
  WHERE id = v_rule.funnel_id AND aces_id = v_case.aces_id
    AND entry_source = 'collection' AND is_active IS TRUE;
  IF v_funnel.id IS NULL THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'funnel_not_available');
  END IF;

  INSERT INTO crm.automation_enrollments (
    aces_id, funnel_id, lead_id, status, anchor_event, anchor_at,
    current_stage_id, reply_target_stage_id, last_evaluated_at,
    source_collection_case_id, source_collection_decision_key
  ) VALUES (
    v_case.aces_id, v_funnel.id, v_case.lead_id, 'active', 'collection_eligible_at',
    p_anchor_at, NULL, v_funnel.reply_target_stage_id, now(), v_case.id, p_decision_key
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_enrollment_id;

  IF v_enrollment_id IS NULL THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'duplicate_decision');
  END IF;
  v_scheduled := crm.schedule_enrollment_executions(v_enrollment_id);
  IF v_scheduled > 0 THEN
    UPDATE collections.cases SET communication_status = 'scheduled', updated_at = now()
    WHERE id = v_case.id;
  END IF;
  RETURN jsonb_build_object('scheduled', v_scheduled, 'enrollmentId', v_enrollment_id);
END;
$$;

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
  v_route jsonb;
  v_tool_id uuid;
  v_context jsonb;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions WHERE id = p_execution_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Execucao nao encontrada'; END IF;
  IF v_execution.source_collection_case_id IS NULL THEN
    RETURN jsonb_build_object('collection', FALSE, 'action', 'continue');
  END IF;
  SELECT * INTO v_case FROM collections.cases
  WHERE id = v_execution.source_collection_case_id AND aces_id = v_execution.aces_id;
  SELECT * INTO v_source FROM collections.source_connections
  WHERE id = v_case.source_connection_id AND aces_id = v_case.aces_id;
  IF v_case.id IS NULL OR v_source.id IS NULL
     OR v_source.status <> 'active' OR v_case.source_freshness <> 'fresh'
     OR v_case.communication_status IN ('paused', 'in_service', 'completed', 'stale', 'error')
     OR v_case.open_receivables_count <= 0
     OR EXISTS (SELECT 1 FROM crm.leads l WHERE l.id = v_case.lead_id AND l.aces_id = v_case.aces_id
       AND (l.view IS DISTINCT FROM TRUE OR lower(btrim(COALESCE(l.status::text, ''))) IN ('atendimento', 'em atendimento')))
     OR EXISTS (SELECT 1 FROM agents.ai_lead_state als WHERE als.lead_id = v_case.lead_id
       AND (als.manual_ai_enabled IS FALSE OR als.status = 'paused' OR als.freeze_until > now()))
     OR EXISTS (SELECT 1 FROM collections.contact_communication_controls cc
       WHERE cc.aces_id = v_case.aces_id
         AND cc.normalized_phone_hash = encode(extensions.digest(regexp_replace(v_case.customer_phone, '[^0-9]', '', 'g'), 'sha256'), 'hex')
         AND cc.status <> 'active')
     OR COALESCE(collections.resolve_source_dispatcher(v_case.source_connection_id), 'paused') <> 'canonical' THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_case_not_eligible');
  END IF;

  v_route := collections.get_case_route_status(v_case.id);
  IF v_route->>'status' <> 'resolved' THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_route_not_resolved');
  END IF;
  v_tool_id := (v_route->>'agentToolId')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM agents.agent_tools t
    JOIN agents.ai_agents a ON a.id = t.agent_id AND a.aces_id = t.aces_id
    WHERE t.id = v_tool_id AND t.aces_id = v_case.aces_id
      AND t.tool_key = 'collection_orchestration' AND t.is_enabled AND t.readiness = 'ready'
      AND a.is_active AND a.instance_name = v_execution.instance_snapshot
  ) THEN
    RETURN jsonb_build_object('collection', TRUE, 'action', 'cancel', 'reason', 'collection_route_not_authorized');
  END IF;
  v_context := collections.get_collection_context_authorized(
    v_case.aces_id, v_tool_id, v_case.lead_id, v_case.id
  );
  RETURN jsonb_build_object('collection', TRUE, 'action', 'continue', 'caseId', v_case.id,
    'timezone', v_source.timezone, 'context', v_context);
END;
$$;

CREATE OR REPLACE FUNCTION collections.list_eligible_decisions(p_limit integer DEFAULT 500)
RETURNS TABLE (
  case_id uuid, aces_id integer, source_connection_id uuid,
  journey_rule_id uuid, funnel_id uuid, customer_phone text,
  priority integer, most_overdue_days integer, total_open_amount numeric,
  local_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.id, jr.id)
    c.id, c.aces_id, c.source_connection_id, jr.id, jr.funnel_id,
    c.customer_phone, jr.priority, COALESCE(c.most_overdue_days, 0),
    c.total_open_amount,
    (now() AT TIME ZONE sc.timezone)::date
  FROM collections.cases c
  JOIN collections.source_connections sc ON sc.id = c.source_connection_id AND sc.status = 'active'
  JOIN collections.receivables r ON r.case_id = c.id
    AND r.record_status = 'current' AND r.financial_status = 'open'
  JOIN collections.journey_rules jr ON jr.aces_id = c.aces_id AND jr.is_active IS TRUE
    AND (jr.currency IS NULL OR jr.currency = r.currency)
    AND (jsonb_array_length(jr.payment_methods) = 0 OR jr.payment_methods ? COALESCE(r.payment_method, ''))
    AND jr.financial_statuses ? r.financial_status
    AND (
      (jr.timing_relation = 'before_due' AND r.due_date - (now() AT TIME ZONE sc.timezone)::date = jr.days_offset)
      OR (jr.timing_relation = 'on_due' AND r.due_date = (now() AT TIME ZONE sc.timezone)::date)
      OR (jr.timing_relation = 'after_due' AND (now() AT TIME ZONE sc.timezone)::date - r.due_date = jr.days_offset)
    )
  JOIN crm.automation_funnels f ON f.id = jr.funnel_id
    AND f.entry_source = 'collection' AND f.is_active IS TRUE
  WHERE collections.resolve_source_dispatcher(c.source_connection_id) = 'canonical'
    AND c.communication_status = 'eligible' AND c.source_freshness = 'fresh'
    AND c.lead_id IS NOT NULL
    AND (
      NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb WHERE jsb.journey_rule_id = jr.id)
      OR EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb
        WHERE jsb.journey_rule_id = jr.id AND jsb.source_connection_id = c.source_connection_id)
    )
  ORDER BY c.id, jr.id, r.due_date, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
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
        sc.source_type <> 'rb'
        OR sc.config->>'dispatcherMode' = 'canonical'
      )
      AND (
        sc.source_type <> 'rb'
        OR EXISTS (
          SELECT 1 FROM rb.connections connection
          WHERE connection.aces_id = sc.aces_id
            AND connection.is_active IS TRUE
            AND connection.billing_enabled IS TRUE
            AND connection.rb_token_api IS NOT NULL
        )
      )
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

REVOKE ALL ON FUNCTION collections.resolve_source_dispatcher(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.resolve_source_dispatcher(uuid) TO service_role;
