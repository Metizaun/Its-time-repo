ALTER TABLE crm.ai_agents
  ADD COLUMN IF NOT EXISTS handoff_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS handoff_prompt text,
  ADD COLUMN IF NOT EXISTS handoff_target_phone text;

ALTER TABLE crm.ai_agents
  DROP CONSTRAINT IF EXISTS ai_agents_handoff_target_phone_check;

ALTER TABLE crm.ai_agents
  ADD CONSTRAINT ai_agents_handoff_target_phone_check
  CHECK (
    handoff_target_phone IS NULL
    OR length(regexp_replace(handoff_target_phone, '\D', '', 'g')) BETWEEN 10 AND 15
  );
