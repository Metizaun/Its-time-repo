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

  IF COALESCE(v_funnel.is_active, TRUE) = FALSE THEN
    v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

    FOR v_enrollment IN
      SELECT *
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND status = 'active'
    LOOP
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'cancelled',
        'Automacao desativada',
        FALSE
      );
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
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'cancelled',
        'Lead nao encontrado na sincronizacao',
        FALSE
      );
      CONTINUE;
    END IF;

    IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'cancelled',
        'Lead saiu da instancia da jornada',
        FALSE
      );
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_enrollment.anchor_at);
    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'cancelled',
        'Regra de entrada nao bate mais',
        FALSE
      );
      CONTINUE;
    END IF;

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'completed',
        'Regra de saida ja atendida',
        TRUE
      );
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

GRANT EXECUTE ON FUNCTION crm.rpc_sync_automation_funnel_v2(uuid) TO authenticated, service_role;
