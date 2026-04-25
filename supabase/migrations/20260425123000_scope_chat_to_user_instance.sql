ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES crm.users(id);

CREATE INDEX IF NOT EXISTS idx_instance_created_by
  ON crm.instance(created_by);

CREATE INDEX IF NOT EXISTS idx_instance_aces_created_by
  ON crm.instance(aces_id, created_by);

UPDATE crm.instance i
SET created_by = (
  SELECT a.created_by
  FROM crm.ai_agents a
  WHERE a.aces_id = i.aces_id
    AND a.instance_name = i.instancia
    AND a.created_by IS NOT NULL
  ORDER BY a.updated_at DESC NULLS LAST, a.created_at DESC NULLS LAST
  LIMIT 1
)
WHERE i.created_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.aces_id = i.aces_id
      AND a.instance_name = i.instancia
      AND a.created_by IS NOT NULL
  );

UPDATE crm.instance i
SET created_by = (
  SELECT l.owner_id
  FROM crm.leads l
  WHERE l.aces_id = i.aces_id
    AND l.instancia = i.instancia
    AND l.owner_id IS NOT NULL
  GROUP BY l.owner_id
  ORDER BY count(*) DESC, min(l.created_at) ASC
  LIMIT 1
)
WHERE i.created_by IS NULL
  AND EXISTS (
    SELECT 1
    FROM crm.leads l
    WHERE l.aces_id = i.aces_id
      AND l.instancia = i.instancia
      AND l.owner_id IS NOT NULL
  );

UPDATE crm.instance i
SET created_by = (
  SELECT u.id
  FROM crm.users u
  WHERE u.aces_id = i.aces_id
    AND u.role <> 'NENHUM'::crm.user_role
  ORDER BY
    CASE WHEN u.role = 'ADMIN'::crm.user_role THEN 0 ELSE 1 END,
    u.created_at ASC
  LIMIT 1
)
WHERE i.created_by IS NULL;

CREATE OR REPLACE FUNCTION crm.current_user_owns_instance(p_instance text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.instance i
    WHERE i.instancia = NULLIF(btrim(p_instance), '')
      AND i.aces_id = public.current_aces_id()
      AND i.created_by = public.current_crm_user_id()
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
  );
$$;

CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = crm, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads l
    JOIN crm.instance i
      ON i.aces_id = l.aces_id
     AND i.instancia = l.instancia
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND l.owner_id = public.current_crm_user_id()
      AND i.created_by = public.current_crm_user_id()
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
  );
$$;

DROP POLICY IF EXISTS instance_select ON crm.instance;
CREATE POLICY instance_select ON crm.instance FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
  );

DROP POLICY IF EXISTS instance_insert ON crm.instance;
CREATE POLICY instance_insert ON crm.instance FOR INSERT
  WITH CHECK (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS instance_update ON crm.instance;
CREATE POLICY instance_update ON crm.instance FOR UPDATE
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

DROP POLICY IF EXISTS instance_delete ON crm.instance;
CREATE POLICY instance_delete ON crm.instance FOR DELETE
  USING (
    aces_id = public.current_aces_id()
    AND created_by = public.current_crm_user_id()
    AND public.current_crm_role() = 'ADMIN'::crm.user_role
  );

DROP POLICY IF EXISTS msg_select ON crm.message_history;
CREATE POLICY msg_select ON crm.message_history FOR SELECT
  USING (crm.current_user_can_access_lead(message_history.lead_id));

DROP POLICY IF EXISTS msg_insert ON crm.message_history;
CREATE POLICY msg_insert ON crm.message_history FOR INSERT
  WITH CHECK (
    crm.current_user_can_access_lead(message_history.lead_id)
    AND crm.current_user_owns_instance(message_history.instance)
  );

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
  JOIN crm.instance i
    ON i.aces_id = l.aces_id
   AND i.instancia = l.instancia
  LEFT JOIN crm.users u ON u.id = mh.created_by
  WHERE mh.lead_id = p_lead_id
    AND mh.aces_id = public.current_aces_id()
    AND l.owner_id = public.current_crm_user_id()
    AND i.created_by = public.current_crm_user_id()
    AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
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

  SELECT COALESCE(NULLIF(btrim(p_instance), ''), l.instancia)
  INTO v_instance
  FROM crm.leads l
  JOIN crm.instance i
    ON i.aces_id = l.aces_id
   AND i.instancia = l.instancia
  WHERE l.id = p_lead_id
    AND l.aces_id = v_aces_id
    AND l.owner_id = v_current_user_id
    AND i.created_by = v_current_user_id
    AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para a instancia do usuario atual';
  END IF;

  IF NOT crm.current_user_owns_instance(v_instance) THEN
    RAISE EXCEPTION 'Instancia nao pertence ao usuario atual';
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
    instancia = v_instance
  WHERE id = p_lead_id
    AND aces_id = v_aces_id
    AND owner_id = v_current_user_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION crm.current_user_owns_instance(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.current_user_can_access_lead(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_send_message(uuid, text, text, text, text) TO authenticated;
