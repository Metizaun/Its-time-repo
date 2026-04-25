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
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND i.created_by = public.current_crm_user_id()
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
      AND COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND i.created_by = public.current_crm_user_id()
  );
$$;

DROP POLICY IF EXISTS instance_select ON crm.instance;
CREATE POLICY instance_select ON crm.instance FOR SELECT
  USING (
    aces_id = public.current_aces_id()
    AND COALESCE(setup_status, 'connected') <> 'cancelled'
    AND created_by = public.current_crm_user_id()
  );

DO $$
DECLARE
  v_lucas_id uuid;
  v_guilherme_id uuid;
  v_juan_id uuid;
BEGIN
  SELECT id
  INTO v_lucas_id
  FROM crm.users
  WHERE aces_id = 1
    AND lower(btrim(COALESCE(name, ''))) = 'lucas'
  ORDER BY created_at
  LIMIT 1;

  SELECT id
  INTO v_guilherme_id
  FROM crm.users
  WHERE aces_id = 1
    AND lower(btrim(COALESCE(name, ''))) = 'guilherme'
  ORDER BY created_at
  LIMIT 1;

  SELECT id
  INTO v_juan_id
  FROM crm.users
  WHERE aces_id = 1
    AND lower(btrim(COALESCE(name, ''))) = 'juan'
  ORDER BY created_at
  LIMIT 1;

  IF v_lucas_id IS NULL OR v_guilherme_id IS NULL OR v_juan_id IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel resolver os usuarios Lucas/Guilherme/Juan da conta 1 para reparar as instancias';
  END IF;

  UPDATE crm.instance
  SET created_by = CASE
    WHEN lower(instancia) = 'lucas' THEN v_lucas_id
    WHEN lower(instancia) = 'prospect' THEN v_guilherme_id
    WHEN lower(instancia) = 'juan' THEN v_juan_id
    ELSE created_by
  END
  WHERE aces_id = 1
    AND lower(instancia) IN ('lucas', 'prospect', 'juan');

  UPDATE crm.leads
  SET
    owner_id = CASE
      WHEN lower(instancia) = 'lucas' THEN v_lucas_id
      WHEN lower(instancia) = 'prospect' THEN v_guilherme_id
      WHEN lower(instancia) = 'juan' THEN v_juan_id
      ELSE owner_id
    END,
    updated_at = now()
  WHERE aces_id = 1
    AND COALESCE(view, true) = true
    AND lower(COALESCE(instancia, '')) IN ('lucas', 'prospect', 'juan');

  UPDATE crm.opportunities o
  SET
    responsible_id = CASE
      WHEN lower(l.instancia) = 'lucas' THEN v_lucas_id
      WHEN lower(l.instancia) = 'prospect' THEN v_guilherme_id
      WHEN lower(l.instancia) = 'juan' THEN v_juan_id
      ELSE o.responsible_id
    END,
    updated_at = now()
  FROM crm.leads l
  WHERE o.lead_id = l.id
    AND o.aces_id = 1
    AND l.aces_id = 1
    AND COALESCE(l.view, true) = true
    AND lower(COALESCE(l.instancia, '')) IN ('lucas', 'prospect', 'juan');
END;
$$;
