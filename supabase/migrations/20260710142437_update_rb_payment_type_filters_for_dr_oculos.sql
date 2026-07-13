UPDATE crm.automation_steps AS step
SET
  rb_payment_type_ids = '["6","8","9"]'::jsonb,
  updated_at = now()
FROM crm.automation_funnels AS funnel
WHERE funnel.id = step.funnel_id
  AND funnel.aces_id = 5
  AND funnel.name LIKE 'RB Dr Oculos - %';
