CREATE OR REPLACE FUNCTION crm.rpc_repair_automation_funnel_dispatch(p_funnel_id uuid)
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
  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada para reparo';
  END IF;

  v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

  IF COALESCE(v_funnel.is_active, TRUE) = FALSE THEN
    PERFORM crm.recalculate_automation_instance_dispatch_state(v_funnel.aces_id, v_funnel.instance_name);
    RETURN jsonb_build_object(
      'success', TRUE,
      'cancelled', v_cancelled,
      'scheduled', 0,
      'reason', 'Automacao inativa'
    );
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE funnel_id = v_funnel.id
      AND status = 'active'
  LOOP
    v_context := crm.get_automation_context(v_enrollment.lead_id);

    IF v_context IS NULL THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead nao encontrado no reparo', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead fora da instancia no reparo', FALSE);
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_enrollment.anchor_at);
    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Regra de entrada nao bate no reparo', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'completed', 'Regra de saida ja atendida no reparo', TRUE);
      CONTINUE;
    END IF;

    v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment.id);
  END LOOP;

  FOR v_lead_id IN
    SELECT id
    FROM crm.leads
    WHERE aces_id = v_funnel.aces_id
      AND COALESCE(view, TRUE) = TRUE
      AND COALESCE(instancia, '') = COALESCE(v_funnel.instance_name, '')
  LOOP
    v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(v_funnel.id, v_lead_id);
  END LOOP;

  PERFORM crm.recalculate_automation_instance_dispatch_state(v_funnel.aces_id, v_funnel.instance_name);

  RETURN jsonb_build_object(
    'success', TRUE,
    'cancelled', v_cancelled,
    'scheduled', v_scheduled,
    'instance_name', v_funnel.instance_name
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.rpc_repair_automation_funnel_dispatch(uuid) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_repair_automation_funnel_dispatch(uuid) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_repair_automation_funnel_dispatch(uuid) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_repair_automation_funnel_dispatch(uuid) FROM PUBLIC;
