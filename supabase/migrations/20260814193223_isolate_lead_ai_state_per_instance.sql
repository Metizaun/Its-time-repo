BEGIN;

ALTER TABLE agents.ai_lead_state
  ADD COLUMN IF NOT EXISTS interaction_mode text NOT NULL DEFAULT 'ai';

ALTER TABLE agents.ai_lead_state
  DROP CONSTRAINT IF EXISTS ai_lead_state_interaction_mode_check;

ALTER TABLE agents.ai_lead_state
  ADD CONSTRAINT ai_lead_state_interaction_mode_check
  CHECK (interaction_mode IN ('ai', 'human'));

-- Preserve the currently active human handoff only for the agent that owns
-- the lead's primary instance. Other instance agents remain available.
UPDATE agents.ai_lead_state AS state
SET interaction_mode = 'human'
FROM agents.ai_agents AS agent
JOIN crm.leads AS lead
  ON lead.interaction_mode = 'human'
 AND agent.instance_name = lead.instancia
WHERE state.agent_id = agent.id
  AND lead.id = state.lead_id;

-- Manual sends already carry the per-agent human pause semantics. Keep them
-- isolated even when the legacy lead-level flag is stale.
UPDATE agents.ai_lead_state
SET interaction_mode = 'human'
WHERE pause_origin = 'manual_send';

COMMIT;
