SET lock_timeout = '5s';

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS first_touch_attribution jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_first_touch_attribution_object_check'
      AND conrelid = 'crm.leads'::regclass
  ) THEN
    ALTER TABLE crm.leads
      ADD CONSTRAINT leads_first_touch_attribution_object_check
      CHECK (
        first_touch_attribution IS NULL
        OR jsonb_typeof(first_touch_attribution) = 'object'
      );
  END IF;
END;
$$;

COMMENT ON COLUMN crm.leads.first_touch_attribution IS
  'Atribuicao imutavel do primeiro toque capturado pelo canal, preenchida apenas quando nula.';
