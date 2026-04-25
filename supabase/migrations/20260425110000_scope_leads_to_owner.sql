-- Garante que cada usuario autenticado veja e opere apenas os leads sob sua responsabilidade.

CREATE INDEX IF NOT EXISTS idx_leads_owner_id ON crm.leads(owner_id);

UPDATE crm.leads l
SET owner_id = (
  SELECT u.id
  FROM crm.users u
  WHERE u.aces_id = l.aces_id
    AND u.role <> 'NENHUM'
  ORDER BY
    CASE WHEN u.role = 'ADMIN' THEN 0 ELSE 1 END,
    u.created_at ASC
  LIMIT 1
)
WHERE l.owner_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM crm.users u
    WHERE u.aces_id = l.aces_id
      AND u.role <> 'NENHUM'
  );

CREATE OR REPLACE FUNCTION public.sync_lead_stage_and_aces()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_aces_id integer;
  v_current_user_id uuid;
  v_owner_aces_id integer;
  v_stage record;
BEGIN
  SELECT id, aces_id
  INTO v_current_user_id, v_current_aces_id
  FROM crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF NEW.owner_id IS NULL THEN
    NEW.owner_id := v_current_user_id;
  END IF;

  IF NEW.owner_id IS NOT NULL THEN
    SELECT aces_id
    INTO v_owner_aces_id
    FROM crm.users
    WHERE id = NEW.owner_id
    LIMIT 1;

    IF v_owner_aces_id IS NULL THEN
      RAISE EXCEPTION 'Responsavel do lead nao encontrado';
    END IF;

    IF NEW.aces_id IS NULL THEN
      NEW.aces_id := v_owner_aces_id;
    ELSIF NEW.aces_id <> v_owner_aces_id THEN
      RAISE EXCEPTION 'Responsavel do lead pertence a outra conta';
    END IF;
  END IF;

  IF NEW.aces_id IS NULL THEN
    NEW.aces_id := v_current_aces_id;
  END IF;

  IF NEW.stage_id IS NOT NULL THEN
    SELECT id, aces_id, name, category
    INTO v_stage
    FROM crm.pipeline_stages
    WHERE id = NEW.stage_id
    LIMIT 1;

    IF FOUND THEN
      IF NEW.aces_id IS NOT NULL AND v_stage.aces_id <> NEW.aces_id THEN
        RAISE EXCEPTION 'Etapa pertence a outra conta';
      END IF;

      NEW.aces_id := COALESCE(NEW.aces_id, v_stage.aces_id);
      NEW.status := CASE
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.aces_id IS NOT NULL THEN
    SELECT id, aces_id, name, category
    INTO v_stage
    FROM crm.pipeline_stages
    WHERE aces_id = NEW.aces_id
      AND (
        (lower(COALESCE(NEW.status, '')) IN ('fechado', 'ganho', 'sucesso', 'vendido') AND category = 'Ganho')
        OR (lower(COALESCE(NEW.status, '')) IN ('perdido', 'cancelado', 'cancelada') AND category = 'Perdido')
        OR (category = 'Aberto' AND lower(name) = lower(COALESCE(NEW.status, '')))
      )
    ORDER BY position
    LIMIT 1;

    IF FOUND THEN
      NEW.stage_id := v_stage.id;
      NEW.status := CASE
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END;
      RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' AND NEW.stage_id IS NULL THEN
      SELECT id, aces_id, name, category
      INTO v_stage
      FROM crm.pipeline_stages
      WHERE aces_id = NEW.aces_id
        AND category = 'Aberto'
      ORDER BY position
      LIMIT 1;

      IF FOUND THEN
        NEW.stage_id := v_stage.id;
        NEW.status := v_stage.name;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP POLICY IF EXISTS leads_select ON crm.leads;
CREATE POLICY leads_select ON crm.leads FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
  );

DROP POLICY IF EXISTS leads_insert ON crm.leads;
CREATE POLICY leads_insert ON crm.leads FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
  );

DROP POLICY IF EXISTS leads_update ON crm.leads;
CREATE POLICY leads_update ON crm.leads FOR UPDATE
  USING (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
  )
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
  );

DROP POLICY IF EXISTS leads_delete ON crm.leads;
CREATE POLICY leads_delete ON crm.leads FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND owner_id = public.current_crm_user_id()
  );

DROP POLICY IF EXISTS msg_select ON crm.message_history;
CREATE POLICY msg_select ON crm.message_history FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = message_history.lead_id
        AND l.aces_id = public.current_aces_id()
        AND l.owner_id = public.current_crm_user_id()
    )
  );

DROP POLICY IF EXISTS msg_insert ON crm.message_history;
CREATE POLICY msg_insert ON crm.message_history FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = message_history.lead_id
        AND l.aces_id = public.current_aces_id()
        AND l.owner_id = public.current_crm_user_id()
    )
  );

DROP POLICY IF EXISTS lead_tags_all ON crm.lead_tags;
CREATE POLICY lead_tags_all ON crm.lead_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = lead_tags.lead_id
        AND l.aces_id = public.current_aces_id()
        AND l.owner_id = public.current_crm_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = lead_tags.lead_id
        AND l.aces_id = public.current_aces_id()
        AND l.owner_id = public.current_crm_user_id()
    )
  );

DROP POLICY IF EXISTS opp_all ON crm.opportunities;
CREATE POLICY opp_all ON crm.opportunities FOR ALL
  USING (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = opportunities.lead_id
        AND l.aces_id = public.current_aces_id()
        AND l.owner_id = public.current_crm_user_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM crm.leads l
      WHERE l.id = opportunities.lead_id
        AND l.aces_id = public.current_aces_id()
        AND l.owner_id = public.current_crm_user_id()
    )
  );

ALTER VIEW crm.v_lead_details SET (security_invoker = true);

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
    AND aces_id = v_aces_id
    AND owner_id = v_current_user_id;

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
    AND aces_id = v_aces_id
    AND owner_id = v_current_user_id;

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

  IF NOT EXISTS (
    SELECT 1
    FROM crm.leads l
    WHERE l.id = p_lead_id
      AND l.aces_id = v_aces_id
      AND l.owner_id = v_current_user_id
  ) THEN
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

CREATE OR REPLACE FUNCTION public.rpc_get_chat(p_lead_id uuid)
RETURNS TABLE (
  id uuid,
  lead_id uuid,
  content text,
  direction text,
  direction_code integer,
  sent_at timestamptz,
  lead_name text,
  sender_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT
    mh.id,
    mh.lead_id,
    mh.content,
    mh.direction,
    CASE WHEN lower(mh.direction) = 'outbound' THEN 2 ELSE 1 END AS direction_code,
    mh.sent_at,
    l.name AS lead_name,
    u.name AS sender_name
  FROM crm.message_history mh
  JOIN crm.leads l ON l.id = mh.lead_id
  LEFT JOIN crm.users u ON u.id = mh.created_by
  WHERE mh.lead_id = p_lead_id
    AND mh.aces_id = public.current_aces_id()
    AND l.owner_id = public.current_crm_user_id()
  ORDER BY mh.sent_at ASC, mh.id ASC;
$$;

CREATE OR REPLACE FUNCTION public.rpc_send_message(
  p_lead_id uuid,
  p_content text,
  p_direction text,
  p_conversation_id text DEFAULT NULL,
  p_instance text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_instance text;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT COALESCE(p_instance, instancia)
  INTO v_instance
  FROM crm.leads
  WHERE id = p_lead_id
    AND aces_id = v_aces_id
    AND owner_id = v_current_user_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para o usuario atual';
  END IF;

  IF v_instance IS NULL THEN
    v_instance := (
      SELECT instancia
      FROM crm.instance
      WHERE aces_id = v_aces_id
      ORDER BY instancia
      LIMIT 1
    );
  END IF;

  INSERT INTO crm.message_history (
    lead_id,
    aces_id,
    content,
    direction,
    conversation_id,
    instance,
    created_by,
    sent_at
  )
  VALUES (
    p_lead_id,
    v_aces_id,
    p_content,
    COALESCE(NULLIF(p_direction, ''), 'outbound'),
    p_conversation_id,
    v_instance,
    v_current_user_id,
    now()
  );

  UPDATE crm.leads
  SET
    last_message_at = now(),
    updated_at = now(),
    instancia = COALESCE(v_instance, instancia)
  WHERE id = p_lead_id
    AND aces_id = v_aces_id
    AND owner_id = v_current_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_move_lead_to_stage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_lead_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_opportunity(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_send_message(uuid, text, text, text, text) TO authenticated;
