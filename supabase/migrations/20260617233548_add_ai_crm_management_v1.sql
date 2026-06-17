-- Adds the v1 CRM management contract used by the AI agent.

ALTER TABLE crm.tags
  ADD COLUMN IF NOT EXISTS usage_description text NOT NULL DEFAULT '';

COMMENT ON COLUMN crm.tags.usage_description IS
  'Operational description used by the AI to decide when this tag should be applied.';

ALTER TABLE crm.ai_runs
  DROP CONSTRAINT IF EXISTS ai_runs_action_taken_check;

ALTER TABLE crm.ai_runs
  ADD CONSTRAINT ai_runs_action_taken_check
  CHECK (
    action_taken IN (
      'none',
      'reply_only',
      'stage_applied',
      'manual_pause',
      'failed',
      'freeze_repair',
      'crm_updated'
    )
  );
