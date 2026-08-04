-- Internal customer-facing agents share the parent agent's WhatsApp instance,
-- but keep their own prompt, model, personality and auditable session state.
-- They are runtime subagents and cannot own a WhatsApp instance. A later
-- migration exposes their configuration through a special Tool binding.

ALTER TABLE agents.ai_agents
  ADD COLUMN rag_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN agents.ai_agents.rag_enabled IS
  'Controls vector knowledge retrieval for this customer-facing agent. Internal agents never use RAG.';

CREATE TABLE agents.internal_agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  parent_agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  agent_key text NOT NULL,
  name text NOT NULL,
  system_prompt text NOT NULL,
  provider text NOT NULL DEFAULT 'gemini' CHECK (provider = 'gemini'),
  model text NOT NULL DEFAULT 'gemini-3.1-flash-lite',
  temperature numeric(3,2) NOT NULL DEFAULT 0.20 CHECK (temperature BETWEEN 0 AND 1),
  personality_profile text NOT NULL DEFAULT 'consultative'
    CHECK (personality_profile IN ('surgical', 'consultative', 'balanced', 'dynamic', 'enthusiastic')),
  trigger_intents text[] NOT NULL DEFAULT ARRAY['company_info', 'professionals', 'price', 'availability', 'book', 'reschedule', 'cancel']::text[],
  allowed_capabilities text[] NOT NULL DEFAULT ARRAY['company_info', 'professionals', 'price', 'availability']::text[],
  human_handoff_destination_key text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_agent_profiles_parent_key_unique UNIQUE (parent_agent_id, agent_key),
  CONSTRAINT internal_agent_profiles_key_check CHECK (agent_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  CONSTRAINT internal_agent_profiles_name_check CHECK (length(btrim(name)) > 0),
  CONSTRAINT internal_agent_profiles_prompt_check CHECK (length(btrim(system_prompt)) > 0),
  CONSTRAINT internal_agent_profiles_trigger_intents_check CHECK (
    trigger_intents <@ ARRAY['company_info', 'professionals', 'price', 'availability', 'book', 'reschedule', 'cancel']::text[]
  ),
  CONSTRAINT internal_agent_profiles_capabilities_check CHECK (
    allowed_capabilities <@ ARRAY['company_info', 'professionals', 'price', 'availability']::text[]
  )
);

CREATE INDEX idx_internal_agent_profiles_parent_active
  ON agents.internal_agent_profiles(aces_id, parent_agent_id, agent_key)
  WHERE is_active IS TRUE;

CREATE TABLE agents.internal_agent_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  parent_agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  internal_agent_id uuid NOT NULL REFERENCES agents.internal_agent_profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'primary_active'
    CHECK (status IN ('primary_active', 'clinical_active', 'human_active', 'returned_to_primary', 'failed')),
  reason text,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(context_snapshot) = 'object'),
  started_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_internal_agent_sessions_one_active
  ON agents.internal_agent_sessions(lead_id, parent_agent_id)
  WHERE status = 'clinical_active';

CREATE INDEX idx_internal_agent_sessions_lead_recent
  ON agents.internal_agent_sessions(aces_id, lead_id, started_at DESC);

ALTER TABLE crm.message_history
  ADD COLUMN sender_internal_agent_id uuid
    REFERENCES agents.internal_agent_profiles(id) ON DELETE SET NULL;

CREATE INDEX idx_message_history_sender_internal_agent
  ON crm.message_history(sender_internal_agent_id, sent_at DESC)
  WHERE sender_internal_agent_id IS NOT NULL;

COMMENT ON TABLE agents.internal_agent_profiles IS
  'Customer-facing internal subagents that borrow the parent agent channel without owning an instance.';
COMMENT ON TABLE agents.internal_agent_sessions IS
  'Auditable ownership sessions between the primary agent, internal agents and human attendance.';
COMMENT ON COLUMN crm.message_history.sender_internal_agent_id IS
  'Internal customer-facing agent that authored the outbound message while using the parent channel.';

DROP TRIGGER IF EXISTS trg_internal_agent_profiles_updated_at ON agents.internal_agent_profiles;
CREATE TRIGGER trg_internal_agent_profiles_updated_at
BEFORE UPDATE ON agents.internal_agent_profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trg_internal_agent_sessions_updated_at ON agents.internal_agent_sessions;
CREATE TRIGGER trg_internal_agent_sessions_updated_at
BEFORE UPDATE ON agents.internal_agent_sessions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE agents.internal_agent_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.internal_agent_sessions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON agents.internal_agent_profiles FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON agents.internal_agent_sessions FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents.internal_agent_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents.internal_agent_sessions TO service_role;

NOTIFY pgrst, 'reload schema';
