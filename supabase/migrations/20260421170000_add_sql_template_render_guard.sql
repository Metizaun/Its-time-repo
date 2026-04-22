CREATE OR REPLACE FUNCTION crm.normalize_automation_business_name(p_name text)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_text text := btrim(regexp_replace(COALESCE(p_name, ''), '[[:space:]]+', ' ', 'g'));
  v_parts text[];
  v_part text;
  v_candidate text;
  v_lower text;
BEGIN
  IF v_text = '' OR v_text = '.' THEN
    RETURN 'sua empresa';
  END IF;

  v_parts := regexp_split_to_array(v_text, '[[:space:]]+(\||-|–|—|•|·)[[:space:]]+');

  IF array_length(v_parts, 1) IS NULL THEN
    v_parts := ARRAY[v_text];
  END IF;

  FOREACH v_part IN ARRAY v_parts
  LOOP
    v_candidate := btrim(regexp_replace(v_part, '[[:space:]]+', ' ', 'g'));
    v_candidate := btrim(split_part(v_candidate, ',', 1));
    v_candidate := btrim(regexp_replace(v_candidate, '[[:space:]]*\([^)]{3,80}\)[[:space:]]*$', '', 'g'));
    v_candidate := btrim(regexp_replace(v_candidate, '\.$', '', 'g'));
    v_lower := lower(v_candidate);

    IF v_candidate = '' THEN
      CONTINUE;
    END IF;

    IF v_lower IN (
      'clínica de estética',
      'clinica de estetica',
      'clínica odontológica',
      'clinica odontologica',
      'consultório odontológico',
      'consultorio odontologico',
      'centro',
      'curitiba',
      'são paulo',
      'sao paulo',
      'são josé dos pinhais',
      'sao jose dos pinhais'
    )
      OR v_lower LIKE 'limpeza de pele%'
      OR v_lower LIKE 'dentista%'
      OR v_lower LIKE 'implante%'
      OR v_lower LIKE 'advogado%'
      OR v_lower LIKE 'oftalmologista%' THEN
      CONTINUE;
    END IF;

    RETURN left(v_candidate, 80);
  END LOOP;

  RETURN left(btrim(split_part(v_text, ',', 1)), 80);
END;
$function$;

CREATE OR REPLACE FUNCTION crm.render_automation_message_template(
  p_template text,
  p_lead_name text,
  p_phone text,
  p_city text,
  p_status text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_rendered text := COALESCE(p_template, '');
  v_company text := crm.normalize_automation_business_name(p_lead_name);
BEGIN
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*empresas?[[:space:]]*[\}\]]', v_company, 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*nome[[:space:]]*[\}\]]', COALESCE(p_lead_name, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*telefone[[:space:]]*[\}\]]', COALESCE(p_phone, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*cidade[[:space:]]*[\}\]]', COALESCE(p_city, ''), 'gi');
  v_rendered := regexp_replace(v_rendered, '[\{\[][[:space:]]*status[[:space:]]*[\}\]]', COALESCE(p_status, ''), 'gi');

  RETURN v_rendered;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.has_unresolved_automation_template_vars(p_message text)
RETURNS boolean
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(p_message, '') ~ '[\{\[][[:space:]]*[A-Za-z_][A-Za-z0-9_]*[[:space:]]*[\}\]]';
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_claim_due_automation_executions_v2(p_limit integer DEFAULT 50)
RETURNS TABLE (
  execution_id uuid,
  enrollment_id uuid,
  lead_id uuid,
  aces_id integer,
  instance_name text,
  phone text,
  lead_name text,
  city text,
  lead_status text,
  template text,
  step_label text,
  funnel_name text,
  scheduled_at timestamptz,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_due record;
  v_execution record;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
  v_step_result jsonb;
  v_rendered_template text;
  v_reason text;
BEGIN
  FOR v_due IN
    SELECT ae.id
    FROM crm.automation_executions ae
    WHERE ae.status = 'pending'
      AND ae.scheduled_at <= now()
    ORDER BY ae.scheduled_at ASC, ae.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT
      ae.*,
      s.message_template,
      s.is_active AS step_is_active,
      s.step_rule,
      f.is_active AS funnel_is_active,
      f.entry_rule,
      f.exit_rule,
      f.trigger_stage_id,
      f.instance_name AS funnel_instance_name,
      e.status AS enrollment_status,
      e.anchor_at,
      e.reply_target_stage_id,
      l.contact_phone AS live_phone,
      l.stage_id AS live_stage_id,
      l.instancia AS live_instance_name,
      COALESCE(l.view, TRUE) AS live_view
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.automation_enrollments e ON e.id = ae.enrollment_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_reason := NULL;
    v_rendered_template := crm.render_automation_message_template(
      v_execution.message_template,
      v_execution.lead_name_snapshot,
      v_execution.phone_snapshot,
      v_execution.city_snapshot,
      v_execution.status_snapshot
    );

    IF v_execution.funnel_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Automacao inativa';
    ELSIF v_execution.step_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Mensagem inativa';
    ELSIF COALESCE(v_execution.enrollment_status, '') <> 'active' THEN
      v_reason := 'Enrollment inativo';
    ELSIF COALESCE(v_execution.live_view, TRUE) = FALSE THEN
      v_reason := 'Lead oculto';
    ELSIF COALESCE(v_execution.live_phone, '') = '' THEN
      v_reason := 'Lead sem telefone';
    ELSIF COALESCE(v_execution.live_instance_name, '') <> COALESCE(v_execution.funnel_instance_name, '') THEN
      v_reason := 'Lead fora da instancia da automacao';
    ELSIF crm.has_unresolved_automation_template_vars(v_rendered_template) THEN
      v_reason := 'Mensagem contem variavel nao resolvida';
    END IF;

    IF v_reason IS NULL THEN
      v_context := crm.get_automation_context(v_execution.lead_id);
      v_entry_result := crm.evaluate_automation_rule_node(v_execution.entry_rule, v_context, v_execution.anchor_at);
      v_exit_result := crm.evaluate_automation_rule_node(v_execution.exit_rule, v_context, v_execution.anchor_at);
      v_step_result := CASE
        WHEN v_execution.step_rule IS NULL THEN jsonb_build_object('matched', TRUE)
        ELSE crm.evaluate_automation_rule_node(v_execution.step_rule, v_context, v_execution.anchor_at)
      END;

      IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
        v_reason := 'Regra de entrada nao corresponde mais';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'cancelled', v_reason, FALSE);
      ELSIF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
        v_reason := 'Jornada encerrada por regra de saida';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'completed', v_reason, TRUE);
      ELSIF COALESCE((v_step_result->>'matched')::boolean, FALSE) = FALSE THEN
        v_reason := 'Regra extra da mensagem nao bate mais';
      ELSIF v_execution.trigger_stage_id IS NOT NULL AND v_execution.live_stage_id IS DISTINCT FROM v_execution.trigger_stage_id THEN
        v_reason := 'Lead saiu da etapa da jornada';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'cancelled', v_reason, FALSE);
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE crm.automation_executions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        completed_reason = COALESCE(completed_reason, v_reason),
        last_error = COALESCE(last_error, v_reason),
        updated_at = now()
      WHERE id = v_execution.id
        AND status = 'pending';

      IF v_execution.instance_snapshot IS NOT NULL THEN
        PERFORM crm.recalculate_automation_instance_dispatch_state(
          v_execution.aces_id,
          v_execution.instance_snapshot
        );
      END IF;

      CONTINUE;
    END IF;

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      claimed_by = COALESCE(auth.uid()::text, 'service_role'),
      updated_at = now()
    WHERE id = v_execution.id
      AND status = 'pending';

    IF FOUND THEN
      RETURN QUERY
      SELECT
        v_execution.id,
        v_execution.enrollment_id,
        v_execution.lead_id,
        v_execution.aces_id,
        v_execution.instance_snapshot,
        v_execution.phone_snapshot,
        v_execution.lead_name_snapshot,
        v_execution.city_snapshot,
        v_execution.status_snapshot,
        v_rendered_template,
        v_execution.step_label_snapshot,
        v_execution.funnel_name_snapshot,
        v_execution.scheduled_at,
        v_execution.attempt_count;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.normalize_automation_business_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.render_automation_message_template(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.has_unresolved_automation_template_vars(text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;
