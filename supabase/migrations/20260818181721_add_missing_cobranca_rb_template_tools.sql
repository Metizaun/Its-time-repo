INSERT INTO agents.agent_tools (aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config)
SELECT a.aces_id, a.id, tt.tool_key, tt.tool_version, tt.default_enabled, tt.default_readiness, tt.default_config
FROM agents.ai_agents a
JOIN agents.agent_template_tools tt ON tt.template_key = a.template_key AND tt.template_version = a.template_version
WHERE a.instance_name IN ('cobranca_opaulo', 'cobranca_olider')
ON CONFLICT (agent_id, tool_key) DO NOTHING;;
