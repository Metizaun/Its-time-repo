-- Chat read state, product notifications, realtime publication and Audio IA rollout.

CREATE TABLE IF NOT EXISTS crm.chat_read_states (
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crm_user_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_read_states_lead
  ON crm.chat_read_states(lead_id, crm_user_id);

ALTER TABLE crm.chat_read_states ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_read_states_select_own ON crm.chat_read_states;
CREATE POLICY chat_read_states_select_own ON crm.chat_read_states
FOR SELECT TO authenticated
USING (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

DROP POLICY IF EXISTS chat_read_states_insert_own ON crm.chat_read_states;
CREATE POLICY chat_read_states_insert_own ON crm.chat_read_states
FOR INSERT TO authenticated
WITH CHECK (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

DROP POLICY IF EXISTS chat_read_states_update_own ON crm.chat_read_states;
CREATE POLICY chat_read_states_update_own ON crm.chat_read_states
FOR UPDATE TO authenticated
USING (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
)
WITH CHECK (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

GRANT SELECT, INSERT, UPDATE ON crm.chat_read_states TO authenticated;
REVOKE ALL ON crm.chat_read_states FROM anon;

CREATE OR REPLACE FUNCTION crm.rpc_get_chat_unread_counts()
RETURNS TABLE(lead_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO crm, public
AS $$
  SELECT
    mh.lead_id,
    count(*)::bigint AS unread_count
  FROM crm.message_history mh
  LEFT JOIN crm.chat_read_states rs
    ON rs.lead_id = mh.lead_id
   AND rs.crm_user_id = public.current_crm_user_id()
  WHERE mh.aces_id = public.current_aces_id()
    AND crm.current_user_can_access_lead(mh.lead_id)
    AND lower(mh.direction) IN ('in', 'inbound')
    AND mh.sent_at > GREATEST(
      COALESCE(rs.last_read_at, '-infinity'::timestamptz),
      timestamptz '2026-07-14 00:00:00-03'
    )
  GROUP BY mh.lead_id;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_chat_read(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO crm, public
AS $$
BEGIN
  IF NOT crm.current_user_can_access_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Conversa indisponivel';
  END IF;

  INSERT INTO crm.chat_read_states (crm_user_id, aces_id, lead_id, last_read_at)
  VALUES (public.current_crm_user_id(), public.current_aces_id(), p_lead_id, now())
  ON CONFLICT (crm_user_id, lead_id) DO UPDATE
  SET last_read_at = GREATEST(crm.chat_read_states.last_read_at, EXCLUDED.last_read_at),
      updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_get_chat_unread_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_chat_read(uuid) TO authenticated;
REVOKE ALL ON FUNCTION crm.rpc_get_chat_unread_counts() FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_mark_chat_read(uuid) FROM anon;

CREATE TABLE IF NOT EXISTS crm.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer REFERENCES crm.accounts(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('internal', 'notice')),
  event_type text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  lead_id uuid REFERENCES crm.leads(id) ON DELETE CASCADE,
  action_path text,
  published_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_feed
  ON crm.notifications(category, published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_account
  ON crm.notifications(aces_id, published_at DESC);

CREATE TABLE IF NOT EXISTS crm.notification_reads (
  notification_id uuid NOT NULL REFERENCES crm.notifications(id) ON DELETE CASCADE,
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, crm_user_id)
);

ALTER TABLE crm.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.notification_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_read_accessible ON crm.notifications;
CREATE POLICY notifications_read_accessible ON crm.notifications
FOR SELECT TO authenticated
USING (
  published_at <= now()
  AND (
    (category = 'notice' AND (aces_id IS NULL OR aces_id = public.current_aces_id()))
    OR (
      category = 'internal'
      AND aces_id = public.current_aces_id()
      AND lead_id IS NOT NULL
      AND crm.current_user_can_access_lead(lead_id)
    )
  )
);

DROP POLICY IF EXISTS notification_reads_select_own ON crm.notification_reads;
CREATE POLICY notification_reads_select_own ON crm.notification_reads
FOR SELECT TO authenticated
USING (crm_user_id = public.current_crm_user_id());

DROP POLICY IF EXISTS notification_reads_insert_own ON crm.notification_reads;
CREATE POLICY notification_reads_insert_own ON crm.notification_reads
FOR INSERT TO authenticated
WITH CHECK (
  crm_user_id = public.current_crm_user_id()
  AND EXISTS (
    SELECT 1 FROM crm.notifications n
    WHERE n.id = notification_id
  )
);

GRANT SELECT ON crm.notifications, crm.notification_reads TO authenticated;
GRANT INSERT ON crm.notification_reads TO authenticated;
REVOKE ALL ON crm.notifications, crm.notification_reads FROM anon;

CREATE OR REPLACE FUNCTION crm.rpc_list_notifications(
  p_category text,
  p_limit integer DEFAULT 20,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE(
  notification_id uuid,
  title text,
  description text,
  published_at timestamptz,
  is_read boolean,
  action_path text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO crm, public
AS $$
  SELECT
    n.id,
    n.title,
    n.description,
    n.published_at,
    (nr.notification_id IS NOT NULL) AS is_read,
    n.action_path
  FROM crm.notifications n
  LEFT JOIN crm.notification_reads nr
    ON nr.notification_id = n.id
   AND nr.crm_user_id = public.current_crm_user_id()
  WHERE n.category = p_category
    AND (p_before IS NULL OR n.published_at < p_before)
  ORDER BY n.published_at DESC, n.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_notification_read(p_notification_id uuid)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO crm, public
AS $$
  INSERT INTO crm.notification_reads(notification_id, crm_user_id, read_at)
  SELECT n.id, public.current_crm_user_id(), now()
  FROM crm.notifications n
  WHERE n.id = p_notification_id
  ON CONFLICT (notification_id, crm_user_id) DO UPDATE SET read_at = EXCLUDED.read_at;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_get_notification_unread_counts()
RETURNS TABLE(internal_count bigint, notice_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO crm, public
AS $$
  SELECT
    count(*) FILTER (WHERE n.category = 'internal')::bigint,
    count(*) FILTER (WHERE n.category = 'notice')::bigint
  FROM crm.notifications n
  LEFT JOIN crm.notification_reads nr
    ON nr.notification_id = n.id
   AND nr.crm_user_id = public.current_crm_user_id()
  WHERE nr.notification_id IS NULL;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_all_notifications_read(p_category text)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path TO crm, public
AS $$
  INSERT INTO crm.notification_reads(notification_id, crm_user_id, read_at)
  SELECT n.id, public.current_crm_user_id(), now()
  FROM crm.notifications n
  WHERE n.category = p_category
  ON CONFLICT (notification_id, crm_user_id) DO UPDATE SET read_at = EXCLUDED.read_at;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_list_notifications(text, integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_get_notification_unread_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_notification_read(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_all_notifications_read(text) TO authenticated;

CREATE OR REPLACE FUNCTION crm.create_operational_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO crm, public
AS $$
DECLARE
  v_stage_name text;
  v_stage_category text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO crm.notifications (
      aces_id, category, event_type, title, description, lead_id, action_path, idempotency_key
    ) VALUES (
      NEW.aces_id, 'internal', 'lead_created', 'Novo lead recebido',
      'Uma nova conversa entrou na sua carteira.', NEW.id,
      '/chat?leadId=' || NEW.id::text, 'lead_created:' || NEW.id::text
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    RETURN NEW;
  END IF;

  IF NEW.interaction_mode = 'human' AND OLD.interaction_mode IS DISTINCT FROM 'human' THEN
    INSERT INTO crm.notifications (
      aces_id, category, event_type, title, description, lead_id, action_path, idempotency_key
    ) VALUES (
      NEW.aces_id, 'internal', 'human_handoff', 'Atendimento humano solicitado',
      'A IA transferiu uma conversa para sua equipe.', NEW.id,
      '/chat?leadId=' || NEW.id::text,
      'human_handoff:' || NEW.id::text || ':' || txid_current()::text
    ) ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id AND NEW.stage_id IS NOT NULL THEN
    SELECT name, category INTO v_stage_name, v_stage_category
    FROM crm.pipeline_stages
    WHERE id = NEW.stage_id AND aces_id = NEW.aces_id;

    IF v_stage_category IN ('Ganho', 'Perdido') THEN
      INSERT INTO crm.notifications (
        aces_id, category, event_type, title, description, lead_id, action_path, idempotency_key
      ) VALUES (
        NEW.aces_id, 'internal', 'pipeline_finished', 'Conversa finalizada',
        format('Uma conversa foi finalizada no pipeline como %s.', v_stage_name), NEW.id,
        '/chat?leadId=' || NEW.id::text,
        'pipeline_finished:' || NEW.id::text || ':' || NEW.stage_id::text || ':' || txid_current()::text
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_operational_notifications ON crm.leads;
CREATE TRIGGER trg_leads_operational_notifications
AFTER INSERT OR UPDATE OF interaction_mode, stage_id ON crm.leads
FOR EACH ROW EXECUTE FUNCTION crm.create_operational_notification();

REVOKE ALL ON FUNCTION crm.create_operational_notification() FROM PUBLIC, anon, authenticated;

-- Editorial content is curated in migrations; operational events are never backfilled.
INSERT INTO crm.notifications (
  aces_id, category, event_type, title, description, published_at, idempotency_key
) VALUES (
  NULL, 'notice', 'weekly_update_2026_07_14', 'Conversas mais fluidas',
  'Mensagens agora chegam em tempo real, com contadores de novas conversas e uma finalizacao mais confiavel.',
  timestamptz '2026-07-14 12:00:00-03', 'weekly_update:2026-07-14'
) ON CONFLICT (idempotency_key) DO NOTHING;

-- Audio IA exists for every current and future agent, always disabled until configured.
INSERT INTO agents.agent_tools (
  aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config
)
SELECT
  a.aces_id, a.id, 'ai_audio', 1, false, 'needs_config',
  jsonb_build_object('selectionRate', 0.018, 'voiceId', NULL)
FROM agents.ai_agents a
ON CONFLICT (agent_id, tool_key) DO NOTHING;

UPDATE agents.agent_tools
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{selectionRate}', '0.018'::jsonb, true),
    updated_at = now()
WHERE tool_key = 'ai_audio';

INSERT INTO agents.agent_template_tools (
  template_key, template_version, tool_key, tool_version,
  display_order, default_enabled, default_readiness, default_config
)
SELECT
  t.template_key, t.version, 'ai_audio', 1, 10, false, 'needs_config',
  jsonb_build_object('selectionRate', 0.018, 'voiceId', NULL)
FROM agents.agent_templates t
ON CONFLICT (template_key, template_version, tool_key) DO UPDATE
SET default_enabled = false,
    default_config = jsonb_set(
      COALESCE(agents.agent_template_tools.default_config, '{}'::jsonb),
      '{selectionRate}', '0.018'::jsonb, true
    );

CREATE OR REPLACE FUNCTION agents.install_default_agent_tools()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO agents, public
AS $$
BEGIN
  INSERT INTO agents.agent_tools (
    aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config
  ) VALUES (
    NEW.aces_id, NEW.id, 'ai_audio', 1, false, 'needs_config',
    jsonb_build_object('selectionRate', 0.018, 'voiceId', NULL)
  ) ON CONFLICT (agent_id, tool_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_install_default_agent_tools ON agents.ai_agents;
CREATE TRIGGER trg_install_default_agent_tools
AFTER INSERT ON agents.ai_agents
WHEN (NEW.template_key IS NULL)
FOR EACH ROW EXECUTE FUNCTION agents.install_default_agent_tools();

REVOKE ALL ON FUNCTION agents.install_default_agent_tools() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'message_history', 'leads', 'pipelines', 'pipeline_stages',
    'chat_read_states', 'notifications', 'notification_reads'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'crm'
        AND tablename = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE crm.%I', v_table);
    END IF;
  END LOOP;
END;
$$;
