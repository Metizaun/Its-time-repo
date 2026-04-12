-- Bootstrap inicial + compatibilidade com o frontend atual

-- 1. Helpers de contexto do usuario logado
CREATE OR REPLACE FUNCTION public.current_crm_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM Crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_aces_id()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT aces_id
  FROM Crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_crm_role()
RETURNS Crm.user_role
LANGUAGE sql
STABLE
AS $$
  SELECT role
  FROM Crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

-- 2. Pipeline padrao por conta
CREATE OR REPLACE FUNCTION Crm.fn_create_default_pipeline_stages(p_aces_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO Crm.pipeline_stages (aces_id, name, color, position, category)
  SELECT p_aces_id, data.name, data.color, data.position, data.category
  FROM (
    VALUES
      ('Novo', '#64748b', 0, 'Aberto'),
      ('Atendimento', '#0ea5e9', 1, 'Aberto'),
      ('Orçamento', '#f59e0b', 2, 'Aberto'),
      ('Fechado', '#22c55e', 3, 'Ganho'),
      ('Perdido', '#ef4444', 4, 'Perdido'),
      ('Remarketing', '#a855f7', 5, 'Aberto')
  ) AS data(name, color, position, category)
  WHERE NOT EXISTS (
    SELECT 1
    FROM Crm.pipeline_stages ps
    WHERE ps.aces_id = p_aces_id
      AND lower(ps.name) = lower(data.name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION Crm.trg_create_default_pipeline_stages()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM Crm.fn_create_default_pipeline_stages(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_insert_pipeline_stages ON Crm.accounts;
CREATE TRIGGER trg_accounts_insert_pipeline_stages
  AFTER INSERT ON Crm.accounts
  FOR EACH ROW EXECUTE FUNCTION Crm.trg_create_default_pipeline_stages();

-- 3. Sync de lead para stage/status/aces_id
CREATE OR REPLACE FUNCTION public.sync_lead_stage_and_aces()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_current_aces_id integer;
  v_stage record;
BEGIN
  SELECT aces_id
  INTO v_current_aces_id
  FROM Crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;

  IF NEW.aces_id IS NULL THEN
    NEW.aces_id := COALESCE(
      (SELECT aces_id FROM Crm.users WHERE id = NEW.owner_id LIMIT 1),
      v_current_aces_id,
      NEW.aces_id
    );
  END IF;

  IF NEW.stage_id IS NOT NULL THEN
    SELECT id, aces_id, name, category
    INTO v_stage
    FROM Crm.pipeline_stages
    WHERE id = NEW.stage_id
    LIMIT 1;

    IF FOUND THEN
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
    FROM Crm.pipeline_stages
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
      FROM Crm.pipeline_stages
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

DROP TRIGGER IF EXISTS trg_sync_lead_stage_and_aces ON Crm.leads;
CREATE TRIGGER trg_sync_lead_stage_and_aces
  BEFORE INSERT OR UPDATE OF stage_id, status, aces_id, owner_id ON Crm.leads
  FOR EACH ROW EXECUTE FUNCTION public.sync_lead_stage_and_aces();

-- 4. Defaults de oportunidade
CREATE OR REPLACE FUNCTION public.sync_opportunity_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.aces_id IS NULL THEN
    SELECT aces_id INTO NEW.aces_id
    FROM Crm.leads
    WHERE id = NEW.lead_id
    LIMIT 1;
  END IF;

  IF NEW.responsible_id IS NULL THEN
    NEW.responsible_id := public.current_crm_user_id();
  END IF;

  IF NEW.status IS NULL THEN
    NEW.status := 'Novo';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_opportunity_defaults ON Crm.opportunities;
CREATE TRIGGER trg_sync_opportunity_defaults
  BEFORE INSERT OR UPDATE OF lead_id, aces_id, responsible_id, status ON Crm.opportunities
  FOR EACH ROW EXECUTE FUNCTION public.sync_opportunity_defaults();

-- 5. Vincular auth.users a Crm.users a partir de convite
CREATE OR REPLACE FUNCTION public.sync_crm_user_from_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_invitation_id uuid;
  v_invitation Crm.user_invitations%ROWTYPE;
BEGIN
  IF COALESCE(NEW.email_confirmed_at, NEW.last_sign_in_at) IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_invitation_id := COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'invitation_id', ''),
      NULLIF(NEW.raw_app_meta_data->>'invitation_id', '')
    )::uuid;
  EXCEPTION WHEN others THEN
    v_invitation_id := NULL;
  END;

  IF v_invitation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_invitation
  FROM Crm.user_invitations
  WHERE id = v_invitation_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO Crm.users (auth_user_id, email, name, role, aces_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(v_invitation.name, NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_invitation.role,
    v_invitation.aces_id
  )
  ON CONFLICT (auth_user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, Crm.users.name),
    role = EXCLUDED.role,
    aces_id = EXCLUDED.aces_id,
    updated_at = now();

  UPDATE Crm.user_invitations
  SET
    status = 'accepted',
    accepted_at = COALESCE(accepted_at, now())
  WHERE id = v_invitation_id
    AND status <> 'cancelled';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_crm_user_from_invitation ON auth.users;
CREATE TRIGGER trg_sync_crm_user_from_invitation
  AFTER INSERT OR UPDATE OF email_confirmed_at, last_sign_in_at, raw_user_meta_data, raw_app_meta_data ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_crm_user_from_invitation();

-- 6. RPCs esperadas pelo frontend
CREATE OR REPLACE FUNCTION public.rpc_move_lead_to_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_stage Crm.pipeline_stages%ROWTYPE;
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT *
  INTO v_stage
  FROM Crm.pipeline_stages
  WHERE id = p_stage_id
    AND aces_id = v_aces_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa nao encontrada para a conta atual';
  END IF;

  UPDATE Crm.leads
  SET
    stage_id = p_stage_id,
    status = CASE
      WHEN v_stage.category = 'Ganho' THEN 'Fechado'
      WHEN v_stage.category = 'Perdido' THEN 'Perdido'
      ELSE v_stage.name
    END,
    updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = v_aces_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para a conta atual';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_update_lead_status(p_lead_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_stage_id uuid;
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT id
  INTO v_stage_id
  FROM Crm.pipeline_stages
  WHERE aces_id = v_aces_id
    AND (
      (lower(p_status) IN ('fechado', 'ganho', 'sucesso', 'vendido') AND category = 'Ganho')
      OR (lower(p_status) IN ('perdido', 'cancelado', 'cancelada') AND category = 'Perdido')
      OR (category = 'Aberto' AND lower(name) = lower(p_status))
    )
  ORDER BY position
  LIMIT 1;

  UPDATE Crm.leads
  SET
    status = CASE
      WHEN lower(p_status) IN ('ganho', 'sucesso', 'vendido') THEN 'Fechado'
      ELSE p_status
    END,
    stage_id = COALESCE(v_stage_id, stage_id),
    updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = v_aces_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para a conta atual';
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
SET search_path = public, Crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_status Crm.lead_status;
  v_existing_id uuid;
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  v_status := CASE
    WHEN lower(COALESCE(p_status, '')) IN ('ganho', 'fechado', 'sucesso', 'vendido') THEN 'Fechado'::Crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('perdido', 'cancelado', 'cancelada') THEN 'Perdido'::Crm.lead_status
    WHEN lower(COALESCE(p_status, '')) = 'remarketing' THEN 'Remarketing'::Crm.lead_status
    WHEN lower(COALESCE(p_status, '')) = 'atendimento' THEN 'Atendimento'::Crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('orcamento', 'orçamento') THEN 'Orçamento'::Crm.lead_status
    ELSE 'Novo'::Crm.lead_status
  END;

  SELECT id
  INTO v_existing_id
  FROM Crm.opportunities
  WHERE lead_id = p_lead_id
    AND aces_id = v_aces_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO Crm.opportunities (lead_id, aces_id, status, value, connection_level, responsible_id)
    VALUES (p_lead_id, v_aces_id, v_status, p_value, p_connection_level, public.current_crm_user_id());
  ELSE
    UPDATE Crm.opportunities
    SET
      status = v_status,
      value = p_value,
      connection_level = p_connection_level,
      responsible_id = COALESCE(responsible_id, public.current_crm_user_id()),
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
SET search_path = public, Crm
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
  FROM Crm.message_history mh
  JOIN Crm.leads l ON l.id = mh.lead_id
  LEFT JOIN Crm.users u ON u.id = mh.created_by
  WHERE mh.lead_id = p_lead_id
    AND mh.aces_id = public.current_aces_id()
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
SET search_path = public, Crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_instance text;
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT COALESCE(p_instance, instancia)
  INTO v_instance
  FROM Crm.leads
  WHERE id = p_lead_id
    AND aces_id = v_aces_id
  LIMIT 1;

  IF v_instance IS NULL THEN
    v_instance := (
      SELECT instancia
      FROM Crm.instance
      WHERE aces_id = v_aces_id
      ORDER BY instancia
      LIMIT 1
    );
  END IF;

  INSERT INTO Crm.message_history (
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
    public.current_crm_user_id(),
    now()
  );

  UPDATE Crm.leads
  SET
    last_message_at = now(),
    updated_at = now(),
    instancia = COALESCE(v_instance, instancia)
  WHERE id = p_lead_id
    AND aces_id = v_aces_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pending_invitations()
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  role text,
  invited_at timestamptz,
  expires_at timestamptz,
  days_until_expiry integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT
    ui.id,
    ui.email,
    ui.name,
    ui.role::text,
    ui.invited_at,
    ui.expires_at,
    GREATEST(0, CEIL(EXTRACT(EPOCH FROM (ui.expires_at - now())) / 86400.0))::integer AS days_until_expiry
  FROM Crm.user_invitations ui
  WHERE ui.aces_id = public.current_aces_id()
    AND ui.status = 'pending'
  ORDER BY ui.invited_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.invite_user_to_company(p_email text, p_name text, p_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_role Crm.user_role;
  v_invitation_id uuid;
BEGIN
  IF public.current_crm_role() <> 'ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apenas admins podem convidar usuarios');
  END IF;

  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Usuario CRM nao encontrado');
  END IF;

  v_role := CASE upper(COALESCE(p_role, 'NENHUM'))
    WHEN 'ADMIN' THEN 'ADMIN'::Crm.user_role
    WHEN 'VENDEDOR' THEN 'VENDEDOR'::Crm.user_role
    ELSE 'NENHUM'::Crm.user_role
  END;

  IF EXISTS (
    SELECT 1
    FROM Crm.users
    WHERE aces_id = v_aces_id
      AND lower(email) = lower(p_email)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Email ja vinculado a esta empresa');
  END IF;

  SELECT id
  INTO v_invitation_id
  FROM Crm.user_invitations
  WHERE aces_id = v_aces_id
    AND lower(email) = lower(p_email)
    AND status = 'pending'
  ORDER BY invited_at DESC
  LIMIT 1;

  IF v_invitation_id IS NULL THEN
    INSERT INTO Crm.user_invitations (email, name, role, invited_by_user_id, aces_id)
    VALUES (lower(p_email), NULLIF(p_name, ''), v_role, v_current_user_id, v_aces_id)
    RETURNING id INTO v_invitation_id;
  ELSE
    UPDATE Crm.user_invitations
    SET
      name = NULLIF(p_name, ''),
      role = v_role,
      invited_by_user_id = v_current_user_id,
      invited_at = now(),
      expires_at = now() + interval '7 days'
    WHERE id = v_invitation_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'invitation_id', v_invitation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
BEGIN
  IF public.current_crm_role() <> 'ADMIN' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Apenas admins podem cancelar convites');
  END IF;

  UPDATE Crm.user_invitations
  SET status = 'cancelled'
  WHERE id = p_invitation_id
    AND aces_id = public.current_aces_id();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Convite nao encontrado');
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_move_lead_to_stage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_lead_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_create_opportunity(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_send_message(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_user_to_company(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_invitation(uuid) TO authenticated;

-- 7. View que o frontend espera
CREATE OR REPLACE VIEW Crm.v_lead_details AS
SELECT
  l.id,
  l.name AS lead_name,
  l.email,
  l.contact_phone,
  l."Fonte" AS source,
  l.status,
  l.stage_id,
  l.created_at,
  l.updated_at,
  l.last_message_at,
  l.last_city,
  l.last_region,
  l.last_country,
  l.lead_number,
  owner_user.name AS owner_name,
  l.owner_id,
  latest_opp.value,
  latest_opp.connection_level,
  latest_opp.status::text AS opportunity_status,
  l.notes,
  l.instancia AS instance_name,
  inst.color AS instance_color,
  latest_tag.last_tag_name,
  latest_tag.last_tag_urgencia
FROM Crm.leads l
LEFT JOIN Crm.users owner_user
  ON owner_user.id = l.owner_id
LEFT JOIN Crm.instance inst
  ON inst.instancia = l.instancia
LEFT JOIN LATERAL (
  SELECT o.value, o.connection_level, o.status
  FROM Crm.opportunities o
  WHERE o.lead_id = l.id
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
  LIMIT 1
) latest_opp ON true
LEFT JOIN LATERAL (
  SELECT
    lt.tag_name AS last_tag_name,
    t.urgencia AS last_tag_urgencia
  FROM Crm.lead_tags lt
  LEFT JOIN Crm.tags t
    ON t.id = lt.tag_id
  WHERE lt.lead_id = l.id
  ORDER BY lt.created_at DESC NULLS LAST
  LIMIT 1
) latest_tag ON true;

GRANT SELECT ON Crm.v_lead_details TO authenticated;

-- 8. Bootstrap do primeiro admin e conta inicial
DO $$
DECLARE
  v_auth_user_id uuid := 'ad594438-2836-4375-b305-3a9eab27d1ed';
  v_account_id integer;
  v_email text;
  v_name text;
BEGIN
  SELECT id
  INTO v_account_id
  FROM Crm.accounts
  WHERE name = 'P-its_time'
  ORDER BY id
  LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO Crm.accounts (name, status)
    VALUES ('P-its_time', 'active')
    RETURNING id INTO v_account_id;
  END IF;

  PERFORM Crm.fn_create_default_pipeline_stages(v_account_id);

  SELECT
    email,
    COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
  INTO v_email, v_name
  FROM auth.users
  WHERE id = v_auth_user_id;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth_user_id) THEN
    INSERT INTO Crm.users (auth_user_id, email, name, role, aces_id)
    VALUES (v_auth_user_id, v_email, v_name, 'ADMIN', v_account_id)
    ON CONFLICT (auth_user_id) DO UPDATE
    SET
      email = EXCLUDED.email,
      name = COALESCE(EXCLUDED.name, Crm.users.name),
      role = 'ADMIN',
      aces_id = v_account_id,
      updated_at = now();
  END IF;
END $$;
