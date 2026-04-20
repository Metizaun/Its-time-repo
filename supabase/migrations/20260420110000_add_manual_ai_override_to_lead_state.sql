ALTER TABLE crm.ai_lead_state
ADD COLUMN IF NOT EXISTS manual_ai_enabled boolean;
