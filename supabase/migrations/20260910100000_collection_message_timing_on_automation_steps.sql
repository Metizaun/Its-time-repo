-- Mensagens de cobranca continuam em crm.automation_steps.
-- Estes campos apenas tornam o momento por mensagem explicito para o dispatcher.
ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS collection_timing_relation text,
  ADD COLUMN IF NOT EXISTS collection_days_offset integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_steps_collection_timing_relation_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_collection_timing_relation_check
      CHECK (collection_timing_relation IS NULL OR collection_timing_relation IN ('before_due', 'on_due', 'after_due'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_steps_collection_days_offset_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_collection_days_offset_check
      CHECK (collection_days_offset IS NULL OR collection_days_offset >= 0);
  END IF;
END;
$$;

UPDATE crm.automation_steps s
SET collection_timing_relation = jr.timing_relation,
    collection_days_offset = jr.days_offset
FROM collections.journey_rules jr
JOIN crm.automation_funnels f ON f.id = jr.funnel_id AND f.entry_source = 'collection'
WHERE s.funnel_id = jr.funnel_id
  AND s.collection_timing_relation IS NULL;

CREATE INDEX IF NOT EXISTS automation_steps_collection_dispatch_idx
  ON crm.automation_steps(funnel_id, is_active, collection_timing_relation, collection_days_offset);

DROP FUNCTION IF EXISTS collections.list_eligible_decisions(integer);

CREATE FUNCTION collections.list_eligible_decisions(p_limit integer DEFAULT 500)
RETURNS TABLE (
  case_id uuid, aces_id integer, source_connection_id uuid,
  journey_rule_id uuid, funnel_id uuid, message_id uuid, customer_phone text,
  priority integer, most_overdue_days integer, total_open_amount numeric,
  local_date date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT DISTINCT ON (c.id, jr.id, s.id)
    c.id, c.aces_id, c.source_connection_id, jr.id, jr.funnel_id, s.id,
    c.customer_phone, jr.priority, COALESCE(c.most_overdue_days, 0),
    c.total_open_amount,
    (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date
  FROM collections.cases c
  JOIN collections.source_connections sc
    ON sc.id = c.source_connection_id AND sc.status = 'active'
  JOIN collections.onboarding_bindings ob
    ON ob.aces_id = c.aces_id
   AND ob.source_connection_id = c.source_connection_id
   AND ob.sending_enabled IS TRUE
  JOIN collections.receivables r ON r.case_id = c.id
    AND r.record_status = 'current' AND r.financial_status = 'open'
  JOIN collections.journey_rules jr ON jr.aces_id = c.aces_id AND jr.is_active IS TRUE
    AND (jr.currency IS NULL OR jr.currency = r.currency)
    AND (jsonb_array_length(jr.payment_methods) = 0 OR jr.payment_methods ? COALESCE(r.payment_method, ''))
    AND jr.financial_statuses ? r.financial_status
  JOIN crm.automation_funnels f ON f.id = jr.funnel_id
    AND f.entry_source = 'collection' AND f.is_active IS TRUE
  JOIN crm.automation_steps s ON s.funnel_id = f.id AND s.is_active IS TRUE
  JOIN collections.runtime_controls rc ON rc.aces_id = c.aces_id AND rc.active_dispatcher = 'canonical'
  WHERE c.communication_status IN ('eligible', 'scheduled')
    AND c.source_freshness = 'fresh'
    AND c.lead_id IS NOT NULL
    AND (
      NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb WHERE jsb.journey_rule_id = jr.id)
      OR EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb
        WHERE jsb.journey_rule_id = jr.id AND jsb.source_connection_id = c.source_connection_id)
    )
    AND (
      (COALESCE(s.collection_timing_relation, jr.timing_relation) = 'before_due'
        AND r.due_date - (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date
          = COALESCE(s.collection_days_offset, jr.days_offset))
      OR (COALESCE(s.collection_timing_relation, jr.timing_relation) = 'on_due'
        AND r.due_date = (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date
        AND COALESCE(s.collection_days_offset, 0) = 0)
      OR (COALESCE(s.collection_timing_relation, jr.timing_relation) = 'after_due'
        AND (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date - r.due_date
          = COALESCE(s.collection_days_offset, jr.days_offset))
    )
  ORDER BY c.id, jr.id, s.id, r.due_date, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
$$;

CREATE OR REPLACE FUNCTION crm.schedule_collection_step_execution(
  p_enrollment_id uuid,
  p_step_id uuid,
  p_scheduled_at timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_step crm.automation_steps%ROWTYPE;
  v_count integer := 0;
BEGIN
  SELECT * INTO v_enrollment FROM crm.automation_enrollments WHERE id = p_enrollment_id LIMIT 1;
  IF NOT FOUND OR v_enrollment.status <> 'active' THEN RETURN 0; END IF;

  SELECT * INTO v_funnel FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id AND aces_id = v_enrollment.aces_id AND is_active IS TRUE LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT * INTO v_step FROM crm.automation_steps
  WHERE id = p_step_id AND funnel_id = v_enrollment.funnel_id AND is_active IS TRUE LIMIT 1;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT * INTO v_lead FROM crm.leads
  WHERE id = v_enrollment.lead_id AND aces_id = v_enrollment.aces_id LIMIT 1;
  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) IS FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1 FROM crm.automation_executions ae
    WHERE ae.enrollment_id = v_enrollment.id
      AND ae.step_id = v_step.id
      AND ae.status IN ('pending', 'processing', 'sent')
  ) THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id, funnel_id, step_id, enrollment_id, lead_id,
    source_stage_id, source_calendar_event_id, scheduled_at,
    phone_snapshot, instance_snapshot, lead_name_snapshot, city_snapshot,
    status_snapshot, funnel_name_snapshot, step_label_snapshot,
    step_rule_snapshot, anchor_at_snapshot
  ) VALUES (
    v_enrollment.aces_id, v_enrollment.funnel_id, v_step.id, v_enrollment.id, v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.source_calendar_event_id, COALESCE(p_scheduled_at, now()),
    v_lead.contact_phone, v_funnel.instance_name, v_lead.name, v_lead.last_city,
    v_lead.status, v_funnel.name, v_step.label, v_step.step_rule, v_enrollment.anchor_at
  ) ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

DROP FUNCTION IF EXISTS collections.enroll_collection_case(uuid, uuid, text, timestamptz);

CREATE FUNCTION collections.enroll_collection_case(
  p_case_id uuid,
  p_journey_rule_id uuid,
  p_decision_key text,
  p_anchor_at timestamptz DEFAULT now(),
  p_message_id uuid DEFAULT NULL
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
  IF NOT EXISTS (
    SELECT 1 FROM collections.onboarding_bindings ob
    WHERE ob.aces_id = v_case.aces_id
      AND ob.source_connection_id = v_case.source_connection_id
      AND ob.sending_enabled IS TRUE
  ) THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'sending_not_enabled');
  END IF;
  IF v_case.lead_id IS NULL OR v_case.communication_status NOT IN ('eligible', 'scheduled')
     OR v_case.source_freshness <> 'fresh' OR v_case.open_receivables_count <= 0 THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'case_not_eligible');
  END IF;
  IF COALESCE((SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = v_case.aces_id), 'legacy_rb') <> 'canonical' THEN
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
  IF p_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s
    WHERE s.id = p_message_id AND s.funnel_id = v_funnel.id AND s.is_active IS TRUE
  ) THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'message_not_available');
  END IF;

  INSERT INTO crm.automation_enrollments (
    aces_id, funnel_id, lead_id, status, anchor_event, anchor_at,
    current_stage_id, reply_target_stage_id, last_evaluated_at,
    source_collection_case_id, source_collection_decision_key
  ) VALUES (
    v_case.aces_id, v_funnel.id, v_case.lead_id, 'active', 'collection_eligible_at',
    p_anchor_at, NULL, v_funnel.reply_target_stage_id, now(), v_case.id, p_decision_key
  ) ON CONFLICT DO NOTHING RETURNING id INTO v_enrollment_id;

  IF v_enrollment_id IS NULL THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'duplicate_decision');
  END IF;

  IF p_message_id IS NULL THEN
    v_scheduled := crm.schedule_enrollment_executions(v_enrollment_id);
  ELSE
    v_scheduled := crm.schedule_collection_step_execution(v_enrollment_id, p_message_id, p_anchor_at);
  END IF;
  IF v_scheduled > 0 THEN
    UPDATE collections.cases SET communication_status = 'scheduled', updated_at = now()
    WHERE id = v_case.id;
  END IF;
  RETURN jsonb_build_object('scheduled', v_scheduled, 'enrollmentId', v_enrollment_id, 'messageId', p_message_id);
END;
$$;

REVOKE ALL ON FUNCTION crm.schedule_collection_step_execution(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.schedule_collection_step_execution(uuid, uuid, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION collections.list_eligible_decisions(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.list_eligible_decisions(integer) TO service_role;
REVOKE ALL ON FUNCTION collections.enroll_collection_case(uuid, uuid, text, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION collections.enroll_collection_case(uuid, uuid, text, timestamptz, uuid) TO service_role;
