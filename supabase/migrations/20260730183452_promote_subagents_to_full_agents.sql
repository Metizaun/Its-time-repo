-- Promote internal profiles to the canonical agent entity. A subagent owns its
-- prompt and Tools, but deliberately inherits the parent communication channel.

ALTER TABLE agents.ai_agents
  ALTER COLUMN instance_name DROP NOT NULL,
  ADD COLUMN agent_type text NOT NULL DEFAULT 'primary',
  ADD COLUMN parent_agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  ADD COLUMN agent_key text,
  ADD COLUMN routing_instruction text;

COMMENT ON COLUMN agents.ai_agents.agent_type IS
  'primary owns a channel; subagent is callable only through its parent agent.';
COMMENT ON COLUMN agents.ai_agents.parent_agent_id IS
  'Primary agent whose channel is inherited by this internal subagent.';
COMMENT ON COLUMN agents.ai_agents.agent_key IS
  'Stable manifest and routing key for an internal subagent.';
COMMENT ON COLUMN agents.ai_agents.routing_instruction IS
  'Natural-language description used by the parent to select this subagent.';

-- Preserve existing local Cardeal profiles while moving them into the regular
-- agent model. The profile UUID is retained so session/message migration is lossless.
INSERT INTO agents.ai_agents (
  id,
  aces_id,
  instance_name,
  name,
  system_prompt,
  provider,
  model,
  is_active,
  temperature,
  personality_profile,
  buffer_wait_ms,
  human_pause_minutes,
  auto_apply_threshold,
  handoff_enabled,
  handoff_prompt,
  handoff_target_phone,
  rag_enabled,
  unanswered_followup_enabled,
  created_by,
  agent_type,
  parent_agent_id,
  agent_key,
  routing_instruction,
  created_at,
  updated_at
)
SELECT
  profile.id,
  profile.aces_id,
  NULL,
  profile.name,
  profile.system_prompt,
  profile.provider,
  profile.model,
  profile.is_active,
  profile.temperature,
  profile.personality_profile,
  parent.buffer_wait_ms,
  parent.human_pause_minutes,
  parent.auto_apply_threshold,
  true,
  'Encaminhe para atendimento humano quando o cliente pedir agendamento, remarcacao, cancelamento ou demonstrar intencao clara de realizar a consulta.',
  NULL,
  false,
  parent.unanswered_followup_enabled,
  parent.created_by,
  'subagent',
  profile.parent_agent_id,
  profile.agent_key,
  CASE
    WHEN cardinality(profile.trigger_intents) > 0
      THEN 'Assuma o atendimento quando a intencao estiver entre: ' || array_to_string(profile.trigger_intents, ', ') || '.'
    ELSE 'Assuma os assuntos especializados descritos nas suas instrucoes.'
  END,
  profile.created_at,
  profile.updated_at
FROM agents.internal_agent_profiles AS profile
JOIN agents.ai_agents AS parent ON parent.id = profile.parent_agent_id
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    system_prompt = EXCLUDED.system_prompt,
    model = EXCLUDED.model,
    is_active = EXCLUDED.is_active,
    temperature = EXCLUDED.temperature,
    personality_profile = EXCLUDED.personality_profile,
    rag_enabled = false,
    agent_type = 'subagent',
    parent_agent_id = EXCLUDED.parent_agent_id,
    agent_key = EXCLUDED.agent_key,
    routing_instruction = EXCLUDED.routing_instruction,
    updated_at = now();

-- Canonical message authorship already supports any ai_agents row.
UPDATE crm.message_history
SET sender_agent_id = sender_internal_agent_id
WHERE sender_internal_agent_id IS NOT NULL;

-- Reuse the platform transfer ledger instead of maintaining a parallel session table.
INSERT INTO agents.agent_transfer_sessions (
  id,
  aces_id,
  lead_id,
  source_agent_id,
  target_agent_id,
  source_message_id,
  status,
  context_snapshot,
  cooldown_until,
  started_at,
  ended_at,
  created_at,
  updated_at
)
SELECT
  session.id,
  session.aces_id,
  session.lead_id,
  session.parent_agent_id,
  session.internal_agent_id,
  NULL,
  CASE
    WHEN session.status = 'clinical_active' THEN 'active'
    WHEN session.status = 'failed' THEN 'failed'
    ELSE 'completed'
  END,
  session.context_snapshot || jsonb_build_object(
    'migration_source', 'internal_agent_sessions',
    'previous_status', session.status,
    'reason', session.reason
  ),
  NULL,
  session.started_at,
  COALESCE(session.ended_at, CASE WHEN session.status = 'clinical_active' THEN NULL ELSE session.last_activity_at END),
  session.created_at,
  session.updated_at
FROM agents.internal_agent_sessions AS session
ON CONFLICT (id) DO NOTHING;

-- A lead can have only one active delegated owner for the same source agent.
WITH ranked_active AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY lead_id, source_agent_id
           ORDER BY started_at DESC, created_at DESC, id DESC
         ) AS position
  FROM agents.agent_transfer_sessions
  WHERE status = 'active'
)
UPDATE agents.agent_transfer_sessions AS session
SET status = 'cancelled',
    ended_at = COALESCE(session.ended_at, now()),
    context_snapshot = session.context_snapshot || jsonb_build_object(
      'ended_reason', 'Superseded while enforcing a single active delegated owner.'
    ),
    updated_at = now()
FROM ranked_active
WHERE session.id = ranked_active.id
  AND ranked_active.position > 1;

DROP INDEX IF EXISTS agents.idx_agent_transfer_sessions_active_pair;
CREATE UNIQUE INDEX idx_agent_transfer_sessions_one_active_owner
  ON agents.agent_transfer_sessions(lead_id, source_agent_id)
  WHERE status = 'active';

CREATE INDEX idx_ai_agents_parent_active
  ON agents.ai_agents(aces_id, parent_agent_id, is_active, created_at)
  WHERE agent_type = 'subagent';

CREATE UNIQUE INDEX idx_ai_agents_parent_key
  ON agents.ai_agents(parent_agent_id, agent_key)
  WHERE agent_type = 'subagent';

ALTER TABLE agents.ai_agents
  ADD CONSTRAINT ai_agents_type_check
    CHECK (agent_type IN ('primary', 'subagent')),
  ADD CONSTRAINT ai_agents_channel_ownership_check
    CHECK (
      (agent_type = 'primary' AND instance_name IS NOT NULL AND parent_agent_id IS NULL)
      OR
      (agent_type = 'subagent' AND instance_name IS NULL AND parent_agent_id IS NOT NULL)
    ),
  ADD CONSTRAINT ai_agents_parent_distinct_check
    CHECK (parent_agent_id IS NULL OR parent_agent_id <> id),
  ADD CONSTRAINT ai_agents_subagent_key_check
    CHECK (
      agent_type = 'primary'
      OR (agent_key ~ '^[a-z][a-z0-9_]{1,63}$')
    ),
  ADD CONSTRAINT ai_agents_subagent_routing_check
    CHECK (
      agent_type = 'primary'
      OR length(btrim(routing_instruction)) > 0
    );

-- Remove the abandoned special-Tool/profile implementation after data has moved.
ALTER TABLE crm.message_history DROP COLUMN sender_internal_agent_id;
DROP TABLE agents.internal_agent_sessions;
DROP TABLE agents.internal_agent_profiles;

DELETE FROM agents.agent_tools WHERE tool_key = 'subagent';
DELETE FROM agents.agent_template_tools WHERE tool_key = 'subagent';
DELETE FROM agents.tool_definitions WHERE tool_key = 'subagent';

COMMENT ON TABLE agents.agent_transfer_sessions IS
  'Auditable ownership transfers between customer-facing agents, including internal subagents.';

NOTIFY pgrst, 'reload schema';
