-- Keep an audit copy before removing stale forwarding recipients.
CREATE TABLE IF NOT EXISTS agents.forwarding_destination_seller_quarantine (
  original_id uuid PRIMARY KEY,
  aces_id integer NOT NULL,
  forwarding_destination_id uuid NOT NULL,
  crm_user_id uuid NOT NULL,
  reason text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents.forwarding_destination_seller_quarantine ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agents.forwarding_destination_seller_quarantine
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT ON agents.forwarding_destination_seller_quarantine TO service_role;

CREATE OR REPLACE FUNCTION agents.reconcile_forwarding_destination_sellers(
  p_aces_id integer DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed integer := 0;
BEGIN
  INSERT INTO agents.forwarding_destination_seller_quarantine (
    original_id,
    aces_id,
    forwarding_destination_id,
    crm_user_id,
    reason
  )
  SELECT
    seller.id,
    seller.aces_id,
    seller.forwarding_destination_id,
    seller.crm_user_id,
    CASE
      WHEN crm_user.id IS NULL THEN 'user_missing'
      WHEN crm_user.role <> 'VENDEDOR'::crm.user_role THEN 'user_not_vendor'
      WHEN membership.id IS NULL THEN 'membership_inactive_or_missing'
      ELSE 'invalid'
    END
  FROM agents.forwarding_destination_sellers AS seller
  JOIN agents.forwarding_destinations AS destination
    ON destination.id = seller.forwarding_destination_id
   AND destination.aces_id = seller.aces_id
   AND destination.mode = 'internal_company'
  LEFT JOIN crm.users AS crm_user
    ON crm_user.id = seller.crm_user_id
   AND crm_user.aces_id = seller.aces_id
  LEFT JOIN crm.empresa_memberships AS membership
    ON membership.crm_user_id = seller.crm_user_id
   AND membership.aces_id = seller.aces_id
   AND membership.empresa_id = destination.empresa_id
   AND membership.is_active IS TRUE
  WHERE (p_aces_id IS NULL OR seller.aces_id = p_aces_id)
    AND (
      crm_user.id IS NULL
      OR crm_user.role <> 'VENDEDOR'::crm.user_role
      OR membership.id IS NULL
    )
  ON CONFLICT (original_id) DO NOTHING;

  DELETE FROM agents.forwarding_destination_sellers AS seller
  USING agents.forwarding_destinations AS destination
  WHERE destination.id = seller.forwarding_destination_id
    AND destination.aces_id = seller.aces_id
    AND destination.mode = 'internal_company'
    AND (p_aces_id IS NULL OR seller.aces_id = p_aces_id)
    AND NOT EXISTS (
      SELECT 1
      FROM crm.users AS crm_user
      JOIN crm.empresa_memberships AS membership
        ON membership.crm_user_id = crm_user.id
       AND membership.aces_id = crm_user.aces_id
       AND membership.empresa_id = destination.empresa_id
       AND membership.is_active IS TRUE
      WHERE crm_user.id = seller.crm_user_id
        AND crm_user.aces_id = seller.aces_id
        AND crm_user.role = 'VENDEDOR'::crm.user_role
    );

  GET DIAGNOSTICS v_removed = ROW_COUNT;

  UPDATE agents.agent_tools AS tool
  SET readiness = state.readiness,
      is_enabled = CASE
        WHEN state.readiness = 'ready' THEN tool.is_enabled
        ELSE false
      END,
      last_validated_at = now()
  FROM (
    SELECT
      tool_row.id,
      CASE WHEN EXISTS (
        SELECT 1
        FROM agents.forwarding_destinations AS destination
        WHERE destination.agent_tool_id = tool_row.id
          AND destination.aces_id = tool_row.aces_id
          AND destination.is_active IS TRUE
          AND (
            destination.mode <> 'internal_company'
            OR EXISTS (
              SELECT 1
              FROM agents.forwarding_destination_sellers AS seller
              JOIN crm.users AS crm_user
                ON crm_user.id = seller.crm_user_id
               AND crm_user.aces_id = seller.aces_id
               AND crm_user.role = 'VENDEDOR'::crm.user_role
              JOIN crm.empresa_memberships AS membership
                ON membership.crm_user_id = seller.crm_user_id
               AND membership.aces_id = seller.aces_id
               AND membership.empresa_id = destination.empresa_id
               AND membership.is_active IS TRUE
              WHERE seller.forwarding_destination_id = destination.id
                AND seller.aces_id = destination.aces_id
            )
          )
      ) THEN 'ready' ELSE 'needs_config' END AS readiness
    FROM agents.agent_tools AS tool_row
    WHERE tool_row.tool_key = 'forwarding'
      AND (p_aces_id IS NULL OR tool_row.aces_id = p_aces_id)
  ) AS state
  WHERE tool.id = state.id;

  RETURN v_removed;
END;
$$;

REVOKE ALL ON FUNCTION agents.reconcile_forwarding_destination_sellers(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION agents.reconcile_forwarding_destination_sellers(integer)
  TO service_role;

CREATE OR REPLACE FUNCTION agents.count_ready_forwarding_destinations(
  p_aces_id integer,
  p_agent_tool_id uuid
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT count(*)
  FROM agents.forwarding_destinations AS destination
  WHERE destination.aces_id = p_aces_id
    AND destination.agent_tool_id = p_agent_tool_id
    AND destination.is_active IS TRUE
    AND (
      destination.mode <> 'internal_company'
      OR EXISTS (
        SELECT 1
        FROM agents.forwarding_destination_sellers AS seller
        JOIN crm.users AS crm_user
          ON crm_user.id = seller.crm_user_id
         AND crm_user.aces_id = seller.aces_id
         AND crm_user.role = 'VENDEDOR'::crm.user_role
        JOIN crm.empresa_memberships AS membership
          ON membership.crm_user_id = seller.crm_user_id
         AND membership.aces_id = seller.aces_id
         AND membership.empresa_id = destination.empresa_id
         AND membership.is_active IS TRUE
        WHERE seller.forwarding_destination_id = destination.id
          AND seller.aces_id = destination.aces_id
      )
    );
$$;

REVOKE ALL ON FUNCTION agents.count_ready_forwarding_destinations(integer, uuid)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION agents.count_ready_forwarding_destinations(integer, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION agents.upsert_forwarding_destination_internal(
  p_aces_id integer,
  p_agent_id uuid,
  p_agent_tool_id uuid,
  p_destination_key text,
  p_display_name text,
  p_empresa_id uuid,
  p_seller_ids uuid[],
  p_context_instruction text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_destination agents.forwarding_destinations%ROWTYPE;
  v_seller_ids uuid[];
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM agents.agent_tools AS tool
    WHERE tool.id = p_agent_tool_id
      AND tool.agent_id = p_agent_id
      AND tool.aces_id = p_aces_id
      AND tool.tool_key = 'forwarding'
  ) THEN
    RAISE EXCEPTION 'Tool Encaminhar nao instalada' USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.empresas AS company
    WHERE company.id = p_empresa_id
      AND company.aces_id = p_aces_id
      AND company.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Empresa de destino nao encontrada ou inativa' USING ERRCODE = '23503';
  END IF;

  SELECT COALESCE(array_agg(ids.crm_user_id ORDER BY ids.crm_user_id), '{}'::uuid[])
  INTO v_seller_ids
  FROM (
    SELECT DISTINCT crm_user_id
    FROM unnest(COALESCE(p_seller_ids, '{}'::uuid[])) AS input_ids(crm_user_id)
  ) AS ids;

  IF cardinality(v_seller_ids) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um vendedor da empresa' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_seller_ids) AS input_ids(crm_user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM crm.users AS crm_user
      JOIN crm.empresa_memberships AS membership
        ON membership.crm_user_id = crm_user.id
       AND membership.aces_id = crm_user.aces_id
       AND membership.empresa_id = p_empresa_id
       AND membership.is_active IS TRUE
      WHERE crm_user.id = input_ids.crm_user_id
        AND crm_user.aces_id = p_aces_id
        AND crm_user.role = 'VENDEDOR'::crm.user_role
    )
  ) THEN
    RAISE EXCEPTION 'Todos os vendedores devem possuir papel VENDEDOR e acesso ativo a empresa'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO agents.forwarding_destinations (
    aces_id,
    agent_tool_id,
    destination_key,
    display_name,
    mode,
    target_phone,
    target_agent_id,
    empresa_id,
    context_instruction,
    is_active
  )
  VALUES (
    p_aces_id,
    p_agent_tool_id,
    lower(btrim(p_destination_key)),
    btrim(p_display_name),
    'internal_company',
    NULL,
    NULL,
    p_empresa_id,
    btrim(p_context_instruction),
    true
  )
  ON CONFLICT (agent_tool_id, destination_key)
  DO UPDATE SET
    display_name = EXCLUDED.display_name,
    mode = EXCLUDED.mode,
    target_phone = EXCLUDED.target_phone,
    target_agent_id = EXCLUDED.target_agent_id,
    empresa_id = EXCLUDED.empresa_id,
    context_instruction = EXCLUDED.context_instruction,
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING * INTO v_destination;

  DELETE FROM agents.forwarding_destination_sellers AS seller
  WHERE seller.aces_id = p_aces_id
    AND seller.forwarding_destination_id = v_destination.id
    AND NOT (seller.crm_user_id = ANY(v_seller_ids));

  INSERT INTO agents.forwarding_destination_sellers (
    aces_id,
    forwarding_destination_id,
    crm_user_id
  )
  SELECT p_aces_id, v_destination.id, input_ids.crm_user_id
  FROM unnest(v_seller_ids) AS input_ids(crm_user_id)
  ON CONFLICT (forwarding_destination_id, crm_user_id) DO NOTHING;

  RETURN jsonb_build_object(
    'destination', to_jsonb(v_destination),
    'seller_ids', to_jsonb(v_seller_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION agents.upsert_forwarding_destination_internal(integer, uuid, uuid, text, text, uuid, uuid[], text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION agents.upsert_forwarding_destination_internal(integer, uuid, uuid, text, text, uuid, uuid[], text)
  TO service_role;

-- Quarantine and remove stale links that became invalid after role/membership changes.
SELECT agents.reconcile_forwarding_destination_sellers();

NOTIFY pgrst, 'reload schema';
