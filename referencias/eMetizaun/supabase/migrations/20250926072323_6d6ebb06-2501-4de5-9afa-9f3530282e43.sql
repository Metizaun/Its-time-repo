-- Update the trigger_type check constraint to include birthday and important date triggers
ALTER TABLE public.task_automation_rules 
DROP CONSTRAINT IF EXISTS task_automation_rules_trigger_type_check;

ALTER TABLE public.task_automation_rules 
ADD CONSTRAINT task_automation_rules_trigger_type_check 
CHECK (trigger_type IN (
  'deal_created', 
  'deal_stage_changed', 
  'contact_created', 
  'company_created', 
  'lead_converted', 
  'date_based', 
  'manual',
  'birthday_approaching',
  'anniversary_approaching', 
  'important_date_approaching'
));