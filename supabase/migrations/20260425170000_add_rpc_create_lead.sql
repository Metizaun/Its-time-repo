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
  v_opportunity_created boolean := false;
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

  IF NOT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.aces_id = v_aces_id
      AND i.instancia = v_instance
      AND i.created_by = v_current_user_id
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'A instancia selecionada nao pertence ao usuario atual';
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
    v_current_user_id,
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
    PERFORM public.rpc_create_opportunity(
      v_lead.id,
      p_value,
      NULLIF(btrim(COALESCE(p_connection_level, '')), ''),
      COALESCE(v_lead.status, v_stage.name, 'Novo')
    );
    v_opportunity_created := true;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'lead_id', v_lead.id,
    'status', v_lead.status,
    'stage_id', v_lead.stage_id,
    'opportunity_created', v_opportunity_created,
    'message', 'Lead criado com sucesso'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_lead(text, text, text, text, text, text, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_lead(text, text, text, text, text, text, uuid, text, numeric, text) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_create_lead(text, text, text, text, text, text, uuid, text, numeric, text) FROM anon;
REVOKE ALL ON FUNCTION public.rpc_create_lead(text, text, text, text, text, text, uuid, text, numeric, text) FROM PUBLIC;
