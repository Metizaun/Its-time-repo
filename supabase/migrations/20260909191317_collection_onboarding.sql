-- The onboarding record is the operational source of truth for collection
-- setup.  It deliberately keeps receiving data independent from dispatching.
INSERT INTO agents.tool_definitions (tool_key, version, display_name, description, icon, config_schema, is_active)
VALUES (
  'collection_orchestration', 1, 'Cobrança',
  'Organiza casos financeiros, régua e respostas de cobrança.',
  'wallet-cards', '{}'::jsonb, true
)
ON CONFLICT (tool_key, version) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  is_active = true,
  updated_at = now();

CREATE TABLE IF NOT EXISTS collections.onboarding_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  source_connection_id uuid NOT NULL,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE RESTRICT,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE RESTRICT,
  agent_tool_id uuid NOT NULL,
  pipeline_id uuid NOT NULL REFERENCES crm.pipelines(id) ON DELETE RESTRICT,
  funnel_id uuid NOT NULL,
  journey_rule_id uuid NOT NULL,
  first_step_id uuid NOT NULL REFERENCES crm.automation_steps(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft',
  sending_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_onboarding_tenant_unique UNIQUE (aces_id, source_connection_id),
  CONSTRAINT collection_onboarding_source_tenant_fkey
    FOREIGN KEY (source_connection_id, aces_id)
    REFERENCES collections.source_connections(id, aces_id) ON DELETE CASCADE,
  CONSTRAINT collection_onboarding_tool_tenant_fkey
    FOREIGN KEY (agent_tool_id, aces_id)
    REFERENCES agents.agent_tools(id, aces_id) ON DELETE RESTRICT,
  CONSTRAINT collection_onboarding_funnel_tenant_fkey
    FOREIGN KEY (funnel_id, aces_id)
    REFERENCES crm.automation_funnels(id, aces_id) ON DELETE RESTRICT,
  CONSTRAINT collection_onboarding_rule_tenant_fkey
    FOREIGN KEY (journey_rule_id, aces_id)
    REFERENCES collections.journey_rules(id, aces_id) ON DELETE RESTRICT,
  CONSTRAINT collection_onboarding_status_check
    CHECK (status IN ('draft', 'ready', 'active', 'paused', 'attention'))
);

CREATE INDEX IF NOT EXISTS collection_onboarding_pipeline_idx
  ON collections.onboarding_bindings(aces_id, pipeline_id);
CREATE INDEX IF NOT EXISTS collection_onboarding_dispatch_idx
  ON collections.onboarding_bindings(source_connection_id, sending_enabled);

DROP TRIGGER IF EXISTS trg_collection_onboarding_updated_at ON collections.onboarding_bindings;
CREATE TRIGGER trg_collection_onboarding_updated_at
  BEFORE UPDATE ON collections.onboarding_bindings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON collections.onboarding_bindings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON collections.onboarding_bindings TO service_role;

-- A source may ingest while its onboarding is incomplete.  Only this explicit
-- per-source switch authorizes the canonical worker to create dispatches.
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
    (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date
  FROM collections.cases c
  JOIN collections.source_connections sc ON sc.id = c.source_connection_id AND sc.status = 'active'
  JOIN collections.onboarding_bindings ob ON ob.aces_id = c.aces_id
    AND ob.source_connection_id = c.source_connection_id AND ob.sending_enabled IS TRUE
  JOIN collections.receivables r ON r.case_id = c.id
    AND r.record_status = 'current' AND r.financial_status = 'open'
  JOIN collections.journey_rules jr ON jr.aces_id = c.aces_id AND jr.is_active IS TRUE
    AND (jr.currency IS NULL OR jr.currency = r.currency)
    AND (jsonb_array_length(jr.payment_methods) = 0 OR jr.payment_methods ? COALESCE(r.payment_method, ''))
    AND jr.financial_statuses ? r.financial_status
    AND (
      (jr.timing_relation = 'before_due' AND r.due_date -
        (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date = jr.days_offset)
      OR (jr.timing_relation = 'on_due' AND r.due_date =
        (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date)
      OR (jr.timing_relation = 'after_due' AND
        (now() AT TIME ZONE collections.account_business_timezone(c.aces_id))::date - r.due_date = jr.days_offset)
    )
  JOIN crm.automation_funnels f ON f.id = jr.funnel_id
    AND f.entry_source = 'collection' AND f.is_active IS TRUE
  JOIN collections.runtime_controls rc ON rc.aces_id = c.aces_id AND rc.active_dispatcher = 'canonical'
  WHERE c.communication_status = 'eligible' AND c.source_freshness = 'fresh'
    AND c.lead_id IS NOT NULL
    AND (
      NOT EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb WHERE jsb.journey_rule_id = jr.id)
      OR EXISTS (SELECT 1 FROM collections.journey_source_bindings jsb
        WHERE jsb.journey_rule_id = jr.id AND jsb.source_connection_id = c.source_connection_id)
    )
  ORDER BY c.id, jr.id, r.due_date, r.id
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 500), 1), 5000);
$$;

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
  IF NOT EXISTS (
    SELECT 1 FROM collections.onboarding_bindings
    WHERE aces_id = v_case.aces_id AND source_connection_id = v_case.source_connection_id
      AND sending_enabled IS TRUE
  ) THEN
    RETURN jsonb_build_object('scheduled', 0, 'reason', 'sending_not_enabled');
  END IF;
  IF v_case.lead_id IS NULL OR v_case.communication_status <> 'eligible'
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
