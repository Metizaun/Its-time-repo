-- Tenant and instance authorization hardening.
--
-- Authorization is account-owned. `created_by` and `owner_id` remain audit and
-- assignment data; neither field grants access by itself.

-- ---------------------------------------------------------------------------
-- 1. Resolve the current CRM identity from auth.users, not from stale JWT
--    app_metadata. These helpers are SECURITY DEFINER because crm.users itself
--    is protected by RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.current_crm_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id
  FROM crm.users AS u
  WHERE u.auth_user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_aces_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.aces_id
  FROM crm.users AS u
  WHERE u.auth_user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_crm_role()
RETURNS crm.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.role
  FROM crm.users AS u
  WHERE u.auth_user_id = (SELECT auth.uid())
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION crm.current_user_is_account_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.users AS u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.role = 'ADMIN'::crm.user_role
  );
$$;

CREATE OR REPLACE FUNCTION crm.crm_user_belongs_to_current_account(p_crm_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_crm_user_id IS NULL OR EXISTS (
    SELECT 1
    FROM crm.users AS target_user
    JOIN crm.users AS requesting_user
      ON requesting_user.auth_user_id = (SELECT auth.uid())
     AND requesting_user.aces_id = target_user.aces_id
    WHERE target_user.id = p_crm_user_id
  );
$$;

CREATE OR REPLACE FUNCTION crm.current_user_can_access_instance(
  p_instance text,
  p_required_access text DEFAULT 'viewer'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH requesting_user AS (
    SELECT u.id, u.aces_id, u.role
    FROM crm.users AS u
    WHERE u.auth_user_id = (SELECT auth.uid())
    LIMIT 1
  )
  SELECT EXISTS (
    SELECT 1
    FROM requesting_user AS cu
    JOIN crm.instance AS i
      ON i.aces_id = cu.aces_id
     AND i.instancia = NULLIF(btrim(p_instance), '')
    WHERE COALESCE(i.setup_status, 'connected') <> 'cancelled'
      AND (
        cu.role = 'ADMIN'::crm.user_role
        OR EXISTS (
          SELECT 1
          FROM crm.instance_access_memberships AS iam
          WHERE iam.aces_id = cu.aces_id
            AND iam.instance_name = i.instancia
            AND iam.crm_user_id = cu.id
            AND iam.is_active IS TRUE
            AND (
              (COALESCE(NULLIF(p_required_access, ''), 'viewer') = 'viewer'
                AND iam.access_level IN ('viewer', 'editor', 'admin'))
              OR (p_required_access = 'editor'
                AND iam.access_level IN ('editor', 'admin'))
              OR (p_required_access = 'admin'
                AND iam.access_level = 'admin')
            )
        )
      )
  );
$$;

-- Backwards-compatible name used throughout older policies and application SQL.
CREATE OR REPLACE FUNCTION crm.current_user_owns_instance(p_instance text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT crm.current_user_can_access_instance(p_instance, 'editor');
$$;

CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads AS l
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND (
        crm.current_user_is_account_admin()
        OR crm.current_user_can_access_instance(l.instancia, 'viewer')
      )
  );
$$;

CREATE OR REPLACE FUNCTION crm.current_user_can_edit_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads AS l
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND crm.current_user_can_access_instance(l.instancia, 'editor')
  );
$$;

-- Preserve access that sellers had through legacy creator/owner coupling before
-- that coupling is removed. Future access is managed only by memberships.
INSERT INTO crm.instance_access_memberships (
  aces_id,
  instance_name,
  crm_user_id,
  access_level,
  granted_by,
  grant_reason,
  is_active,
  revoked_at
)
SELECT DISTINCT
  i.aces_id,
  i.instancia,
  seller.id,
  'editor',
  account_admin.id,
  'Backfill RLS: acesso legado por criador/responsavel',
  TRUE,
  NULL::timestamptz
FROM crm.instance AS i
JOIN crm.users AS seller
  ON seller.aces_id = i.aces_id
 AND seller.role <> 'ADMIN'::crm.user_role
LEFT JOIN LATERAL (
  SELECT admin_user.id
  FROM crm.users AS admin_user
  WHERE admin_user.aces_id = i.aces_id
    AND admin_user.role = 'ADMIN'::crm.user_role
  ORDER BY admin_user.created_at, admin_user.id
  LIMIT 1
) AS account_admin ON TRUE
WHERE i.created_by = seller.id
   OR EXISTS (
     SELECT 1
     FROM crm.leads AS l
     WHERE l.aces_id = i.aces_id
       AND l.instancia = i.instancia
       AND l.owner_id = seller.id
   )
ON CONFLICT (instance_name, crm_user_id) DO UPDATE
SET
  aces_id = EXCLUDED.aces_id,
  access_level = CASE
    WHEN crm.instance_access_memberships.access_level = 'admin' THEN 'admin'
    ELSE 'editor'
  END,
  is_active = TRUE,
  revoked_at = NULL,
  grant_reason = COALESCE(
    crm.instance_access_memberships.grant_reason,
    EXCLUDED.grant_reason
  ),
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Core account, instance, lead and chat policies.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS accounts_select ON crm.accounts;
CREATE POLICY accounts_select
ON crm.accounts FOR SELECT TO authenticated
USING (id = public.current_aces_id());

DROP POLICY IF EXISTS users_select ON crm.users;
CREATE POLICY users_select
ON crm.users FOR SELECT TO authenticated
USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS users_update ON crm.users;
CREATE POLICY users_update
ON crm.users FOR UPDATE TO authenticated
USING (auth_user_id = (SELECT auth.uid()))
WITH CHECK (
  auth_user_id = (SELECT auth.uid())
  AND aces_id = public.current_aces_id()
  AND id = public.current_crm_user_id()
);

REVOKE UPDATE ON crm.users FROM authenticated;
GRANT UPDATE (name, updated_at) ON crm.users TO authenticated;

DROP POLICY IF EXISTS instance_select ON crm.instance;
DROP POLICY IF EXISTS instance_insert ON crm.instance;
DROP POLICY IF EXISTS instance_update ON crm.instance;
DROP POLICY IF EXISTS instance_delete ON crm.instance;

CREATE POLICY instance_select
ON crm.instance FOR SELECT TO authenticated
USING (crm.current_user_can_access_instance(instancia, 'viewer'));

CREATE POLICY instance_insert
ON crm.instance FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.crm_user_belongs_to_current_account(created_by)
);

CREATE POLICY instance_update
ON crm.instance FOR UPDATE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.crm_user_belongs_to_current_account(created_by)
);

CREATE POLICY instance_delete
ON crm.instance FOR DELETE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
);

ALTER TABLE crm.instance_access_memberships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instance_memberships_select ON crm.instance_access_memberships;
DROP POLICY IF EXISTS instance_memberships_insert ON crm.instance_access_memberships;
DROP POLICY IF EXISTS instance_memberships_update ON crm.instance_access_memberships;
DROP POLICY IF EXISTS instance_memberships_delete ON crm.instance_access_memberships;

CREATE POLICY instance_memberships_select
ON crm.instance_access_memberships FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR crm_user_id = public.current_crm_user_id()
  )
);

CREATE POLICY instance_memberships_insert
ON crm.instance_access_memberships FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.crm_user_belongs_to_current_account(crm_user_id)
  AND EXISTS (
    SELECT 1 FROM crm.instance AS i
    WHERE i.instancia = instance_name
      AND i.aces_id = public.current_aces_id()
  )
);

CREATE POLICY instance_memberships_update
ON crm.instance_access_memberships FOR UPDATE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.crm_user_belongs_to_current_account(crm_user_id)
  AND EXISTS (
    SELECT 1 FROM crm.instance AS i
    WHERE i.instancia = instance_name
      AND i.aces_id = public.current_aces_id()
  )
);

CREATE POLICY instance_memberships_delete
ON crm.instance_access_memberships FOR DELETE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.instance_access_memberships TO authenticated;

DROP POLICY IF EXISTS leads_select ON crm.leads;
DROP POLICY IF EXISTS leads_insert ON crm.leads;
DROP POLICY IF EXISTS leads_update ON crm.leads;
DROP POLICY IF EXISTS leads_delete ON crm.leads;

CREATE POLICY leads_select
ON crm.leads FOR SELECT TO authenticated
USING (crm.current_user_can_access_lead(id));

CREATE POLICY leads_insert
ON crm.leads FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_instance(instancia, 'editor')
  AND crm.crm_user_belongs_to_current_account(owner_id)
  AND (
    crm.current_user_is_account_admin()
    OR owner_id IS NULL
    OR owner_id = public.current_crm_user_id()
  )
);

CREATE POLICY leads_update
ON crm.leads FOR UPDATE TO authenticated
USING (crm.current_user_can_edit_lead(id))
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_instance(instancia, 'editor')
  AND crm.crm_user_belongs_to_current_account(owner_id)
);

CREATE POLICY leads_delete
ON crm.leads FOR DELETE TO authenticated
USING (crm.current_user_can_edit_lead(id));

DROP POLICY IF EXISTS msg_select ON crm.message_history;
DROP POLICY IF EXISTS msg_insert ON crm.message_history;

CREATE POLICY msg_select
ON crm.message_history FOR SELECT TO authenticated
USING (crm.current_user_can_access_lead(lead_id));

CREATE POLICY msg_insert
ON crm.message_history FOR INSERT TO authenticated
WITH CHECK (
  crm.message_history.aces_id = public.current_aces_id()
  AND crm.current_user_can_edit_lead(crm.message_history.lead_id)
  AND EXISTS (
    SELECT 1
    FROM crm.leads AS l
    WHERE l.id = crm.message_history.lead_id
      AND l.aces_id = crm.message_history.aces_id
      AND l.instancia = crm.message_history.instance
  )
);

-- Lead-linked tables use viewer access for reads and editor access for writes.
DO $policy_hardening$
DECLARE
  v_table text;
  v_old_policy text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'opportunities', 'lead_tags', 'lead_remarketing', 'follow_up_tasks', 'agendamentos'
  ]
  LOOP
    FOR v_old_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'crm' AND tablename = v_table
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON crm.%I', v_old_policy, v_table);
    END LOOP;

    EXECUTE format(
      'CREATE POLICY %I ON crm.%I FOR SELECT TO authenticated USING (crm.current_user_can_access_lead(lead_id))',
      v_table || '_select', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON crm.%I FOR INSERT TO authenticated WITH CHECK (crm.current_user_can_edit_lead(lead_id))',
      v_table || '_insert', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON crm.%I FOR UPDATE TO authenticated USING (crm.current_user_can_edit_lead(lead_id)) WITH CHECK (crm.current_user_can_edit_lead(lead_id))',
      v_table || '_update', v_table
    );
    EXECUTE format(
      'CREATE POLICY %I ON crm.%I FOR DELETE TO authenticated USING (crm.current_user_can_edit_lead(lead_id))',
      v_table || '_delete', v_table
    );
  END LOOP;
END
$policy_hardening$;

-- ---------------------------------------------------------------------------
-- 3. Account-owned configuration. Admins manage; sellers can read pipelines.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS pipelines_select ON crm.pipelines;
DROP POLICY IF EXISTS pipelines_insert ON crm.pipelines;
DROP POLICY IF EXISTS pipelines_update ON crm.pipelines;
DROP POLICY IF EXISTS pipelines_delete ON crm.pipelines;

CREATE POLICY pipelines_select ON crm.pipelines FOR SELECT TO authenticated
USING (aces_id = public.current_aces_id());
CREATE POLICY pipelines_insert ON crm.pipelines FOR INSERT TO authenticated
WITH CHECK (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());
CREATE POLICY pipelines_update ON crm.pipelines FOR UPDATE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())
WITH CHECK (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());
CREATE POLICY pipelines_delete ON crm.pipelines FOR DELETE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND is_default IS FALSE
);

DROP POLICY IF EXISTS ps_select ON crm.pipeline_stages;
DROP POLICY IF EXISTS ps_insert ON crm.pipeline_stages;
DROP POLICY IF EXISTS ps_update ON crm.pipeline_stages;
DROP POLICY IF EXISTS ps_delete ON crm.pipeline_stages;

CREATE POLICY ps_select ON crm.pipeline_stages FOR SELECT TO authenticated
USING (aces_id = public.current_aces_id());
CREATE POLICY ps_insert ON crm.pipeline_stages FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND EXISTS (
    SELECT 1 FROM crm.pipelines AS p
    WHERE p.id = pipeline_id AND p.aces_id = public.current_aces_id()
  )
);
CREATE POLICY ps_update ON crm.pipeline_stages FOR UPDATE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND EXISTS (
    SELECT 1 FROM crm.pipelines AS p
    WHERE p.id = pipeline_id AND p.aces_id = public.current_aces_id()
  )
);
CREATE POLICY ps_delete ON crm.pipeline_stages FOR DELETE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());

DROP POLICY IF EXISTS ai_agents_select ON agents.ai_agents;
DROP POLICY IF EXISTS ai_agents_insert ON agents.ai_agents;
DROP POLICY IF EXISTS ai_agents_update ON agents.ai_agents;
DROP POLICY IF EXISTS ai_agents_delete ON agents.ai_agents;

CREATE POLICY ai_agents_select ON agents.ai_agents FOR SELECT TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());
CREATE POLICY ai_agents_insert ON agents.ai_agents FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.current_user_can_access_instance(instance_name, 'admin')
  AND crm.crm_user_belongs_to_current_account(created_by)
);
CREATE POLICY ai_agents_update ON agents.ai_agents FOR UPDATE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.current_user_can_access_instance(instance_name, 'admin')
  AND crm.crm_user_belongs_to_current_account(created_by)
);
CREATE POLICY ai_agents_delete ON agents.ai_agents FOR DELETE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());

DROP POLICY IF EXISTS ai_stage_rules_select ON agents.ai_stage_rules;
DROP POLICY IF EXISTS ai_stage_rules_insert ON agents.ai_stage_rules;
DROP POLICY IF EXISTS ai_stage_rules_update ON agents.ai_stage_rules;
DROP POLICY IF EXISTS ai_stage_rules_delete ON agents.ai_stage_rules;

CREATE POLICY ai_stage_rules_select ON agents.ai_stage_rules FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM agents.ai_agents AS a
  WHERE a.id = agent_id
    AND a.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));
CREATE POLICY ai_stage_rules_insert ON agents.ai_stage_rules FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM agents.ai_agents AS a
  WHERE a.id = agent_id
    AND a.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));
CREATE POLICY ai_stage_rules_update ON agents.ai_stage_rules FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM agents.ai_agents AS a
  WHERE a.id = agent_id
    AND a.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM agents.ai_agents AS a
  WHERE a.id = agent_id
    AND a.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));
CREATE POLICY ai_stage_rules_delete ON agents.ai_stage_rules FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM agents.ai_agents AS a
  WHERE a.id = agent_id
    AND a.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));

DROP POLICY IF EXISTS automation_funnels_select ON crm.automation_funnels;
DROP POLICY IF EXISTS automation_funnels_insert ON crm.automation_funnels;
DROP POLICY IF EXISTS automation_funnels_update ON crm.automation_funnels;
DROP POLICY IF EXISTS automation_funnels_delete ON crm.automation_funnels;

CREATE POLICY automation_funnels_select ON crm.automation_funnels FOR SELECT TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());
CREATE POLICY automation_funnels_insert ON crm.automation_funnels FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.current_user_can_access_instance(instance_name, 'admin')
  AND crm.crm_user_belongs_to_current_account(created_by)
);
CREATE POLICY automation_funnels_update ON crm.automation_funnels FOR UPDATE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.current_user_can_access_instance(instance_name, 'admin')
  AND crm.crm_user_belongs_to_current_account(created_by)
);
CREATE POLICY automation_funnels_delete ON crm.automation_funnels FOR DELETE TO authenticated
USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin());

DROP POLICY IF EXISTS automation_steps_select ON crm.automation_steps;
DROP POLICY IF EXISTS automation_steps_insert ON crm.automation_steps;
DROP POLICY IF EXISTS automation_steps_update ON crm.automation_steps;
DROP POLICY IF EXISTS automation_steps_delete ON crm.automation_steps;

CREATE POLICY automation_steps_select ON crm.automation_steps FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM crm.automation_funnels AS f
  WHERE f.id = funnel_id
    AND f.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));
CREATE POLICY automation_steps_insert ON crm.automation_steps FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM crm.automation_funnels AS f
  WHERE f.id = funnel_id
    AND f.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));
CREATE POLICY automation_steps_update ON crm.automation_steps FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM crm.automation_funnels AS f
  WHERE f.id = funnel_id
    AND f.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM crm.automation_funnels AS f
  WHERE f.id = funnel_id
    AND f.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));
CREATE POLICY automation_steps_delete ON crm.automation_steps FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM crm.automation_funnels AS f
  WHERE f.id = funnel_id
    AND f.aces_id = public.current_aces_id()
    AND crm.current_user_is_account_admin()
));

-- ---------------------------------------------------------------------------
-- 4. Tables that were exposed without RLS.
-- ---------------------------------------------------------------------------

DO $internal_tables$
DECLARE
  v_relation regclass;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    to_regclass('crm.automation_funnel_dispatch_state'),
    to_regclass('crm.automation_instance_dispatch_state'),
    to_regclass('crm.consumo_historico'),
    to_regclass('crm.users_arquem'),
    to_regclass('crm.outbound_echo_registry'),
    to_regclass('public.token_usage'),
    to_regclass('rb.lead_metadata'),
    to_regclass('rb.sync_runs')
  ]
  LOOP
    IF v_relation IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_relation);
      EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, authenticator', v_relation);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO service_role', v_relation);
    END IF;
  END LOOP;
END
$internal_tables$;

ALTER TABLE crm.automation_holidays ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_holidays_read ON crm.automation_holidays;
CREATE POLICY automation_holidays_read
ON crm.automation_holidays FOR SELECT TO authenticated
USING (TRUE);
REVOKE ALL ON crm.automation_holidays FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.automation_holidays TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_holidays TO service_role;

ALTER TABLE crm.planos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planos_read_active ON crm.planos;
CREATE POLICY planos_read_active
ON crm.planos FOR SELECT TO authenticated
USING (ativo IS TRUE);
REVOKE ALL ON crm.planos FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.planos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.planos TO service_role;

ALTER TABLE crm.automation_media_assets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_media_assets_admin ON crm.automation_media_assets;
CREATE POLICY automation_media_assets_admin
ON crm.automation_media_assets FOR ALL TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.current_user_can_access_instance(instance_name, 'admin')
);
REVOKE ALL ON crm.automation_media_assets FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_media_assets TO authenticated, service_role;

-- Policies accidentally declared for PUBLIC are made authenticated-only. This
-- leaves their row predicates intact while closing the anonymous path.
DO $authenticated_policies$
DECLARE
  p record;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('crm', 'agents', 'calendar', 'meta', 'rb', 'public')
      AND roles = ARRAY['public']::name[]
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I.%I TO authenticated',
      p.policyname,
      p.schemaname,
      p.tablename
    );
  END LOOP;
END
$authenticated_policies$;

-- Future objects are private until a migration opts them into the API.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm, agents, calendar, meta, rb
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, authenticator;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm, agents, calendar, meta, rb
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm, agents, calendar, meta, rb
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, authenticator;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA crm, agents, calendar, meta, rb
  GRANT EXECUTE ON FUNCTIONS TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Calendar: admins see the account; sellers schedule within their own
--    accessible instances. Viewer memberships remain read-only.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS calendar_events_select ON calendar.events;
DROP POLICY IF EXISTS calendar_events_insert ON calendar.events;
DROP POLICY IF EXISTS calendar_events_update ON calendar.events;
DROP POLICY IF EXISTS calendar_events_delete ON calendar.events;

CREATE POLICY calendar_events_select
ON calendar.events FOR SELECT TO authenticated
USING (
  deleted_at IS NULL
  AND aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR owner_user_id = public.current_crm_user_id()
    OR (lead_id IS NOT NULL AND crm.current_user_can_access_lead(lead_id))
  )
);

CREATE POLICY calendar_events_insert
ON calendar.events FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR owner_user_id = public.current_crm_user_id()
  )
  AND (lead_id IS NULL OR crm.current_user_can_edit_lead(lead_id))
);

CREATE POLICY calendar_events_update
ON calendar.events FOR UPDATE TO authenticated
USING (
  deleted_at IS NULL
  AND aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR owner_user_id = public.current_crm_user_id()
  )
  AND (lead_id IS NULL OR crm.current_user_can_edit_lead(lead_id))
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR owner_user_id = public.current_crm_user_id()
  )
  AND (lead_id IS NULL OR crm.current_user_can_edit_lead(lead_id))
);

CREATE POLICY calendar_events_delete
ON calendar.events FOR DELETE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR owner_user_id = public.current_crm_user_id()
  )
  AND (lead_id IS NULL OR crm.current_user_can_edit_lead(lead_id))
);

-- ---------------------------------------------------------------------------
-- 6. Automation runtime ownership. A funnel applies to the account and its
--    configured instance, never only to the user who originally created it.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.funnel_owns_lead(p_funnel_id uuid, p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.automation_funnels AS f
    JOIN crm.leads AS l
      ON l.id = p_lead_id
     AND l.aces_id = f.aces_id
     AND COALESCE(l.instancia, '') = COALESCE(f.instance_name, '')
    WHERE f.id = p_funnel_id
  );
$$;

CREATE OR REPLACE FUNCTION crm.handle_entry_event(p_lead_id uuid, p_anchor_event text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_context jsonb;
  v_funnel_id uuid;
  v_total integer := 0;
  v_aces_id integer;
  v_instance_name text;
BEGIN
  v_context := crm.get_automation_context(p_lead_id);
  v_aces_id := NULLIF(v_context->>'aces_id', '')::integer;
  v_instance_name := NULLIF(v_context->>'instance_name', '');

  IF v_context IS NULL OR v_aces_id IS NULL OR v_instance_name IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_funnel_id IN
    SELECT f.id
    FROM crm.automation_funnels AS f
    WHERE f.aces_id = v_aces_id
      AND f.instance_name = v_instance_name
      AND f.is_active IS TRUE
      AND f.anchor_event = p_anchor_event
  LOOP
    v_total := v_total + crm.start_or_refresh_enrollment(v_funnel_id, p_lead_id, v_context);
  END LOOP;

  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION crm.schedule_enrollment_executions(p_enrollment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer := 0;
  v_next record;
  v_scheduled_at timestamptz;
BEGIN
  SELECT * INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND OR v_enrollment.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id
    AND aces_id = v_enrollment.aces_id
    AND is_active IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads
  WHERE id = v_enrollment.lead_id
    AND aces_id = v_enrollment.aces_id
  LIMIT 1;

  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) IS FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.automation_executions AS ae
    WHERE ae.enrollment_id = v_enrollment.id
      AND ae.status IN ('pending', 'processing')
  ) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_next
  FROM crm.find_next_enrollment_step(v_enrollment.id)
  LIMIT 1;

  IF NOT FOUND OR v_next.step_id IS NULL OR COALESCE(v_next.is_active, TRUE) IS FALSE THEN
    RETURN 0;
  END IF;

  v_scheduled_at := v_enrollment.anchor_at + make_interval(mins => v_next.delay_minutes);

  IF COALESCE(v_funnel.daily_dispatch_enabled, FALSE) IS TRUE
     AND v_funnel.daily_dispatch_time IS NOT NULL THEN
    v_scheduled_at := crm.resolve_daily_automation_dispatch_at(
      v_scheduled_at,
      v_funnel.daily_dispatch_time,
      'America/Sao_Paulo',
      COALESCE(v_funnel.daily_dispatch_weekends_enabled, FALSE)
    );

    IF v_scheduled_at IS NULL THEN
      RETURN 0;
    END IF;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id,
    funnel_id,
    step_id,
    enrollment_id,
    lead_id,
    source_stage_id,
    scheduled_at,
    phone_snapshot,
    instance_snapshot,
    lead_name_snapshot,
    city_snapshot,
    status_snapshot,
    funnel_name_snapshot,
    step_label_snapshot,
    step_rule_snapshot,
    anchor_at_snapshot
  )
  VALUES (
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    v_next.step_id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_scheduled_at,
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    v_next.label,
    v_next.step_rule,
    v_enrollment.anchor_at
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_sync_automation_funnel_v2(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_cancelled integer := 0;
  v_scheduled integer := 0;
  v_lead_id uuid;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas ADMIN pode sincronizar automacoes';
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  IF COALESCE(v_funnel.is_active, TRUE) IS FALSE THEN
    v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

    FOR v_enrollment IN
      SELECT *
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND status = 'active'
    LOOP
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'cancelled',
        'Automacao desativada',
        FALSE
      );
    END LOOP;

    RETURN jsonb_build_object('success', TRUE, 'cancelled', v_cancelled, 'scheduled', 0);
  END IF;

  FOR v_enrollment IN
    SELECT e.*
    FROM crm.automation_enrollments AS e
    JOIN crm.leads AS l ON l.id = e.lead_id
    WHERE e.funnel_id = v_funnel.id
      AND e.status = 'active'
      AND l.aces_id = v_funnel.aces_id
      AND COALESCE(l.instancia, '') = COALESCE(v_funnel.instance_name, '')
  LOOP
    v_context := crm.get_automation_context(v_enrollment.lead_id);

    IF v_context IS NULL THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead nao encontrado na sincronizacao', FALSE
      );
      CONTINUE;
    END IF;

    IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead saiu da instancia da jornada', FALSE
      );
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(
      v_funnel.entry_rule, v_context, v_enrollment.anchor_at
    );
    v_exit_result := crm.evaluate_automation_rule_node(
      v_funnel.exit_rule, v_context, v_enrollment.anchor_at
    );

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) IS FALSE THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Regra de entrada nao bate mais', FALSE
      );
      CONTINUE;
    END IF;

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) IS TRUE THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'completed', 'Regra de saida ja atendida', TRUE
      );
      CONTINUE;
    END IF;

    v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment.id);
  END LOOP;

  FOR v_lead_id IN
    SELECT l.id
    FROM crm.leads AS l
    WHERE l.aces_id = v_funnel.aces_id
      AND COALESCE(l.view, TRUE) IS TRUE
      AND COALESCE(l.instancia, '') = COALESCE(v_funnel.instance_name, '')
  LOOP
    v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(v_funnel.id, v_lead_id);
  END LOOP;

  RETURN jsonb_build_object('success', TRUE, 'cancelled', v_cancelled, 'scheduled', v_scheduled);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_preview_automation_rule(p_funnel_id uuid, p_lead_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_context jsonb;
  v_anchor jsonb;
  v_anchor_at timestamptz;
  v_steps jsonb := '[]'::jsonb;
  v_step crm.automation_steps%ROWTYPE;
  v_step_rule_result jsonb;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas ADMIN pode visualizar o preview das automacoes';
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  IF NOT crm.current_user_can_access_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado para a conta atual';
  END IF;

  v_context := crm.get_automation_context(p_lead_id);
  IF v_context IS NULL
     OR NULLIF(v_context->>'aces_id', '')::integer IS DISTINCT FROM v_funnel.aces_id
     OR COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
    RAISE EXCEPTION 'Lead nao pertence a esta automacao';
  END IF;

  v_anchor := crm.get_anchor_details_from_context(v_context, v_funnel.anchor_event);
  v_anchor_at := NULLIF(v_anchor->>'anchor_at', '')::timestamptz;

  FOR v_step IN
    SELECT *
    FROM crm.automation_steps
    WHERE funnel_id = v_funnel.id
      AND is_active IS TRUE
    ORDER BY position, created_at
  LOOP
    v_step_rule_result := CASE
      WHEN v_step.step_rule IS NULL THEN NULL
      ELSE crm.evaluate_automation_rule_node(v_step.step_rule, v_context, v_anchor_at)
    END;

    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'id', v_step.id,
      'label', v_step.label,
      'delay_minutes', v_step.delay_minutes,
      'scheduled_at', CASE
        WHEN v_anchor_at IS NULL THEN NULL
        ELSE v_anchor_at + make_interval(mins => v_step.delay_minutes)
      END,
      'rule', v_step_rule_result
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'lead_id', p_lead_id,
    'funnel_id', v_funnel.id,
    'anchor_event', v_funnel.anchor_event,
    'anchor_at', v_anchor_at,
    'reply_target_stage_id', v_funnel.reply_target_stage_id,
    'entry_rule', crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_anchor_at),
    'exit_rule', crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_anchor_at),
    'steps', v_steps
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_get_automation_message_flow(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_result jsonb;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas ADMIN pode consultar o fluxo da automacao';
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  WITH active_enrollments AS (
    SELECT e.id, e.lead_id
    FROM crm.automation_enrollments AS e
    JOIN crm.leads AS l ON l.id = e.lead_id
    WHERE e.funnel_id = v_funnel.id
      AND e.status = 'active'
      AND l.aces_id = v_funnel.aces_id
      AND COALESCE(l.instancia, '') = COALESCE(v_funnel.instance_name, '')
  ),
  next_steps AS (
    SELECT e.lead_id, ns.step_id::text AS step_id
    FROM active_enrollments AS e
    LEFT JOIN LATERAL crm.find_next_enrollment_step(e.id) AS ns ON TRUE
  ),
  counts AS (
    SELECT step_id, count(*)::integer AS lead_count
    FROM next_steps
    WHERE step_id IS NOT NULL
    GROUP BY step_id
  ),
  max_count AS (
    SELECT max(lead_count) AS value FROM counts
  )
  SELECT jsonb_build_object(
    'step_counts', COALESCE((SELECT jsonb_object_agg(step_id, lead_count) FROM counts), '{}'::jsonb),
    'parked_count', COALESCE((SELECT count(*)::integer FROM next_steps WHERE step_id IS NULL), 0),
    'highlighted_step_ids', COALESCE((
      SELECT jsonb_agg(c.step_id ORDER BY c.step_id)
      FROM counts AS c
      CROSS JOIN max_count AS m
      WHERE m.value IS NOT NULL AND m.value > 0 AND c.lead_count = m.value
    ), '[]'::jsonb),
    'active_leads_count', COALESCE((SELECT count(*)::integer FROM active_enrollments), 0)
  ) INTO v_result;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. User-facing lead RPCs. SECURITY DEFINER functions must repeat the same
--    authorization checks because they bypass table RLS.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.rpc_create_lead(
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
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_instance text := NULLIF(btrim(COALESCE(p_instance, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_phone text := NULLIF(btrim(COALESCE(p_contact_phone, '')), '');
  v_stage crm.pipeline_stages%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_deleted_lead crm.leads%ROWTYPE;
  v_existing_opportunity_id uuid;
  v_opportunity_status crm.lead_status;
  v_restored boolean := FALSE;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Nome do lead e obrigatorio';
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'Telefone do lead e obrigatorio';
  END IF;
  IF v_instance IS NULL OR NOT crm.current_user_can_access_instance(v_instance, 'editor') THEN
    RAISE EXCEPTION 'Instancia nao autorizada para o usuario atual';
  END IF;

  IF p_stage_id IS NOT NULL THEN
    SELECT * INTO v_stage
    FROM crm.pipeline_stages
    WHERE id = p_stage_id
      AND aces_id = v_aces_id
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa nao encontrada para a conta atual';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM crm.leads
    WHERE aces_id = v_aces_id
      AND contact_phone = v_phone
      AND COALESCE(view, TRUE) IS TRUE
  ) THEN
    RAISE EXCEPTION 'Ja existe um lead ativo com este telefone na conta';
  END IF;

  SELECT * INTO v_deleted_lead
  FROM crm.leads
  WHERE aces_id = v_aces_id
    AND contact_phone = v_phone
    AND instancia = v_instance
    AND COALESCE(view, TRUE) IS FALSE
  ORDER BY updated_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE crm.leads
    SET
      owner_id = v_current_user_id,
      name = v_name,
      contact_phone = v_phone,
      email = NULLIF(btrim(COALESCE(p_email, '')), ''),
      "Fonte" = NULLIF(btrim(COALESCE(p_source, '')), ''),
      last_city = NULLIF(btrim(COALESCE(p_last_city, '')), ''),
      notes = NULLIF(btrim(COALESCE(p_notes, '')), ''),
      stage_id = p_stage_id,
      status = CASE
        WHEN p_stage_id IS NULL THEN status
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END,
      instancia = v_instance,
      view = TRUE,
      updated_at = now()
    WHERE id = v_deleted_lead.id
    RETURNING * INTO v_lead;
    v_restored := TRUE;
  ELSE
    INSERT INTO crm.leads (
      aces_id, owner_id, name, contact_phone, email, "Fonte", last_city,
      notes, stage_id, status, instancia, view
    )
    VALUES (
      v_aces_id,
      v_current_user_id,
      v_name,
      v_phone,
      NULLIF(btrim(COALESCE(p_email, '')), ''),
      NULLIF(btrim(COALESCE(p_source, '')), ''),
      NULLIF(btrim(COALESCE(p_last_city, '')), ''),
      NULLIF(btrim(COALESCE(p_notes, '')), ''),
      p_stage_id,
      CASE
        WHEN p_stage_id IS NULL THEN 'Novo'
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END,
      v_instance,
      TRUE
    )
    RETURNING * INTO v_lead;
  END IF;

  IF p_value IS NOT NULL OR NULLIF(btrim(COALESCE(p_connection_level, '')), '') IS NOT NULL THEN
    v_opportunity_status := CASE
      WHEN lower(COALESCE(v_lead.status, '')) IN ('ganho', 'fechado', 'sucesso', 'vendido')
        THEN 'Fechado'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) IN ('perdido', 'cancelado', 'cancelada')
        THEN 'Perdido'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) = 'remarketing'
        THEN 'Remarketing'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) IN ('atendimento', 'em atendimento')
        THEN 'Atendimento'::crm.lead_status
      WHEN lower(COALESCE(v_lead.status, '')) IN ('orcamento', 'orçamento')
        THEN 'Orçamento'::crm.lead_status
      ELSE 'Novo'::crm.lead_status
    END;

    SELECT id INTO v_existing_opportunity_id
    FROM crm.opportunities
    WHERE lead_id = v_lead.id AND aces_id = v_aces_id
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_opportunity_id IS NULL THEN
      INSERT INTO crm.opportunities (
        lead_id, aces_id, status, value, connection_level, responsible_id
      ) VALUES (
        v_lead.id, v_aces_id, v_opportunity_status, p_value,
        NULLIF(btrim(COALESCE(p_connection_level, '')), ''), v_current_user_id
      );
    ELSE
      UPDATE crm.opportunities
      SET
        status = v_opportunity_status,
        value = p_value,
        connection_level = NULLIF(btrim(COALESCE(p_connection_level, '')), ''),
        responsible_id = COALESCE(responsible_id, v_current_user_id),
        updated_at = now()
      WHERE id = v_existing_opportunity_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'lead_id', v_lead.id,
    'owner_id', v_lead.owner_id,
    'status', v_lead.status,
    'stage_id', v_lead.stage_id,
    'opportunity_created', p_value IS NOT NULL OR NULLIF(btrim(COALESCE(p_connection_level, '')), '') IS NOT NULL,
    'restored_deleted_lead', v_restored,
    'message', CASE WHEN v_restored THEN 'Lead restaurado da lixeira com sucesso' ELSE 'Lead criado com sucesso' END
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_move_lead_to_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage crm.pipeline_stages%ROWTYPE;
BEGIN
  IF NOT crm.current_user_can_edit_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado ou sem permissao de edicao';
  END IF;

  SELECT * INTO v_stage
  FROM crm.pipeline_stages
  WHERE id = p_stage_id
    AND aces_id = public.current_aces_id()
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
    AND aces_id = public.current_aces_id();

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_update_lead_status(p_lead_id uuid, p_status text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_stage_id uuid;
BEGIN
  IF NOT crm.current_user_can_edit_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado ou sem permissao de edicao';
  END IF;

  SELECT id INTO v_stage_id
  FROM crm.pipeline_stages
  WHERE aces_id = public.current_aces_id()
    AND (
      (lower(p_status) IN ('fechado', 'ganho', 'sucesso', 'vendido') AND category = 'Ganho')
      OR (lower(p_status) IN ('perdido', 'cancelado', 'cancelada') AND category = 'Perdido')
      OR (category = 'Aberto' AND lower(name) = lower(p_status))
    )
  ORDER BY position
  LIMIT 1;

  UPDATE crm.leads
  SET
    status = CASE WHEN lower(p_status) IN ('ganho', 'sucesso', 'vendido') THEN 'Fechado' ELSE p_status END,
    stage_id = COALESCE(v_stage_id, stage_id),
    updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = public.current_aces_id();

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_create_opportunity(
  p_lead_id uuid,
  p_value numeric,
  p_connection_level text,
  p_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status crm.lead_status;
  v_existing_id uuid;
BEGIN
  IF NOT crm.current_user_can_edit_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado ou sem permissao de edicao';
  END IF;

  v_status := CASE
    WHEN lower(COALESCE(p_status, '')) IN ('ganho', 'fechado', 'sucesso', 'vendido') THEN 'Fechado'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('perdido', 'cancelado', 'cancelada') THEN 'Perdido'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) = 'remarketing' THEN 'Remarketing'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('atendimento', 'em atendimento') THEN 'Atendimento'::crm.lead_status
    WHEN lower(COALESCE(p_status, '')) IN ('orcamento', 'orçamento') THEN 'Orçamento'::crm.lead_status
    ELSE 'Novo'::crm.lead_status
  END;

  SELECT id INTO v_existing_id
  FROM crm.opportunities
  WHERE lead_id = p_lead_id
    AND aces_id = public.current_aces_id()
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_existing_id IS NULL THEN
    INSERT INTO crm.opportunities (
      lead_id, aces_id, status, value, connection_level, responsible_id
    ) VALUES (
      p_lead_id, public.current_aces_id(), v_status, p_value,
      p_connection_level, public.current_crm_user_id()
    );
  ELSE
    UPDATE crm.opportunities
    SET
      status = v_status,
      value = p_value,
      connection_level = p_connection_level,
      responsible_id = COALESCE(responsible_id, public.current_crm_user_id()),
      updated_at = now()
    WHERE id = v_existing_id;
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_get_chat(p_lead_id uuid)
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
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    mh.id,
    mh.lead_id,
    mh.content,
    mh.direction::text,
    CASE WHEN lower(mh.direction) = 'outbound' THEN 2 ELSE 1 END,
    mh.sent_at,
    l.name::text,
    u.name::text
  FROM crm.message_history AS mh
  JOIN crm.leads AS l ON l.id = mh.lead_id
  LEFT JOIN crm.users AS u ON u.id = mh.created_by
  WHERE mh.lead_id = p_lead_id
    AND mh.aces_id = public.current_aces_id()
    AND crm.current_user_can_access_lead(p_lead_id)
  ORDER BY mh.sent_at, mh.id;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_send_message(
  p_lead_id uuid,
  p_content text,
  p_direction text,
  p_conversation_id text DEFAULT NULL,
  p_instance text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_instance text;
BEGIN
  IF v_aces_id IS NULL OR v_current_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;
  IF NOT crm.current_user_can_edit_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado ou sem permissao de edicao';
  END IF;

  SELECT l.instancia INTO v_instance
  FROM crm.leads AS l
  WHERE l.id = p_lead_id
    AND l.aces_id = v_aces_id
  LIMIT 1;

  IF NULLIF(btrim(COALESCE(p_instance, '')), '') IS NOT NULL
     AND NULLIF(btrim(p_instance), '') IS DISTINCT FROM v_instance THEN
    RAISE EXCEPTION 'A instancia informada nao corresponde ao lead';
  END IF;

  INSERT INTO crm.message_history (
    lead_id, aces_id, content, direction, conversation_id, instance,
    created_by, sent_at, source_type
  ) VALUES (
    p_lead_id,
    v_aces_id,
    p_content,
    COALESCE(NULLIF(p_direction, ''), 'outbound'),
    p_conversation_id,
    v_instance,
    v_current_user_id,
    now(),
    'human'
  );

  UPDATE crm.leads
  SET last_message_at = now(), updated_at = now()
  WHERE id = p_lead_id AND aces_id = v_aces_id;

  RETURN jsonb_build_object('success', TRUE);
END;
$$;

-- Pipeline bootstrap accepts service jobs and the matching account admin only.
CREATE OR REPLACE FUNCTION crm.ensure_default_pipeline(p_aces_id integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_pipeline_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND session_user <> 'postgres'
     AND NOT (
       crm.current_user_is_account_admin()
       AND p_aces_id = public.current_aces_id()
     ) THEN
    RAISE EXCEPTION 'Conta nao autorizada para criar pipeline padrao';
  END IF;

  SELECT id INTO v_pipeline_id
  FROM crm.pipelines
  WHERE aces_id = p_aces_id AND is_default IS TRUE
  LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  INSERT INTO crm.pipelines (
    aces_id, name, description, classifier_key, is_default, is_active
  ) VALUES (
    p_aces_id,
    'Pipeline principal',
    'Pipeline padrao migrado automaticamente para preservar o funil atual.',
    'crm_pipeline_classifier',
    TRUE,
    TRUE
  )
  ON CONFLICT (aces_id, name) DO UPDATE
  SET is_default = TRUE, is_active = TRUE, updated_at = now()
  RETURNING id INTO v_pipeline_id;

  RETURN v_pipeline_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Function execution grants. Postgres grants EXECUTE to PUBLIC by default;
--    exposed schemas use an explicit allow-list instead.
-- ---------------------------------------------------------------------------

DO $revoke_function_defaults$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('crm', 'agents', 'calendar', 'meta', 'rb')
      AND p.prokind = 'f'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, authenticator',
      f.signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      f.signature
    );
  END LOOP;
END
$revoke_function_defaults$;

DO $grant_authenticated_functions$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'crm'
      AND p.prokind = 'f'
      AND p.proname = ANY (ARRAY[
        'current_user_is_account_admin',
        'crm_user_belongs_to_current_account',
        'current_user_can_access_instance',
        'current_user_owns_instance',
        'current_user_can_access_lead',
        'current_user_can_edit_lead',
        'get_pending_invitations',
        'invite_user_to_company',
        'cancel_invitation',
        'rpc_create_lead',
        'rpc_update_lead_status',
        'rpc_move_lead_to_stage',
        'rpc_create_opportunity',
        'rpc_get_chat',
        'rpc_send_message',
        'rpc_preview_automation_rule',
        'rpc_get_automation_message_flow',
        'rpc_sync_automation_funnel',
        'rpc_sync_automation_funnel_v2',
        'rpc_get_chat_unread_counts',
        'rpc_mark_chat_read',
        'rpc_dashboard_operational_metrics',
        'rpc_list_notifications',
        'rpc_mark_notification_read',
        'rpc_get_notification_unread_counts',
        'rpc_mark_all_notifications_read'
      ])
  LOOP
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated',
      f.signature
    );
  END LOOP;
END
$grant_authenticated_functions$;

DO $close_public_security_definers$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosecdef IS TRUE
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, authenticator',
      f.signature
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END
$close_public_security_definers$;

REVOKE ALL ON FUNCTION public.current_crm_user_id() FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION public.current_aces_id() FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION public.current_crm_role() FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION public.current_crm_user_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_aces_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_crm_role() TO authenticated, service_role;

-- Legacy public RPC aliases are no longer an authenticated API surface. The
-- CRM schema versions above are the supported entry points.
DO $close_legacy_public_rpcs$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (ARRAY[
        'rpc_create_lead', 'rpc_update_lead_status', 'rpc_move_lead_to_stage',
        'rpc_create_opportunity', 'rpc_get_chat', 'rpc_send_message'
      ])
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, authenticator',
      f.signature
    );
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.signature);
  END LOOP;
END
$close_legacy_public_rpcs$;

REVOKE ALL ON FUNCTION crm.ensure_default_pipeline(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.ensure_default_pipeline(integer) TO service_role;

REVOKE ALL ON FUNCTION crm.fn_create_default_pipeline_stages(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.fn_create_default_pipeline_stages(integer) TO service_role;
