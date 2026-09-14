-- Provider-neutral metadata for the automation step used by collection
-- onboarding. The existing gupshup_* fields remain the dispatch contract for
-- backward compatibility; these fields carry approval state without leaking
-- provider details into the message editor or the rule evaluator.
ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS template_provider text,
  ADD COLUMN IF NOT EXISTS template_status text,
  ADD COLUMN IF NOT EXISTS template_rejection_reason text;

ALTER TABLE crm.automation_steps
  DROP CONSTRAINT IF EXISTS automation_steps_template_provider_check;

ALTER TABLE crm.automation_steps
  ADD CONSTRAINT automation_steps_template_provider_check
  CHECK (template_provider IS NULL OR template_provider IN ('meta', 'gupshup'));

CREATE INDEX IF NOT EXISTS automation_steps_collection_template_idx
  ON crm.automation_steps(template_provider, template_status)
  WHERE template_provider IS NOT NULL;
