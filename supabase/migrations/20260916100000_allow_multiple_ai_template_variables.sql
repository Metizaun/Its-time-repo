BEGIN;

-- Permite que mais de uma variavel de um template oficial seja gerada pela IA.
-- O worker reutiliza o texto gerado nas posicoes marcadas com source = 'ai'.
CREATE OR REPLACE FUNCTION crm.rpc_set_automation_funnel_active(
  p_funnel_id uuid,
  p_active boolean,
  p_ack_category_change boolean DEFAULT FALSE
)
RETURNS crm.automation_funnels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_connection crm.lead_webhook_connections%ROWTYPE;
  v_provider text;
BEGIN
  IF public.current_crm_role() <> 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'AUTOMATION_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_funnel FROM crm.automation_funnels
  WHERE id = p_funnel_id AND aces_id = public.current_aces_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_FUNNEL_NOT_FOUND'; END IF;
  IF p_active THEN
    SELECT lower(instance.provider) INTO v_provider
    FROM meta.instance AS instance
    WHERE instance.instance_name = v_funnel.instance_name;
    IF v_funnel.entry_source = 'lead_webhook' THEN
      SELECT * INTO v_connection FROM crm.lead_webhook_connections
      WHERE id = v_funnel.lead_webhook_connection_id AND aces_id = v_funnel.aces_id;
      IF NOT FOUND OR v_connection.status <> 'active' THEN RAISE EXCEPTION 'AUTOMATION_WEBHOOK_CONNECTION_INVALID'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM agents.ai_agents agent
        WHERE agent.id = v_connection.agent_id AND agent.aces_id = v_funnel.aces_id
          AND agent.instance_name = v_funnel.instance_name
          AND agent.agent_type = 'primary' AND agent.is_active IS TRUE
      ) THEN RAISE EXCEPTION 'AUTOMATION_INSTANCE_AGENT_INVALID'; END IF;
      IF EXISTS (
        SELECT 1 FROM crm.automation_steps step
        WHERE step.funnel_id = v_funnel.id AND step.is_active
          AND step.media_source = 'webhook' AND v_connection.accept_media IS DISTINCT FROM TRUE
      ) THEN RAISE EXCEPTION 'AUTOMATION_WEBHOOK_MEDIA_DISABLED'; END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.generation_mode = 'ai'
        AND length(btrim(COALESCE(step.ai_instruction, ''))) = 0
    ) THEN RAISE EXCEPTION 'AUTOMATION_AI_INSTRUCTION_REQUIRED'; END IF;
    IF v_provider IN ('meta', 'gupshup') AND EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND (
          step.template_provider IS DISTINCT FROM v_provider
          OR length(btrim(COALESCE(step.gupshup_template_name, step.gupshup_template_id, ''))) = 0
        )
    ) THEN RAISE EXCEPTION 'AUTOMATION_OFFICIAL_TEMPLATE_REQUIRED'; END IF;
    IF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.template_provider IN ('meta', 'gupshup')
        AND upper(COALESCE(step.template_status, '')) <> 'APPROVED'
    ) THEN RAISE EXCEPTION 'AUTOMATION_TEMPLATE_NOT_APPROVED'; END IF;
    IF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.template_provider IN ('meta', 'gupshup')
        AND (step.generation_mode = 'ai' OR jsonb_array_length(step.template_variable_bindings) > 0)
        AND (
          NOT crm.automation_template_bindings_valid(step.template_variable_bindings)
          OR jsonb_array_length(step.template_variable_bindings) <> jsonb_array_length(step.gupshup_template_params)
          OR (step.generation_mode = 'ai' AND (
            SELECT count(*) FROM jsonb_array_elements(step.template_variable_bindings) binding
            WHERE binding->>'source' = 'ai'
          )) = 0
        )
    ) THEN RAISE EXCEPTION 'AUTOMATION_TEMPLATE_BINDINGS_INVALID'; END IF;
    IF p_ack_category_change THEN
      UPDATE crm.automation_steps SET
        template_category_acknowledged_at = now(),
        template_category_acknowledged_by = public.current_crm_user_id()
      WHERE funnel_id = v_funnel.id AND template_requested_category IS DISTINCT FROM template_provider_category;
    ELSIF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.template_requested_category IS DISTINCT FROM step.template_provider_category
        AND step.template_category_acknowledged_at IS NULL
    ) THEN RAISE EXCEPTION 'AUTOMATION_TEMPLATE_CATEGORY_CONFIRMATION_REQUIRED'; END IF;
  END IF;
  UPDATE crm.automation_funnels SET is_active = p_active, updated_at = now()
  WHERE id = v_funnel.id RETURNING * INTO v_funnel;
  IF v_funnel.entry_source <> 'lead_webhook' THEN
    PERFORM crm.rpc_sync_automation_funnel_v2(v_funnel.id);
  END IF;
  RETURN v_funnel;
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_set_automation_funnel_active(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_set_automation_funnel_active(uuid, boolean, boolean) TO authenticated, service_role;

COMMIT;
