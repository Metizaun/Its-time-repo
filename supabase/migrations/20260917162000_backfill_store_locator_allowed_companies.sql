-- Backfill so the new closed-by-default allowedCompanyIds behaviour does not regress any
-- account that does not have a cross-brand leak today. Every agent (primary and subagent) keeps
-- seeing exactly the set of active companies of its own account, unchanged, until someone opens
-- "Busca Filiais" and narrows the selection.
--
-- Deliberately does NOT touch account 7 (Instituto dos Oculos / Saude Perfeita): which companies
-- belong to which brand is not derivable from the schema and must be curated by hand in a
-- follow-up, one-off script after this migration is applied.

INSERT INTO agents.agent_tools (aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config)
SELECT
  agent.aces_id,
  agent.id,
  'store_locator',
  1,
  false,
  'needs_config',
  '{"candidateLimit":5,"routeCacheMinutes":30,"travelMode":"DRIVE","locationRetentionMonths":12}'::jsonb
FROM agents.ai_agents AS agent
ON CONFLICT (agent_id, tool_key) DO NOTHING;

UPDATE agents.agent_tools AS tool
SET config = tool.config || jsonb_build_object(
      'allowedCompanyIds',
      COALESCE((
        SELECT jsonb_agg(company.id ORDER BY company.id)
        FROM crm.empresas AS company
        WHERE company.aces_id = tool.aces_id
          AND company.is_active IS TRUE
      ), '[]'::jsonb)
    ),
    updated_at = now()
WHERE tool.tool_key = 'store_locator'
  AND NOT (tool.config ? 'allowedCompanyIds');
