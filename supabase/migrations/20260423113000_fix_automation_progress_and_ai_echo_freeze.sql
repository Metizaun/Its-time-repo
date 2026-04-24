CREATE TABLE IF NOT EXISTS crm.automation_step_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES crm.automation_funnels(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES crm.automation_steps(id) ON DELETE CASCADE,
  sent_execution_id uuid REFERENCES crm.automation_executions(id) ON DELETE SET NULL,
  first_sent_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_step_progress_unique UNIQUE (funnel_id, lead_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_automation_step_progress_funnel_lead
  ON crm.automation_step_progress(funnel_id, lead_id, first_sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_step_progress_lead
  ON crm.automation_step_progress(lead_id, first_sent_at DESC);

ALTER TABLE crm.automation_step_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_step_progress_select ON crm.automation_step_progress;
CREATE POLICY automation_step_progress_select
ON crm.automation_step_progress
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT ON crm.automation_step_progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_step_progress TO service_role;

INSERT INTO crm.automation_step_progress (
  aces_id,
  funnel_id,
  lead_id,
  step_id,
  sent_execution_id,
  first_sent_at
)
SELECT DISTINCT ON (ae.funnel_id, ae.lead_id, ae.step_id)
  ae.aces_id,
  ae.funnel_id,
  ae.lead_id,
  ae.step_id,
  ae.id,
  COALESCE(ae.sent_at, ae.updated_at, ae.created_at)
FROM crm.automation_executions ae
WHERE ae.funnel_id IS NOT NULL
  AND ae.step_id IS NOT NULL
  AND ae.status = 'sent'
ON CONFLICT (funnel_id, lead_id, step_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS crm.outbound_echo_registry (
  id bigserial PRIMARY KEY,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES crm.leads(id) ON DELETE CASCADE,
  origin text NOT NULL CHECK (origin IN ('manual', 'ai', 'automation')),
  reference_id text,
  conversation_id text,
  instance_name text NOT NULL,
  phone text NOT NULL,
  content text NOT NULL,
  fingerprint text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outbound_echo_registry_fingerprint
  ON crm.outbound_echo_registry(fingerprint, expires_at DESC, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_outbound_echo_registry_lead
  ON crm.outbound_echo_registry(lead_id, sent_at DESC);

ALTER TABLE crm.outbound_echo_registry ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.outbound_echo_registry TO service_role;
GRANT USAGE, SELECT ON SEQUENCE crm.outbound_echo_registry_id_seq TO service_role;

ALTER TABLE crm.ai_lead_state
  ADD COLUMN IF NOT EXISTS pause_origin text,
  ADD COLUMN IF NOT EXISTS pause_reference text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz;

ALTER TABLE crm.ai_lead_state
  DROP CONSTRAINT IF EXISTS ai_lead_state_pause_origin_check;

ALTER TABLE crm.ai_lead_state
  ADD CONSTRAINT ai_lead_state_pause_origin_check
  CHECK (
    pause_origin IS NULL
    OR pause_origin IN ('manual_send', 'human_webhook', 'ai_policy', 'manual_override', 'automation_repair')
  );

ALTER TABLE crm.ai_runs
  DROP CONSTRAINT IF EXISTS ai_runs_action_taken_check;

ALTER TABLE crm.ai_runs
  ADD CONSTRAINT ai_runs_action_taken_check
  CHECK (action_taken IN ('none', 'reply_only', 'stage_applied', 'manual_pause', 'failed', 'freeze_repair'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_execution_pending_funnel_lead_step
  ON crm.automation_executions(funnel_id, lead_id, step_id)
  WHERE status IN ('pending', 'processing')
    AND funnel_id IS NOT NULL
    AND lead_id IS NOT NULL
    AND step_id IS NOT NULL;

CREATE OR REPLACE FUNCTION crm.find_next_enrollment_step(p_enrollment_id uuid)
RETURNS TABLE (
  step_id uuid,
  is_active boolean,
  step_position integer,
  delay_minutes integer,
  message_template text,
  step_rule jsonb,
  label text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    s.id,
    s.is_active,
    s.position AS step_position,
    s.delay_minutes,
    s.message_template,
    s.step_rule,
    s.label,
    s.created_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND NOT EXISTS (
      SELECT 1
      FROM crm.automation_step_progress asp
      WHERE asp.funnel_id = v_enrollment.funnel_id
        AND asp.lead_id = v_enrollment.lead_id
        AND asp.step_id = s.id
    )
  ORDER BY s.position ASC, s.created_at ASC
  LIMIT 1;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.schedule_enrollment_executions(p_enrollment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer := 0;
  v_next record;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND OR v_enrollment.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = v_enrollment.lead_id
    AND aces_id = v_enrollment.aces_id
  LIMIT 1;

  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) = FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.automation_executions ae
    WHERE ae.enrollment_id = v_enrollment.id
      AND ae.status IN ('pending', 'processing')
  ) THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_next
  FROM crm.find_next_enrollment_step(v_enrollment.id)
  LIMIT 1;

  IF NOT FOUND OR v_next.step_id IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_next.is_active, TRUE) = FALSE THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id,
    funnel_id,
    step_id,
    enrollment_id,
    lead_id,
    source_stage_id,
    scheduled_at,
    phone_snapshot,
    instance_snapshot,
    lead_name_snapshot,
    city_snapshot,
    status_snapshot,
    funnel_name_snapshot,
    step_label_snapshot,
    step_rule_snapshot,
    anchor_at_snapshot
  )
  VALUES (
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    v_next.step_id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.anchor_at + make_interval(mins => v_next.delay_minutes),
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    v_next.label,
    v_next.step_rule,
    v_enrollment.anchor_at
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_get_automation_message_flow(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_result jsonb;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode consultar o fluxo da automacao';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  WITH active_enrollments AS (
    SELECT e.id, e.lead_id
    FROM crm.automation_enrollments e
    WHERE e.funnel_id = v_funnel.id
      AND e.status = 'active'
  ),
  next_steps AS (
    SELECT
      e.lead_id,
      ns.step_id::text AS step_id
    FROM active_enrollments e
    LEFT JOIN LATERAL crm.find_next_enrollment_step(e.id) ns
      ON TRUE
  ),
  counts AS (
    SELECT
      step_id,
      count(*)::integer AS lead_count
    FROM next_steps
    WHERE step_id IS NOT NULL
    GROUP BY step_id
  ),
  max_count AS (
    SELECT max(lead_count) AS value
    FROM counts
  )
  SELECT jsonb_build_object(
    'step_counts',
    COALESCE(
      (
        SELECT jsonb_object_agg(step_id, lead_count)
        FROM counts
      ),
      '{}'::jsonb
    ),
    'parked_count',
    COALESCE(
      (
        SELECT count(*)::integer
        FROM next_steps
        WHERE step_id IS NULL
      ),
      0
    ),
    'highlighted_step_ids',
    COALESCE(
      (
        SELECT jsonb_agg(c.step_id ORDER BY c.step_id)
        FROM counts c
        CROSS JOIN max_count m
        WHERE m.value IS NOT NULL
          AND m.value > 0
          AND c.lead_count = m.value
      ),
      '[]'::jsonb
    ),
    'active_leads_count',
    COALESCE(
      (
        SELECT count(*)::integer
        FROM active_enrollments
      ),
      0
    )
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_sent_at timestamptz := now();
  v_scheduled integer := 0;
BEGIN
  SELECT *
  INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id
    AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para conclusao';
  END IF;

  UPDATE crm.automation_executions
  SET
    status = 'sent',
    sent_at = v_sent_at,
    rendered_message = COALESCE(p_rendered_message, rendered_message),
    completed_reason = 'sent',
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_execution.id;

  IF v_execution.funnel_id IS NOT NULL
    AND v_execution.step_id IS NOT NULL THEN
    INSERT INTO crm.automation_step_progress (
      aces_id,
      funnel_id,
      lead_id,
      step_id,
      sent_execution_id,
      first_sent_at
    )
    VALUES (
      v_execution.aces_id,
      v_execution.funnel_id,
      v_execution.lead_id,
      v_execution.step_id,
      v_execution.id,
      v_sent_at
    )
    ON CONFLICT (funnel_id, lead_id, step_id) DO UPDATE
    SET
      first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
      sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
      updated_at = now();
  END IF;

  IF v_execution.enrollment_id IS NOT NULL THEN
    v_scheduled := crm.schedule_enrollment_executions(v_execution.enrollment_id);

    UPDATE crm.automation_enrollments
    SET
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_execution.enrollment_id
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'scheduled', v_scheduled
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_repair_automation_ai_freezes(
  p_lead_id uuid DEFAULT NULL,
  p_reference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_state record;
  v_repaired integer := 0;
BEGIN
  IF current_setting('request.jwt.claim.role', TRUE) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Apenas o backend pode reparar freezes da IA';
  END IF;

  FOR v_state IN
    SELECT
      als.agent_id,
      als.lead_id,
      als.pause_origin,
      als.pause_reference,
      COALESCE(als.paused_at, als.updated_at) AS paused_anchor_at
    FROM crm.ai_lead_state als
    JOIN crm.ai_agents ag
      ON ag.id = als.agent_id
    WHERE als.status = 'paused'
      AND als.freeze_until IS NOT NULL
      AND als.freeze_until > now()
      AND COALESCE(als.manual_ai_enabled, TRUE) = TRUE
      AND (p_lead_id IS NULL OR als.lead_id = p_lead_id)
      AND COALESCE(als.pause_origin, 'human_webhook') NOT IN ('manual_send', 'manual_override', 'ai_policy')
      AND EXISTS (
        SELECT 1
        FROM crm.message_history human_echo
        JOIN crm.message_history automation_msg
          ON automation_msg.lead_id = human_echo.lead_id
         AND automation_msg.direction = 'outbound'
         AND COALESCE(automation_msg.instance, '') = COALESCE(human_echo.instance, '')
         AND btrim(COALESCE(automation_msg.content, '')) = btrim(COALESCE(human_echo.content, ''))
         AND automation_msg.sent_at BETWEEN human_echo.sent_at - interval '10 minutes'
                                      AND human_echo.sent_at + interval '10 minutes'
         AND (
           automation_msg.source_type IN ('automation', 'ai')
           OR COALESCE(automation_msg.conversation_id, '') LIKE 'automation:%'
         )
        WHERE human_echo.lead_id = als.lead_id
          AND human_echo.direction = 'outbound'
          AND human_echo.source_type = 'human'
          AND human_echo.created_by IS NULL
          AND human_echo.sent_at >= COALESCE(als.paused_at, als.updated_at) - interval '10 minutes'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM crm.message_history manual_msg
        WHERE manual_msg.lead_id = als.lead_id
          AND manual_msg.direction = 'outbound'
          AND manual_msg.source_type = 'human'
          AND manual_msg.created_by IS NOT NULL
          AND manual_msg.sent_at >= COALESCE(als.paused_at, als.updated_at) - interval '10 minutes'
          AND manual_msg.sent_at <= COALESCE(als.freeze_until, now()) + interval '10 minutes'
      )
  LOOP
    UPDATE crm.ai_lead_state
    SET
      freeze_until = NULL,
      status = 'active',
      pause_origin = NULL,
      pause_reference = NULL,
      paused_at = NULL,
      updated_at = now()
    WHERE agent_id = v_state.agent_id
      AND lead_id = v_state.lead_id;

    INSERT INTO crm.ai_runs (
      agent_id,
      lead_id,
      input_snapshot,
      output_snapshot,
      action_taken
    )
    VALUES (
      v_state.agent_id,
      v_state.lead_id,
      jsonb_build_object(
        'reason', 'automation_echo_freeze_repair',
        'previous_pause_origin', v_state.pause_origin,
        'previous_pause_reference', v_state.pause_reference
      ),
      jsonb_build_object(
        'repaired', TRUE,
        'reference', COALESCE(p_reference, 'automation_repair')
      ),
      'freeze_repair'
    );

    v_repaired := v_repaired + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'repaired', v_repaired,
    'lead_id', p_lead_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.find_next_enrollment_step(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.schedule_enrollment_executions(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_get_automation_message_flow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_get_automation_message_flow(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_repair_automation_ai_freezes(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION crm.find_next_enrollment_step(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.find_next_enrollment_step(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.schedule_enrollment_executions(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION crm.schedule_enrollment_executions(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.schedule_enrollment_executions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_get_automation_message_flow(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_get_automation_message_flow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_repair_automation_ai_freezes(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_repair_automation_ai_freezes(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_repair_automation_ai_freezes(uuid, text) FROM PUBLIC;
