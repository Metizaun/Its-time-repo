-- Estende a regra "usuario ve/opera apenas seus leads" para chat, IA e automacoes.

CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads l
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND l.owner_id = public.current_crm_user_id()
  );
$$;

CREATE OR REPLACE FUNCTION crm.funnel_owns_lead(p_funnel_id uuid, p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.automation_funnels f
    JOIN crm.leads l
      ON l.id = p_lead_id
     AND l.aces_id = f.aces_id
    WHERE f.id = p_funnel_id
      AND l.owner_id = f.created_by
  );
$$;

GRANT EXECUTE ON FUNCTION crm.current_user_can_access_lead(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.funnel_owns_lead(uuid, uuid) TO authenticated, service_role;

UPDATE crm.automation_funnels f
SET created_by = (
  SELECT u.id
  FROM crm.users u
  WHERE u.aces_id = f.aces_id
    AND u.role <> 'NENHUM'
  ORDER BY CASE WHEN u.role = 'ADMIN' THEN 0 ELSE 1 END, u.created_at ASC
  LIMIT 1
)
WHERE f.created_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM crm.users u
    WHERE u.aces_id = f.aces_id
      AND u.role <> 'NENHUM'
  );

UPDATE crm.ai_agents a
SET created_by = (
  SELECT u.id
  FROM crm.users u
  WHERE u.aces_id = a.aces_id
    AND u.role <> 'NENHUM'
  ORDER BY CASE WHEN u.role = 'ADMIN' THEN 0 ELSE 1 END, u.created_at ASC
  LIMIT 1
)
WHERE a.created_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM crm.users u
    WHERE u.aces_id = a.aces_id
      AND u.role <> 'NENHUM'
  );

UPDATE crm.automation_executions ae
SET
  status = 'cancelled',
  cancelled_at = COALESCE(ae.cancelled_at, now()),
  last_error = COALESCE(ae.last_error, 'Cancelado por regra de responsavel do lead'),
  updated_at = now()
FROM crm.automation_funnels f, crm.leads l
WHERE ae.funnel_id = f.id
  AND ae.lead_id = l.id
  AND ae.status IN ('pending', 'processing')
  AND l.owner_id IS DISTINCT FROM f.created_by;

UPDATE crm.automation_enrollments e
SET
  status = 'cancelled',
  stopped_reason = COALESCE(e.stopped_reason, 'Cancelado por regra de responsavel do lead'),
  updated_at = now()
FROM crm.automation_funnels f, crm.leads l
WHERE e.funnel_id = f.id
  AND e.lead_id = l.id
  AND e.status = 'active'
  AND l.owner_id IS DISTINCT FROM f.created_by;

DROP POLICY IF EXISTS tasks_all ON crm.follow_up_tasks;
CREATE POLICY tasks_all ON crm.follow_up_tasks FOR ALL
  USING (crm.current_user_can_access_lead(lead_id))
  WITH CHECK (crm.current_user_can_access_lead(lead_id));

DO $$
BEGIN
  IF to_regclass('crm.agendamentos') IS NOT NULL THEN
    ALTER TABLE crm.agendamentos ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS agendamentos_all ON crm.agendamentos;
    CREATE POLICY agendamentos_all ON crm.agendamentos FOR ALL
      USING (crm.current_user_can_access_lead(lead_id))
      WITH CHECK (crm.current_user_can_access_lead(lead_id));
  END IF;

  IF to_regclass('crm.receituarios') IS NOT NULL THEN
    ALTER TABLE crm.receituarios ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS receituarios_all ON crm.receituarios;
    CREATE POLICY receituarios_all ON crm.receituarios FOR ALL
      USING (crm.current_user_can_access_lead(lead_id))
      WITH CHECK (crm.current_user_can_access_lead(lead_id));
  END IF;

  IF to_regclass('crm.lead_remarketing') IS NOT NULL THEN
    ALTER TABLE crm.lead_remarketing ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS lead_remarketing_all ON crm.lead_remarketing;
    CREATE POLICY lead_remarketing_all ON crm.lead_remarketing FOR ALL
      USING (crm.current_user_can_access_lead(lead_id))
      WITH CHECK (crm.current_user_can_access_lead(lead_id));
  END IF;
END $$;

DROP POLICY IF EXISTS ai_lead_state_select ON crm.ai_lead_state;
CREATE POLICY ai_lead_state_select ON crm.ai_lead_state FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS ai_runs_select ON crm.ai_runs;
CREATE POLICY ai_runs_select ON crm.ai_runs FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS ai_agents_select ON crm.ai_agents;
CREATE POLICY ai_agents_select ON crm.ai_agents FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_agents_insert ON crm.ai_agents;
CREATE POLICY ai_agents_insert ON crm.ai_agents FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_agents_update ON crm.ai_agents;
CREATE POLICY ai_agents_update ON crm.ai_agents FOR UPDATE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_agents_delete ON crm.ai_agents;
CREATE POLICY ai_agents_delete ON crm.ai_agents FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS ai_stage_rules_select ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_select ON crm.ai_stage_rules FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM crm.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_stage_rules_insert ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_insert ON crm.ai_stage_rules FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_stage_rules_update ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_update ON crm.ai_stage_rules FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM crm.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS ai_stage_rules_delete ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_delete ON crm.ai_stage_rules FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM crm.ai_agents a
      WHERE a.id = ai_stage_rules.agent_id
        AND a.aces_id = public.current_aces_id()
        AND a.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS automation_executions_select ON crm.automation_executions;
CREATE POLICY automation_executions_select ON crm.automation_executions FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS automation_enrollments_select ON crm.automation_enrollments;
CREATE POLICY automation_enrollments_select ON crm.automation_enrollments FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS lead_stage_events_select ON crm.lead_stage_events;
CREATE POLICY lead_stage_events_select ON crm.lead_stage_events FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS lead_automation_state_select ON crm.lead_automation_state;
CREATE POLICY lead_automation_state_select ON crm.lead_automation_state FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS automation_step_progress_select ON crm.automation_step_progress;
CREATE POLICY automation_step_progress_select ON crm.automation_step_progress FOR SELECT
  USING (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS automation_funnels_select ON crm.automation_funnels;
CREATE POLICY automation_funnels_select ON crm.automation_funnels FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS automation_funnels_insert ON crm.automation_funnels;
CREATE POLICY automation_funnels_insert ON crm.automation_funnels FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS automation_funnels_update ON crm.automation_funnels;
CREATE POLICY automation_funnels_update ON crm.automation_funnels FOR UPDATE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS automation_funnels_delete ON crm.automation_funnels;
CREATE POLICY automation_funnels_delete ON crm.automation_funnels FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS automation_steps_select ON crm.automation_steps;
CREATE POLICY automation_steps_select ON crm.automation_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM crm.automation_funnels f
      WHERE f.id = automation_steps.funnel_id
        AND f.aces_id = public.current_aces_id()
        AND f.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS automation_steps_insert ON crm.automation_steps;
CREATE POLICY automation_steps_insert ON crm.automation_steps FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.automation_funnels f
      WHERE f.id = automation_steps.funnel_id
        AND f.aces_id = public.current_aces_id()
        AND f.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS automation_steps_update ON crm.automation_steps;
CREATE POLICY automation_steps_update ON crm.automation_steps FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM crm.automation_funnels f
      WHERE f.id = automation_steps.funnel_id
        AND f.aces_id = public.current_aces_id()
        AND f.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.automation_funnels f
      WHERE f.id = automation_steps.funnel_id
        AND f.aces_id = public.current_aces_id()
        AND f.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

DROP POLICY IF EXISTS automation_steps_delete ON crm.automation_steps;
CREATE POLICY automation_steps_delete ON crm.automation_steps FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM crm.automation_funnels f
      WHERE f.id = automation_steps.funnel_id
        AND f.aces_id = public.current_aces_id()
        AND f.created_by = public.current_crm_user_id()
        AND public.current_crm_role() = 'ADMIN'::crm.user_role
    )
  );

CREATE OR REPLACE FUNCTION crm.handle_entry_event(
  p_lead_id uuid,
  p_anchor_event text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_context jsonb;
  v_funnel_id uuid;
  v_total integer := 0;
  v_aces_id integer := NULLIF(crm.get_automation_context(p_lead_id)->>'aces_id', '')::integer;
  v_owner_id uuid := NULLIF(crm.get_automation_context(p_lead_id)->>'owner_id', '')::uuid;
BEGIN
  v_context := crm.get_automation_context(p_lead_id);

  IF v_context IS NULL OR v_aces_id IS NULL OR v_owner_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_funnel_id IN
    SELECT id
    FROM crm.automation_funnels
    WHERE aces_id = v_aces_id
      AND created_by = v_owner_id
      AND is_active = TRUE
      AND anchor_event = p_anchor_event
  LOOP
    v_total := v_total + crm.start_or_refresh_enrollment(v_funnel_id, p_lead_id, v_context);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_preview_automation_rule(
  p_funnel_id uuid,
  p_lead_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_context jsonb;
  v_anchor jsonb;
  v_anchor_at timestamptz;
  v_steps jsonb := '[]'::jsonb;
  v_step crm.automation_steps%ROWTYPE;
  v_step_rule_result jsonb;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode visualizar o preview das automacoes';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  IF NOT crm.current_user_can_access_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado para o usuario atual';
  END IF;

  v_context := crm.get_automation_context(p_lead_id);
  IF v_context IS NULL OR NULLIF(v_context->>'aces_id', '')::integer IS DISTINCT FROM v_funnel.aces_id THEN
    RAISE EXCEPTION 'Lead nao encontrado para esta conta';
  END IF;

  v_anchor := crm.get_anchor_details_from_context(v_context, v_funnel.anchor_event);
  v_anchor_at := NULLIF(v_anchor->>'anchor_at', '')::timestamptz;

  FOR v_step IN
    SELECT *
    FROM crm.automation_steps
    WHERE funnel_id = v_funnel.id
      AND is_active = TRUE
    ORDER BY position ASC, created_at ASC
  LOOP
    v_step_rule_result := CASE
      WHEN v_step.step_rule IS NULL THEN NULL
      ELSE crm.evaluate_automation_rule_node(v_step.step_rule, v_context, v_anchor_at)
    END;

    v_steps := v_steps || jsonb_build_array(
      jsonb_build_object(
        'id', v_step.id,
        'label', v_step.label,
        'delay_minutes', v_step.delay_minutes,
        'scheduled_at', CASE
          WHEN v_anchor_at IS NULL THEN NULL
          ELSE v_anchor_at + make_interval(mins => v_step.delay_minutes)
        END,
        'rule', v_step_rule_result
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'lead_id', p_lead_id,
    'funnel_id', v_funnel.id,
    'anchor_event', v_funnel.anchor_event,
    'anchor_at', v_anchor_at,
    'reply_target_stage_id', v_funnel.reply_target_stage_id,
    'entry_rule', crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_anchor_at),
    'exit_rule', crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_anchor_at),
    'steps', v_steps
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_sync_automation_funnel_v2(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_cancelled integer := 0;
  v_scheduled integer := 0;
  v_lead_id uuid;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode sincronizar automacoes';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

  IF COALESCE(v_funnel.is_active, TRUE) = FALSE THEN
    FOR v_enrollment IN
      SELECT *
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND status = 'active'
    LOOP
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Automacao desativada', FALSE);
    END LOOP;

    RETURN jsonb_build_object('success', TRUE, 'cancelled', v_cancelled, 'scheduled', 0);
  END IF;

  FOR v_enrollment IN
    SELECT e.*
    FROM crm.automation_enrollments e
    JOIN crm.leads l ON l.id = e.lead_id
    WHERE e.funnel_id = v_funnel.id
      AND e.status = 'active'
      AND l.owner_id = v_funnel.created_by
  LOOP
    v_context := crm.get_automation_context(v_enrollment.lead_id);

    IF v_context IS NULL THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead nao encontrado na sincronizacao', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead saiu da instancia da jornada', FALSE);
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_enrollment.anchor_at);
    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Regra de entrada nao bate mais', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'completed', 'Regra de saida ja atendida', TRUE);
      CONTINUE;
    END IF;

    v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment.id);
  END LOOP;

  FOR v_lead_id IN
    SELECT id
    FROM crm.leads
    WHERE aces_id = v_funnel.aces_id
      AND owner_id = v_funnel.created_by
      AND COALESCE(view, TRUE) = TRUE
      AND COALESCE(instancia, '') = COALESCE(v_funnel.instance_name, '')
  LOOP
    v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(v_funnel.id, v_lead_id);
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'cancelled', v_cancelled, 'scheduled', v_scheduled);
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
    AND created_by = public.current_crm_user_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  WITH active_enrollments AS (
    SELECT e.id, e.lead_id
    FROM crm.automation_enrollments e
    JOIN crm.leads l ON l.id = e.lead_id
    WHERE e.funnel_id = v_funnel.id
      AND e.status = 'active'
      AND l.owner_id = public.current_crm_user_id()
  ),
  next_steps AS (
    SELECT e.lead_id, ns.step_id::text AS step_id
    FROM active_enrollments e
    LEFT JOIN LATERAL crm.find_next_enrollment_step(e.id) ns ON TRUE
  ),
  counts AS (
    SELECT step_id, count(*)::integer AS lead_count
    FROM next_steps
    WHERE step_id IS NOT NULL
    GROUP BY step_id
  ),
  max_count AS (
    SELECT max(lead_count) AS value
    FROM counts
  )
  SELECT jsonb_build_object(
    'step_counts', COALESCE((SELECT jsonb_object_agg(step_id, lead_count) FROM counts), '{}'::jsonb),
    'parked_count', COALESCE((SELECT count(*)::integer FROM next_steps WHERE step_id IS NULL), 0),
    'highlighted_step_ids', COALESCE((
      SELECT jsonb_agg(c.step_id ORDER BY c.step_id)
      FROM counts c
      CROSS JOIN max_count m
      WHERE m.value IS NOT NULL AND m.value > 0 AND c.lead_count = m.value
    ), '[]'::jsonb),
    'active_leads_count', COALESCE((SELECT count(*)::integer FROM active_enrollments), 0)
  )
  INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
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
  v_count integer;
BEGIN
  SELECT * INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND OR v_enrollment.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads
  WHERE id = v_enrollment.lead_id
    AND aces_id = v_enrollment.aces_id
  LIMIT 1;

  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) = FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR v_lead.owner_id IS DISTINCT FROM v_funnel.created_by THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id, funnel_id, step_id, enrollment_id, lead_id, source_stage_id,
    scheduled_at, phone_snapshot, instance_snapshot, lead_name_snapshot,
    city_snapshot, status_snapshot, funnel_name_snapshot, step_label_snapshot,
    step_rule_snapshot, anchor_at_snapshot
  )
  SELECT
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    s.id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.anchor_at + make_interval(mins => s.delay_minutes),
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    s.label,
    s.step_rule,
    v_enrollment.anchor_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND s.is_active = TRUE
  ORDER BY s.position ASC, s.created_at ASC
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.rpc_preview_automation_rule(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_sync_automation_funnel_v2(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_get_automation_message_flow(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.schedule_enrollment_executions(uuid) TO service_role;
