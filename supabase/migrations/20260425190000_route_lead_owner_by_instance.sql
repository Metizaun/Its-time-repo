CREATE OR REPLACE FUNCTION public.rpc_create_lead(
  p_name text,
  p_contact_phone text,
  p_email text DEFAULT NULL,
  p_source text DEFAULT 'WhatsApp',
  p_last_city text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_instance text DEFAULT NULL,
  p_value numeric DEFAULT NULL,
  p_connection_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_instance text := NULLIF(btrim(COALESCE(p_instance, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_contact_phone text := NULLIF(btrim(COALESCE(p_contact_phone, '')), '');
  v_stage crm.pipeline_stages%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_instance_owner_id uuid;
  v_existing_opportunity_id uuid;
  v_opportunity_created boolean := false;
  v_normalized_opportunity_status crm.lead_status;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nome do lead e obrigatorio';
  END IF;

  IF v_contact_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone do lead e obrigatorio';
  END IF;

  IF v_instance IS NULL THEN
    RAISE EXCEPTION 'Selecione uma instancia valida para criar o lead';
  END IF;

  SELECT i.created_by
  INTO v_instance_owner_id
  FROM crm.instance i
  WHERE i.aces_id = v_aces_id
    AND i.instancia = v_instance
    AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
    AND (
      i.created_by = v_current_user_id
      OR lower(i.instancia) = 'prospect'
    )
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A instancia selecionada nao esta disponivel para o usuario atual';
  END IF;

  IF v_instance_owner_id IS NULL THEN
    RAISE EXCEPTION 'A instancia selecionada nao possui um responsavel configurado';
  END IF;

  IF p_stage_id IS NOT NULL THEN
    SELECT *
    INTO v_stage
    FROM crm.pipeline_stages
    WHERE id = p_stage_id
      AND aces_id = v_aces_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa nao encontrada para a conta atual';
    END IF;
  END IF;

  INSERT INTO crm.leads (
    aces_id,
    owner_id,
    name,
    contact_phone,
    email,
    "Fonte",
    last_city,
    notes,
    stage_id,
    status,
    instancia,
    view
  )
  VALUES (
    v_aces_id,
    v_instance_owner_id,
    v_name,
    v_contact_phone,
    NULLIF(btrim(COALESCE(p_email, '')), ''),
    NULLIF(btrim(COALESCE(p_source, '')), ''),
    NULLIF(btrim(COALESCE(p_last_city, '')), ''),
    NULLIF(btrim(COALESCE(p_notes, '')), ''),
    p_stage_id,
    CASE
      WHEN p_stage_id IS NULL THEN NULL
      WHEN v_stage.category = 'Ganho' THEN 'Fechado'
      WHEN v_stage.category = 'Perdido' THEN 'Perdido'
      ELSE v_stage.name
    END,
    v_instance,
    TRUE
  )
  RETURNING *
  INTO v_lead;

  IF p_value IS NOT NULL OR NULLIF(btrim(COALESCE(p_connection_level, '')), '') IS NOT NULL THEN
    v_normalized_opportunity_status := CASE
      WHEN lower(COALESCE(v_lead.status, '')) IN ('ganho', 'fechado', 'sucesso', 'vendido') THEN 'Fechado'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) IN ('perdido', 'cancelado', 'cancelada') THEN 'Perdido'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) = 'remarketing' THEN 'Remarketing'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) = 'atendimento' THEN 'Atendimento'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) IN ('orcamento', 'orçamento') THEN 'Orçamento'::crm.lead_status
      ELSE 'Novo'::crm.lead_status
    END;

    SELECT id
    INTO v_existing_opportunity_id
    FROM crm.opportunities
    WHERE lead_id = v_lead.id
      AND aces_id = v_aces_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_opportunity_id IS NULL THEN
      INSERT INTO crm.opportunities (
        lead_id,
        aces_id,
        status,
        value,
        connection_level,
        responsible_id
      )
      VALUES (
        v_lead.id,
        v_aces_id,
        v_normalized_opportunity_status,
        p_value,
        NULLIF(btrim(COALESCE(p_connection_level, '')), ''),
        v_instance_owner_id
      );
    ELSE
      UPDATE crm.opportunities
      SET
        status = v_normalized_opportunity_status,
        value = p_value,
        connection_level = NULLIF(btrim(COALESCE(p_connection_level, '')), ''),
        responsible_id = COALESCE(responsible_id, v_instance_owner_id),
        updated_at = now()
      WHERE id = v_existing_opportunity_id;
    END IF;

    v_opportunity_created := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead.id,
    'owner_id', v_lead.owner_id,
    'status', v_lead.status,
    'stage_id', v_lead.stage_id,
    'opportunity_created', v_opportunity_created,
    'message', 'Lead criado com sucesso'
  );
END;
$$;
