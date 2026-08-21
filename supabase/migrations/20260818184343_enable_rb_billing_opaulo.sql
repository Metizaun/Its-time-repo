UPDATE agents.agent_tools t
SET is_enabled = true,
    readiness = 'ready',
    config = t.config || jsonb_build_object('rb_empresa_ids', c.rb_empresa_ids)
FROM agents.ai_agents a
JOIN rb.connections c ON c.aces_id = a.aces_id AND c.is_active = true
WHERE t.agent_id = a.id
  AND a.instance_name = 'cobranca_opaulo'
  AND t.tool_key = 'rb_billing';;
