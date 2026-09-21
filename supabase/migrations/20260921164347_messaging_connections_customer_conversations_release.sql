BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- Canonical business-level connection. Legacy instances remain provider
-- transport details and are deliberately not removed by this migration.
CREATE TABLE crm.messaging_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  channel_type text NOT NULL
    CHECK (channel_type IN ('whatsapp', 'instagram', 'website', 'legacy')),
  provider text NOT NULL
    CHECK (provider IN ('evolution', 'meta', 'gupshup', 'instagram', 'website', 'legacy')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  provider_external_id text,
  legacy_instance_name text,
  capability text NOT NULL DEFAULT 'full'
    CHECK (capability IN ('manual_only', 'full', 'disabled')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'disabled', 'error', 'reconnect_required')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messaging_connections_id_account_unique UNIQUE (id, aces_id),
  CONSTRAINT messaging_connections_provider_external_unique
    UNIQUE (aces_id, provider, provider_external_id),
  CONSTRAINT messaging_connections_provider_channel_check CHECK (
    (channel_type = 'whatsapp' AND provider IN ('evolution', 'meta', 'gupshup'))
    OR (channel_type = 'instagram' AND provider = 'instagram')
    OR (channel_type = 'website' AND provider = 'website')
    OR (channel_type = 'legacy' AND provider = 'legacy')
  )
);

CREATE INDEX idx_messaging_connections_account_status
  ON crm.messaging_connections(aces_id, status, channel_type, display_name);
CREATE INDEX idx_messaging_connections_legacy_instance
  ON crm.messaging_connections(aces_id, legacy_instance_name)
  WHERE legacy_instance_name IS NOT NULL;

CREATE TRIGGER trg_messaging_connections_updated_at
BEFORE UPDATE ON crm.messaging_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE crm.instance_channels
  ADD COLUMN messaging_connection_id uuid;

INSERT INTO crm.messaging_connections (
  id, aces_id, channel_type, provider, display_name, provider_external_id,
  legacy_instance_name, capability, status, metadata, created_at, updated_at
)
SELECT
  channel.id,
  channel.aces_id,
  channel.channel_type,
  channel.provider,
  channel.instance_name,
  'instance:' || channel.instance_name,
  channel.instance_name,
  channel.capability,
  channel.status,
  jsonb_build_object('source', 'instance_channels'),
  channel.created_at,
  channel.updated_at
FROM crm.instance_channels AS channel
ON CONFLICT (id) DO NOTHING;

UPDATE crm.instance_channels
SET messaging_connection_id = id
WHERE messaging_connection_id IS NULL;

ALTER TABLE crm.instance_channels
  ALTER COLUMN messaging_connection_id SET NOT NULL,
  ADD CONSTRAINT instance_channels_messaging_connection_fkey
    FOREIGN KEY (messaging_connection_id, aces_id)
    REFERENCES crm.messaging_connections(id, aces_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT instance_channels_messaging_connection_unique
    UNIQUE (messaging_connection_id);

ALTER TABLE crm.website_widget_connections
  ADD COLUMN messaging_connection_id uuid;

INSERT INTO crm.messaging_connections (
  id, aces_id, channel_type, provider, display_name, provider_external_id,
  legacy_instance_name, capability, status, metadata, created_at, updated_at
)
SELECT
  widget.id,
  widget.aces_id,
  'website',
  'website',
  widget.name,
  'widget:' || widget.public_key,
  widget.instance_name,
  'full',
  CASE WHEN widget.status = 'active' THEN 'active' ELSE 'disabled' END,
  jsonb_build_object('source', 'website_widget_connections'),
  widget.created_at,
  widget.updated_at
FROM crm.website_widget_connections AS widget
ON CONFLICT (id) DO NOTHING;

UPDATE crm.website_widget_connections
SET messaging_connection_id = id
WHERE messaging_connection_id IS NULL;

ALTER TABLE crm.website_widget_connections
  ALTER COLUMN messaging_connection_id SET NOT NULL,
  ADD CONSTRAINT website_widget_messaging_connection_fkey
    FOREIGN KEY (messaging_connection_id, aces_id)
    REFERENCES crm.messaging_connections(id, aces_id)
    ON DELETE RESTRICT,
  ADD CONSTRAINT website_widget_messaging_connection_unique
    UNIQUE (messaging_connection_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_agents_id_account_unique'
      AND conrelid = 'agents.ai_agents'::regclass
  ) THEN
    ALTER TABLE agents.ai_agents
      ADD CONSTRAINT ai_agents_id_account_unique UNIQUE (id, aces_id);
  END IF;
END;
$$;

CREATE TABLE agents.agent_messaging_connections (
  agent_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, connection_id),
  CONSTRAINT agent_messaging_connections_agent_account_fkey
    FOREIGN KEY (agent_id, aces_id)
    REFERENCES agents.ai_agents(id, aces_id)
    ON DELETE CASCADE,
  CONSTRAINT agent_messaging_connections_connection_account_fkey
    FOREIGN KEY (connection_id, aces_id)
    REFERENCES crm.messaging_connections(id, aces_id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_agent_messaging_connections_one_active_agent
  ON agents.agent_messaging_connections(connection_id)
  WHERE is_active IS TRUE;
CREATE INDEX idx_agent_messaging_connections_agent_active
  ON agents.agent_messaging_connections(agent_id, connection_id)
  WHERE is_active IS TRUE;

CREATE TRIGGER trg_agent_messaging_connections_updated_at
BEFORE UPDATE ON agents.agent_messaging_connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Website assignment is already explicit and wins over the legacy instance
-- assignment when both exist.
INSERT INTO agents.agent_messaging_connections (
  agent_id, connection_id, aces_id, is_active, created_by
)
SELECT agent.id, widget.messaging_connection_id, widget.aces_id, true, widget.created_by
FROM crm.website_widget_connections AS widget
JOIN agents.ai_agents AS agent
  ON agent.id = widget.agent_id
 AND agent.aces_id = widget.aces_id
 AND agent.agent_type = 'primary'
WHERE widget.agent_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO agents.agent_messaging_connections (
  agent_id, connection_id, aces_id, is_active, created_by
)
SELECT agent.id, connection.id, agent.aces_id, true, agent.created_by
FROM agents.ai_agents AS agent
JOIN crm.messaging_connections AS connection
  ON connection.aces_id = agent.aces_id
 AND connection.legacy_instance_name = agent.instance_name
 AND connection.channel_type <> 'legacy'
WHERE agent.agent_type = 'primary'
  AND agent.instance_name IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE crm.customer_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  interaction_mode text NOT NULL DEFAULT 'ai'
    CHECK (interaction_mode IN ('ai', 'human')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_message_preview text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_conversations_id_account_unique UNIQUE (id, aces_id),
  CONSTRAINT customer_conversations_lead_connection_unique UNIQUE (lead_id, connection_id),
  CONSTRAINT customer_conversations_lead_account_fkey
    FOREIGN KEY (lead_id, aces_id)
    REFERENCES crm.leads(id, aces_id)
    ON DELETE CASCADE,
  CONSTRAINT customer_conversations_connection_account_fkey
    FOREIGN KEY (connection_id, aces_id)
    REFERENCES crm.messaging_connections(id, aces_id)
    ON DELETE RESTRICT
);

CREATE INDEX idx_customer_conversations_feed
  ON crm.customer_conversations(aces_id, last_message_at DESC NULLS LAST, id DESC);
CREATE INDEX idx_customer_conversations_lead
  ON crm.customer_conversations(lead_id, last_message_at DESC NULLS LAST);
CREATE INDEX idx_customer_conversations_connection
  ON crm.customer_conversations(connection_id, status, last_message_at DESC NULLS LAST);

CREATE TRIGGER trg_customer_conversations_updated_at
BEFORE UPDATE ON crm.customer_conversations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE crm.message_history
  ADD COLUMN customer_conversation_id uuid
    REFERENCES crm.customer_conversations(id) ON DELETE RESTRICT;

CREATE INDEX idx_message_history_customer_conversation_sent
  ON crm.message_history(customer_conversation_id, sent_at, id)
  WHERE customer_conversation_id IS NOT NULL;

UPDATE crm.message_history AS message
SET aces_id = lead.aces_id
FROM crm.leads AS lead
WHERE message.lead_id = lead.id
  AND message.aces_id IS NULL;

-- Exact provider/instance mappings are safe. Website rows are exact only when
-- a single widget uses that legacy instance.
WITH exact_message_connections AS (
  SELECT message.id AS message_id, (array_agg(connection.id ORDER BY connection.id))[1] AS connection_id
  FROM crm.message_history AS message
  JOIN crm.messaging_connections AS connection
    ON connection.aces_id = message.aces_id
   AND connection.legacy_instance_name IS NOT DISTINCT FROM message.instance
   AND connection.provider = message.provider
   AND connection.channel_type <> 'legacy'
  GROUP BY message.id
  HAVING count(*) = 1
)
INSERT INTO crm.customer_conversations (
  aces_id, lead_id, connection_id, interaction_mode,
  last_message_at, last_inbound_at, last_message_preview
)
SELECT
  message.aces_id,
  message.lead_id,
  mapping.connection_id,
  COALESCE(lead.interaction_mode, 'ai'),
  max(message.sent_at),
  max(message.sent_at) FILTER (WHERE lower(message.direction) IN ('in', 'inbound')),
  (array_agg(left(message.content, 240) ORDER BY message.sent_at DESC, message.id DESC))[1]
FROM exact_message_connections AS mapping
JOIN crm.message_history AS message ON message.id = mapping.message_id
JOIN crm.leads AS lead ON lead.id = message.lead_id
GROUP BY message.aces_id, message.lead_id, mapping.connection_id, lead.interaction_mode
ON CONFLICT (lead_id, connection_id) DO NOTHING;

WITH exact_message_connections AS (
  SELECT message.id AS message_id, (array_agg(connection.id ORDER BY connection.id))[1] AS connection_id
  FROM crm.message_history AS message
  JOIN crm.messaging_connections AS connection
    ON connection.aces_id = message.aces_id
   AND connection.legacy_instance_name IS NOT DISTINCT FROM message.instance
   AND connection.provider = message.provider
   AND connection.channel_type <> 'legacy'
  GROUP BY message.id
  HAVING count(*) = 1
)
UPDATE crm.message_history AS message
SET customer_conversation_id = conversation.id
FROM exact_message_connections AS mapping
JOIN crm.customer_conversations AS conversation
  ON conversation.connection_id = mapping.connection_id
WHERE message.id = mapping.message_id
  AND conversation.lead_id = message.lead_id
  AND message.customer_conversation_id IS NULL;

-- Ambiguous or unrecognized historical traffic remains readable but can never
-- be used for outbound delivery.
INSERT INTO crm.messaging_connections (
  aces_id, channel_type, provider, display_name, provider_external_id,
  legacy_instance_name, capability, status, metadata
)
SELECT DISTINCT
  message.aces_id,
  'legacy',
  'legacy',
  'Historico legado - ' || COALESCE(message.provider, 'desconhecido') ||
    CASE WHEN message.instance IS NULL THEN '' ELSE ' - ' || message.instance END,
  'history:' || COALESCE(message.provider, 'unknown') || ':' || COALESCE(message.instance, 'none'),
  message.instance,
  'disabled',
  'disabled',
  jsonb_build_object('originalProvider', message.provider)
FROM crm.message_history AS message
WHERE message.customer_conversation_id IS NULL
  AND message.aces_id IS NOT NULL
ON CONFLICT (aces_id, provider, provider_external_id) DO NOTHING;

INSERT INTO crm.customer_conversations (
  aces_id, lead_id, connection_id, interaction_mode,
  last_message_at, last_inbound_at, last_message_preview
)
SELECT
  message.aces_id,
  message.lead_id,
  connection.id,
  COALESCE(lead.interaction_mode, 'human'),
  max(message.sent_at),
  max(message.sent_at) FILTER (WHERE lower(message.direction) IN ('in', 'inbound')),
  (array_agg(left(message.content, 240) ORDER BY message.sent_at DESC, message.id DESC))[1]
FROM crm.message_history AS message
JOIN crm.leads AS lead ON lead.id = message.lead_id
JOIN crm.messaging_connections AS connection
  ON connection.aces_id = message.aces_id
 AND connection.provider = 'legacy'
 AND connection.provider_external_id =
   'history:' || COALESCE(message.provider, 'unknown') || ':' || COALESCE(message.instance, 'none')
WHERE message.customer_conversation_id IS NULL
GROUP BY message.aces_id, message.lead_id, connection.id, lead.interaction_mode
ON CONFLICT (lead_id, connection_id) DO NOTHING;

UPDATE crm.message_history AS message
SET customer_conversation_id = conversation.id
FROM crm.messaging_connections AS connection
JOIN crm.customer_conversations AS conversation
  ON conversation.connection_id = connection.id
WHERE message.customer_conversation_id IS NULL
  AND connection.aces_id = message.aces_id
  AND connection.provider = 'legacy'
  AND connection.provider_external_id =
    'history:' || COALESCE(message.provider, 'unknown') || ':' || COALESCE(message.instance, 'none')
  AND conversation.lead_id = message.lead_id;

CREATE TABLE crm.conversation_migration_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES crm.messaging_connections(id) ON DELETE RESTRICT,
  reason text NOT NULL,
  message_count integer NOT NULL CHECK (message_count > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_migration_issues_unique UNIQUE (lead_id, connection_id, reason)
);

INSERT INTO crm.conversation_migration_issues (
  aces_id, lead_id, connection_id, reason, message_count
)
SELECT
  conversation.aces_id,
  conversation.lead_id,
  conversation.connection_id,
  'historical_connection_ambiguous',
  count(*)::integer
FROM crm.customer_conversations AS conversation
JOIN crm.messaging_connections AS connection
  ON connection.id = conversation.connection_id
JOIN crm.message_history AS message
  ON message.customer_conversation_id = conversation.id
WHERE connection.channel_type = 'legacy'
GROUP BY conversation.aces_id, conversation.lead_id, conversation.connection_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION crm.assign_message_customer_conversation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_connection_id uuid;
  v_candidate_count integer;
  v_interaction_mode text;
BEGIN
  IF NEW.customer_conversation_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.aces_id IS NULL THEN
    SELECT lead.aces_id INTO NEW.aces_id
    FROM crm.leads AS lead
    WHERE lead.id = NEW.lead_id;
  END IF;

  SELECT count(*), (array_agg(connection.id ORDER BY connection.id))[1]
  INTO v_candidate_count, v_connection_id
  FROM crm.messaging_connections AS connection
  WHERE connection.aces_id = NEW.aces_id
    AND connection.legacy_instance_name IS NOT DISTINCT FROM NEW.instance
    AND connection.provider = COALESCE(NEW.provider, 'evolution')
    AND connection.channel_type <> 'legacy';

  IF v_candidate_count <> 1 THEN
    SELECT connection.id INTO v_connection_id
    FROM crm.messaging_connections AS connection
    WHERE connection.aces_id = NEW.aces_id
      AND connection.provider = 'legacy'
      AND connection.provider_external_id =
        'history:' || COALESCE(NEW.provider, 'unknown') || ':' || COALESCE(NEW.instance, 'none')
    LIMIT 1;
  END IF;

  IF v_connection_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(lead.interaction_mode, 'ai')
  INTO v_interaction_mode
  FROM crm.leads AS lead
  WHERE lead.id = NEW.lead_id;

  INSERT INTO crm.customer_conversations (
    aces_id, lead_id, connection_id, interaction_mode
  ) VALUES (
    NEW.aces_id, NEW.lead_id, v_connection_id, v_interaction_mode
  )
  ON CONFLICT (lead_id, connection_id) DO UPDATE
  SET updated_at = now()
  RETURNING id INTO NEW.customer_conversation_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_history_assign_customer_conversation
BEFORE INSERT OR UPDATE OF lead_id, aces_id, instance, provider, customer_conversation_id
ON crm.message_history
FOR EACH ROW EXECUTE FUNCTION crm.assign_message_customer_conversation();

CREATE OR REPLACE FUNCTION crm.refresh_customer_conversation_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.customer_conversation_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE crm.customer_conversations
  SET last_message_at = CASE
        WHEN last_message_at IS NULL THEN NEW.sent_at
        ELSE greatest(last_message_at, NEW.sent_at)
      END,
      last_inbound_at = CASE
        WHEN lower(NEW.direction) IN ('in', 'inbound') THEN
          CASE WHEN last_inbound_at IS NULL THEN NEW.sent_at ELSE greatest(last_inbound_at, NEW.sent_at) END
        ELSE last_inbound_at
      END,
      last_message_preview = CASE
        WHEN last_message_at IS NULL OR NEW.sent_at >= last_message_at THEN left(NEW.content, 240)
        ELSE last_message_preview
      END,
      updated_at = now()
  WHERE id = NEW.customer_conversation_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_message_history_refresh_customer_conversation
AFTER INSERT ON crm.message_history
FOR EACH ROW EXECUTE FUNCTION crm.refresh_customer_conversation_summary();

CREATE TABLE crm.customer_conversation_read_states (
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES crm.customer_conversations(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crm_user_id, conversation_id)
);

CREATE INDEX idx_customer_conversation_read_states_conversation
  ON crm.customer_conversation_read_states(conversation_id, crm_user_id);

INSERT INTO crm.customer_conversation_read_states (
  crm_user_id, conversation_id, aces_id, last_read_at, created_at, updated_at
)
SELECT
  state.crm_user_id,
  conversation.id,
  state.aces_id,
  state.last_read_at,
  state.created_at,
  state.updated_at
FROM crm.chat_read_states AS state
JOIN crm.customer_conversations AS conversation
  ON conversation.lead_id = state.lead_id
 AND conversation.aces_id = state.aces_id
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION crm.current_user_can_access_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.customer_conversations AS conversation
    WHERE conversation.id = p_conversation_id
      AND conversation.aces_id = public.current_aces_id()
      AND crm.current_user_can_access_lead(conversation.lead_id)
  );
$$;

REVOKE ALL ON FUNCTION crm.current_user_can_access_conversation(uuid)
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION crm.current_user_can_access_conversation(uuid)
  TO authenticated, service_role;

ALTER TABLE crm.messaging_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_conversation_read_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.conversation_migration_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.agent_messaging_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY messaging_connections_select_accessible
ON crm.messaging_connections FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR (
      legacy_instance_name IS NOT NULL
      AND crm.current_user_can_access_instance(legacy_instance_name, 'viewer')
    )
  )
);

CREATE POLICY customer_conversations_select_accessible
ON crm.customer_conversations FOR SELECT TO authenticated
USING (crm.current_user_can_access_conversation(id));

CREATE POLICY customer_conversation_read_states_select_own
ON crm.customer_conversation_read_states FOR SELECT TO authenticated
USING (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_conversation(conversation_id)
);

CREATE POLICY customer_conversation_read_states_insert_own
ON crm.customer_conversation_read_states FOR INSERT TO authenticated
WITH CHECK (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_conversation(conversation_id)
);

CREATE POLICY customer_conversation_read_states_update_own
ON crm.customer_conversation_read_states FOR UPDATE TO authenticated
USING (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_conversation(conversation_id)
)
WITH CHECK (
  crm_user_id = public.current_crm_user_id()
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_conversation(conversation_id)
);

GRANT SELECT ON crm.messaging_connections, crm.customer_conversations
  TO authenticated;
GRANT SELECT, INSERT, UPDATE ON crm.customer_conversation_read_states
  TO authenticated;
REVOKE ALL ON crm.conversation_migration_issues FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.conversation_migration_issues TO service_role;
REVOKE ALL ON agents.agent_messaging_connections FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents.agent_messaging_connections TO service_role;

CREATE OR REPLACE FUNCTION crm.rpc_get_customer_conversation_unread_counts()
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    message.customer_conversation_id,
    count(*)::bigint
  FROM crm.message_history AS message
  JOIN crm.customer_conversations AS conversation
    ON conversation.id = message.customer_conversation_id
  LEFT JOIN crm.customer_conversation_read_states AS read_state
    ON read_state.conversation_id = conversation.id
   AND read_state.crm_user_id = public.current_crm_user_id()
  WHERE conversation.aces_id = public.current_aces_id()
    AND crm.current_user_can_access_conversation(conversation.id)
    AND lower(message.direction) IN ('in', 'inbound')
    AND message.sent_at > COALESCE(read_state.last_read_at, '-infinity'::timestamptz)
  GROUP BY message.customer_conversation_id;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_customer_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer;
BEGIN
  IF NOT crm.current_user_can_access_conversation(p_conversation_id) THEN
    RAISE EXCEPTION 'Conversa indisponivel';
  END IF;

  SELECT conversation.aces_id INTO v_aces_id
  FROM crm.customer_conversations AS conversation
  WHERE conversation.id = p_conversation_id;

  INSERT INTO crm.customer_conversation_read_states (
    crm_user_id, conversation_id, aces_id, last_read_at
  ) VALUES (
    public.current_crm_user_id(), p_conversation_id, v_aces_id, now()
  )
  ON CONFLICT (crm_user_id, conversation_id) DO UPDATE
  SET last_read_at = greatest(
        crm.customer_conversation_read_states.last_read_at,
        excluded.last_read_at
      ),
      updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_get_customer_conversation_unread_counts()
  TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_customer_conversation_read(uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION crm.rpc_get_customer_conversation_unread_counts() FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_mark_customer_conversation_read(uuid) FROM anon;

CREATE TABLE agents.ai_conversation_state (
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES crm.customer_conversations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  freeze_until timestamptz,
  last_processed_message_at timestamptz,
  last_inbound_at timestamptz,
  last_ai_reply_at timestamptz,
  last_classified_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  last_confidence numeric(4,3),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  manual_ai_enabled boolean,
  pause_origin text,
  pause_reference text,
  paused_at timestamptz,
  optical_profile jsonb DEFAULT '{}'::jsonb,
  memory_summary text,
  agenda_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  agenda_context_expires_at timestamptz,
  interaction_mode text NOT NULL DEFAULT 'ai' CHECK (interaction_mode IN ('ai', 'human')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, conversation_id)
);

CREATE INDEX idx_ai_conversation_state_lead
  ON agents.ai_conversation_state(lead_id, conversation_id);

INSERT INTO agents.ai_conversation_state (
  agent_id, conversation_id, lead_id, freeze_until, last_processed_message_at,
  last_inbound_at, last_ai_reply_at, last_classified_stage_id, last_confidence,
  status, manual_ai_enabled, pause_origin, pause_reference, paused_at,
  optical_profile, memory_summary, agenda_context, agenda_context_expires_at,
  interaction_mode, created_at, updated_at
)
SELECT
  state.agent_id,
  conversation.id,
  state.lead_id,
  state.freeze_until,
  state.last_processed_message_at,
  state.last_inbound_at,
  state.last_ai_reply_at,
  state.last_classified_stage_id,
  state.last_confidence,
  state.status,
  state.manual_ai_enabled,
  state.pause_origin,
  state.pause_reference,
  state.paused_at,
  state.optical_profile,
  state.memory_summary,
  state.agenda_context,
  state.agenda_context_expires_at,
  state.interaction_mode,
  state.created_at,
  state.updated_at
FROM agents.ai_lead_state AS state
JOIN agents.agent_messaging_connections AS binding
  ON binding.agent_id = state.agent_id
 AND binding.is_active IS TRUE
JOIN crm.customer_conversations AS conversation
  ON conversation.lead_id = state.lead_id
 AND conversation.connection_id = binding.connection_id
ON CONFLICT DO NOTHING;

ALTER TABLE agents.ai_conversation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agents.ai_conversation_state FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents.ai_conversation_state TO service_role;

ALTER TABLE agents.ai_runs
  ADD COLUMN IF NOT EXISTS customer_conversation_id uuid
    REFERENCES crm.customer_conversations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ai_runs_customer_conversation
  ON agents.ai_runs(customer_conversation_id, created_at DESC)
  WHERE customer_conversation_id IS NOT NULL;

ALTER TABLE crm.follow_up_tasks
  ADD COLUMN IF NOT EXISTS customer_conversation_id uuid
    REFERENCES crm.customer_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS messaging_connection_id uuid
    REFERENCES crm.messaging_connections(id) ON DELETE SET NULL;

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS customer_conversation_id uuid
    REFERENCES crm.customer_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS messaging_connection_id uuid
    REFERENCES crm.messaging_connections(id) ON DELETE SET NULL;

ALTER TABLE crm.routing_events
  ADD COLUMN IF NOT EXISTS customer_conversation_id uuid
    REFERENCES crm.customer_conversations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_customer_conversation
  ON crm.follow_up_tasks(customer_conversation_id, due_at)
  WHERE customer_conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_executions_messaging_connection
  ON crm.automation_executions(messaging_connection_id, status, scheduled_at)
  WHERE messaging_connection_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_routing_events_customer_conversation
  ON crm.routing_events(customer_conversation_id, status, created_at DESC)
  WHERE customer_conversation_id IS NOT NULL;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'messaging_connections',
    'customer_conversations',
    'customer_conversation_read_states'
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

COMMENT ON TABLE crm.messaging_connections IS
  'Canonical messaging endpoints. Legacy instances are transport aliases only.';
COMMENT ON TABLE crm.customer_conversations IS
  'Persistent customer conversation per lead and messaging connection.';
COMMENT ON COLUMN crm.message_history.customer_conversation_id IS
  'Canonical CRM conversation. The legacy text conversation_id remains provider metadata.';
COMMENT ON TABLE agents.agent_messaging_connections IS
  'Many-to-many agent bindings with at most one active primary agent per connection.';

NOTIFY pgrst, 'reload schema';

COMMIT;
