SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SET LOCAL idle_in_transaction_session_timeout = '2min';

-- Provision the first staff member by immutable Auth UUID. The migration aborts
-- instead of silently granting access when the configured email is ambiguous.
DO $body$
DECLARE
  v_user_count integer;
  v_all_user_count integer;
  v_auth_user_id uuid;
  v_name text;
BEGIN
  SELECT
    count(*)::integer,
    (array_agg(u.id ORDER BY u.created_at))[1],
    (array_agg(COALESCE(NULLIF(btrim(u.raw_user_meta_data->>'name'), ''), split_part(u.email, '@', 1)) ORDER BY u.created_at))[1]
  INTO v_user_count, v_auth_user_id, v_name
  FROM auth.users AS u
  WHERE lower(u.email) = 'mattsyk1@gmail.com';

  SELECT count(*)::integer INTO v_all_user_count FROM auth.users;

  -- A pristine local `supabase db reset` applies migrations before seed.sql.
  -- Only that empty bootstrap is deferred to the seed; populated databases fail closed.
  IF v_user_count = 0 AND v_all_user_count = 0 THEN
    RAISE NOTICE 'Deferring Superadmin staff provisioning until the local seed runs';
    RETURN;
  END IF;

  IF v_user_count <> 1 OR v_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'SUPERADMIN_STAFF_USER_RESOLUTION_FAILED: expected exactly one auth user for mattsyk1@gmail.com, found %',
      v_user_count;
  END IF;

  INSERT INTO costs.admin_staff (auth_user_id, nome)
  VALUES (v_auth_user_id, v_name)
  ON CONFLICT (auth_user_id) DO UPDATE
  SET nome = EXCLUDED.nome;
END;
$body$;

-- The instance name is globally unique today, but the composite key makes the
-- tenant relationship explicit and prevents an agent from ever crossing accounts.
DO $body$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'crm.instance'::regclass
      AND conname = 'instance_account_name_unique'
  ) THEN
    ALTER TABLE crm.instance
      ADD CONSTRAINT instance_account_name_unique UNIQUE (aces_id, instancia);
  END IF;

  ALTER TABLE agents.ai_agents
    DROP CONSTRAINT IF EXISTS ai_agents_instance_name_fkey;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'agents.ai_agents'::regclass
      AND conname = 'ai_agents_account_instance_fkey'
  ) THEN
    ALTER TABLE agents.ai_agents
      ADD CONSTRAINT ai_agents_account_instance_fkey
      FOREIGN KEY (aces_id, instance_name)
      REFERENCES crm.instance (aces_id, instancia)
      ON UPDATE CASCADE
      ON DELETE CASCADE;
  END IF;
END;
$body$;

-- Atomic service-only operation for moving a primary agent. It locks the agent,
-- both instance rows and every affected lead before making a decision.
CREATE OR REPLACE FUNCTION crm.service_reassign_agent_instance(
  p_agent_id uuid,
  p_aces_id integer,
  p_target_instance text,
  p_policy text DEFAULT NULL::text,
  p_requested_active boolean DEFAULT NULL::boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_agent agents.ai_agents%ROWTYPE;
  v_target_aces_id integer;
  v_occupied_agent_id uuid;
  v_affected_count integer := 0;
  v_lead_id uuid;
  v_final_active boolean;
BEGIN
  IF p_target_instance IS NULL OR btrim(p_target_instance) = '' THEN
    RETURN jsonb_build_object('success', false, 'code', 'AGENT_INSTANCE_NOT_FOUND');
  END IF;

  IF p_policy IS NOT NULL AND p_policy NOT IN ('humanize', 'deactivate') THEN
    RETURN jsonb_build_object('success', false, 'code', 'AGENT_INSTANCE_CHANGE_POLICY_INVALID');
  END IF;

  SELECT a.*
  INTO v_agent
  FROM agents.ai_agents AS a
  WHERE a.id = p_agent_id
    AND a.aces_id = p_aces_id
  FOR UPDATE;

  IF NOT FOUND OR v_agent.agent_type <> 'primary' THEN
    RETURN jsonb_build_object('success', false, 'code', 'AGENT_NOT_FOUND');
  END IF;

  IF v_agent.instance_name = btrim(p_target_instance) THEN
    RETURN jsonb_build_object(
      'success', true,
      'sourceInstance', v_agent.instance_name,
      'destinationInstance', v_agent.instance_name,
      'affectedLeadCount', 0,
      'policy', NULL,
      'agentIsActive', v_agent.is_active
    );
  END IF;

  -- Lock in deterministic name order to keep concurrent moves deadlock-safe.
  PERFORM 1
  FROM crm.instance AS i
  WHERE i.instancia IN (v_agent.instance_name, btrim(p_target_instance))
  ORDER BY i.instancia
  FOR UPDATE;

  SELECT i.aces_id
  INTO v_target_aces_id
  FROM crm.instance AS i
  WHERE i.instancia = btrim(p_target_instance);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'AGENT_INSTANCE_NOT_FOUND');
  END IF;

  IF v_target_aces_id <> p_aces_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'AGENT_INSTANCE_OUTSIDE_ACCOUNT');
  END IF;

  SELECT a.id
  INTO v_occupied_agent_id
  FROM agents.ai_agents AS a
  WHERE a.aces_id = p_aces_id
    AND a.instance_name = btrim(p_target_instance)
    AND a.agent_type = 'primary'
    AND a.id <> p_agent_id
  FOR UPDATE;

  IF v_occupied_agent_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'AGENT_INSTANCE_OCCUPIED');
  END IF;

  FOR v_lead_id IN
    SELECT l.id
    FROM crm.leads AS l
    WHERE l.aces_id = p_aces_id
      AND l.instancia = v_agent.instance_name
      AND l.interaction_mode = 'ai'
      AND COALESCE(l.view, true) IS TRUE
    FOR UPDATE
  LOOP
    v_affected_count := v_affected_count + 1;
  END LOOP;

  IF v_agent.is_active AND v_affected_count > 0 AND p_policy IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'AGENT_INSTANCE_CHANGE_REQUIRES_DECISION',
      'sourceInstance', v_agent.instance_name,
      'destinationInstance', btrim(p_target_instance),
      'affectedLeadCount', v_affected_count,
      'agentIsActive', v_agent.is_active
    );
  END IF;

  IF p_policy = 'humanize' THEN
    UPDATE crm.leads AS l
    SET interaction_mode = 'human', updated_at = now()
    WHERE l.aces_id = p_aces_id
      AND l.instancia = v_agent.instance_name
      AND l.interaction_mode = 'ai'
      AND COALESCE(l.view, true) IS TRUE;
  END IF;

  v_final_active := CASE
    WHEN p_policy = 'deactivate' THEN false
    ELSE COALESCE(p_requested_active, v_agent.is_active)
  END;

  UPDATE agents.ai_agents AS a
  SET instance_name = btrim(p_target_instance),
      is_active = v_final_active,
      updated_at = now()
  WHERE a.id = p_agent_id
    AND a.aces_id = p_aces_id;

  RETURN jsonb_build_object(
    'success', true,
    'sourceInstance', v_agent.instance_name,
    'destinationInstance', btrim(p_target_instance),
    'affectedLeadCount', v_affected_count,
    'policy', p_policy,
    'agentIsActive', v_final_active
  );
END;
$function$;

REVOKE ALL ON FUNCTION crm.service_reassign_agent_instance(uuid, integer, text, text, boolean)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.service_reassign_agent_instance(uuid, integer, text, text, boolean)
  TO service_role;

-- Qualify the pgvector operator so the function remains valid with an empty
-- search_path and clears the remote database lint error.
CREATE OR REPLACE FUNCTION crm.match_knowledge_embeddings(
  p_aces_id integer,
  p_agent_id uuid,
  query_embedding extensions.vector(768),
  match_threshold double precision,
  match_count integer
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT
    k.id,
    k.content,
    k.metadata,
    (1 - (k.embedding OPERATOR(extensions.<=>) query_embedding))::double precision AS similarity
  FROM crm.ai_knowledge_embeddings AS k
  WHERE k.aces_id = p_aces_id
    AND (k.agent_id IS NULL OR k.agent_id = p_agent_id)
    AND (1 - (k.embedding OPERATOR(extensions.<=>) query_embedding)) > match_threshold
  ORDER BY k.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count;
$function$;

NOTIFY pgrst, 'reload schema';
