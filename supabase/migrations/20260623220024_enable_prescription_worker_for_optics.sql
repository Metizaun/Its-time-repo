UPDATE agents.agent_tools tool
SET
  readiness = 'ready',
  is_enabled = true,
  last_validated_at = now(),
  updated_at = now()
FROM agents.ai_agents agent
WHERE agent.id = tool.agent_id
  AND agent.aces_id = tool.aces_id
  AND agent.template_key = 'optics-consultant'
  AND tool.tool_key = 'prescription_analyst';
