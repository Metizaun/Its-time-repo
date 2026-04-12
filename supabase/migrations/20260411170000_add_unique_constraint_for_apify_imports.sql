DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'crm'
      AND t.relname = 'leads'
      AND c.conname = 'leads_phone_account_unique'
  ) THEN
    ALTER TABLE crm.leads
      ADD CONSTRAINT leads_phone_account_unique UNIQUE (contact_phone, aces_id);
  END IF;
END $$;
