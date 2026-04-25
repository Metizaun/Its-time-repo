DROP POLICY IF EXISTS leads_select ON crm.leads;
CREATE POLICY leads_select ON crm.leads FOR SELECT
  USING (crm.current_user_can_access_lead(id));

DROP POLICY IF EXISTS leads_insert ON crm.leads;
CREATE POLICY leads_insert ON crm.leads FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
    AND crm.current_user_owns_instance(instancia)
  );

DROP POLICY IF EXISTS leads_update ON crm.leads;
CREATE POLICY leads_update ON crm.leads FOR UPDATE
  USING (crm.current_user_can_access_lead(id))
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
    AND crm.current_user_owns_instance(instancia)
  );

DROP POLICY IF EXISTS leads_delete ON crm.leads;
CREATE POLICY leads_delete ON crm.leads FOR DELETE
  USING (crm.current_user_can_access_lead(id));

DROP POLICY IF EXISTS lead_tags_all ON crm.lead_tags;
CREATE POLICY lead_tags_all ON crm.lead_tags FOR ALL
  USING (crm.current_user_can_access_lead(lead_id))
  WITH CHECK (crm.current_user_can_access_lead(lead_id));

DROP POLICY IF EXISTS opp_all ON crm.opportunities;
CREATE POLICY opp_all ON crm.opportunities FOR ALL
  USING (crm.current_user_can_access_lead(lead_id))
  WITH CHECK (crm.current_user_can_access_lead(lead_id));

CREATE OR REPLACE FUNCTION public.rpc_move_lead_to_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_stage crm.pipeline_stages%ROWTYPE;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT *
  INTO v_stage
  FROM crm.pipeline_stages
  WHERE id = p_stage_id
    AND aces_id = v_aces_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa nao encontrada para a conta atual';
  END IF;

  UPDATE crm.leads
  SET
    stage_id = p_stage_id,
    status = CASE
      WHEN v_stage.category = 'Ganho' THEN 'Fechado'
      WHEN v_stage.category = 'Perdido' THEN 'Perdido'
      ELSE v_stage.name
    END,
    updated_at = now()
  WHERE id = p_lead_id
    AND crm.current_user_can_access_lead(id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para o usuario atual';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_update_lead_status(p_lead_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_stage_id uuid;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT id
  INTO v_stage_id
  FROM crm.pipeline_stages
  WHERE aces_id = v_aces_id
    AND (
      (lower(p_status) IN ('fechado', 'ganho', 'sucesso', 'vendido') AND category = 'Ganho')
      OR (lower(p_status) IN ('perdido', 'cancelado', 'cancelada') AND category = 'Perdido')
      OR (category = 'Aberto' AND lower(name) = lower(p_status))
    )
  ORDER BY position
  LIMIT 1;

  UPDATE crm.leads
  SET
    status = CASE
      WHEN lower(p_status) IN ('ganho', 'sucesso', 'vendido') THEN 'Fechado'
      ELSE p_status
    END,
    stage_id = COALESCE(v_stage_id, stage_id),
    updated_at = now()
  WHERE id = p_lead_id
    AND crm.current_user_can_access_lead(id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para o usuario atual';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_create_opportunity(
  p_lead_id uuid,
  p_value numeric,
  p_connection_level text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_status crm.lead_status;
  v_existing_id uuid;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  IF NOT crm.current_user_can_access_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado para o usuario atual';
  END IF;

  v_status := CASE
    WHEN lower(COALESCE(p_status, '')) IN ('ganho', 'fechado', 'sucesso', 'vendido') THEN 'Fechado'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('perdido', 'cancelado', 'cancelada') THEN 'Perdido'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) = 'remarketing' THEN 'Remarketing'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) = 'atendimento' THEN 'Atendimento'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('orcamento', 'orçamento') THEN 'Orçamento'::crm.lead_status
    ELSE 'Novo'::crm.lead_status
  END;

  SELECT id
  INTO v_existing_id
  FROM crm.opportunities
  WHERE lead_id = p_lead_id
    AND aces_id = v_aces_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO crm.opportunities (lead_id, aces_id, status, value, connection_level, responsible_id)
    VALUES (p_lead_id, v_aces_id, v_status, p_value, p_connection_level, v_current_user_id);
  ELSE
    UPDATE crm.opportunities
    SET
      status = v_status,
      value = p_value,
      connection_level = p_connection_level,
      responsible_id = COALESCE(responsible_id, v_current_user_id),
      updated_at = now()
    WHERE id = v_existing_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_move_lead_to_stage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_lead_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_opportunity(uuid, numeric, text, text) TO authenticated;
