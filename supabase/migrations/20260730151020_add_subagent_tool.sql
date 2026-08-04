-- A subagent is configured as a Tool of a primary agent, but executes as a
-- customer-facing session owner. It never returns a tool result for the
-- primary model to rewrite and never owns a WhatsApp instance.

INSERT INTO agents.tool_definitions (
  tool_key,
  version,
  display_name,
  description,
  icon,
  config_schema,
  is_active
)
VALUES (
  'subagent',
  1,
  'Subagente',
  'Direciona assuntos especializados para um subagente que responde diretamente pelo mesmo canal.',
  'bot',
  jsonb_build_object(
    'type', 'object',
    'required', jsonb_build_array('agentKey', 'name', 'systemPrompt', 'model', 'triggerIntents'),
    'properties', jsonb_build_object(
      'agentKey', jsonb_build_object('type', 'string'),
      'name', jsonb_build_object('type', 'string'),
      'systemPrompt', jsonb_build_object('type', 'string'),
      'model', jsonb_build_object('type', 'string', 'default', 'gemini-2.5-flash'),
      'temperature', jsonb_build_object('type', 'number', 'minimum', 0, 'maximum', 1, 'default', 0.2),
      'personalityProfile', jsonb_build_object(
        'type', 'string',
        'enum', jsonb_build_array('surgical', 'consultative', 'balanced', 'dynamic', 'enthusiastic'),
        'default', 'consultative'
      ),
      'triggerIntents', jsonb_build_object('type', 'array', 'items', jsonb_build_object('type', 'string')),
      'allowedCapabilities', jsonb_build_object('type', 'array', 'items', jsonb_build_object('type', 'string')),
      'humanHandoffDestinationKey', jsonb_build_object('type', jsonb_build_array('string', 'null'))
    )
  ),
  true
)
ON CONFLICT (tool_key, version) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    config_schema = EXCLUDED.config_schema,
    is_active = true,
    updated_at = now();

INSERT INTO agents.agent_tools (
  aces_id,
  agent_id,
  tool_key,
  tool_version,
  is_enabled,
  readiness,
  config
)
SELECT
  agent.aces_id,
  agent.id,
  'subagent',
  1,
  false,
  'needs_config',
  jsonb_build_object(
    'agentKey', 'subagent',
    'name', '',
    'systemPrompt', '',
    'model', 'gemini-2.5-flash',
    'temperature', 0.2,
    'personalityProfile', 'consultative',
    'triggerIntents', jsonb_build_array(),
    'allowedCapabilities', jsonb_build_array(),
    'humanHandoffDestinationKey', NULL
  )
FROM agents.ai_agents AS agent
ON CONFLICT (agent_id, tool_key) DO NOTHING;

ALTER TABLE agents.internal_agent_profiles
  ADD COLUMN agent_tool_id uuid REFERENCES agents.agent_tools(id) ON DELETE CASCADE;

UPDATE agents.internal_agent_profiles AS profile
SET agent_tool_id = binding.id
FROM agents.agent_tools AS binding
WHERE binding.agent_id = profile.parent_agent_id
  AND binding.aces_id = profile.aces_id
  AND binding.tool_key = 'subagent';

CREATE UNIQUE INDEX idx_internal_agent_profiles_agent_tool
  ON agents.internal_agent_profiles(agent_tool_id)
  WHERE agent_tool_id IS NOT NULL;

COMMENT ON TABLE agents.internal_agent_profiles IS
  'Runtime profiles materialized by the special subagent Tool. They share the parent channel and own their replies and handoff sessions.';
COMMENT ON COLUMN agents.internal_agent_profiles.agent_tool_id IS
  'Tool binding that owns this runtime subagent profile.';

COMMENT ON TABLE agents.internal_agent_sessions IS
  'Auditable ownership sessions created by the subagent Tool between the primary agent, its subagent and human attendance.';

NOTIFY pgrst, 'reload schema';
