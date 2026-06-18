ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS connection_mode text;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS remote_evolution_url text;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS remote_instance_name text;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS remote_webhook_connected_at timestamptz;

UPDATE crm.instance
SET connection_mode = 'local'
WHERE connection_mode IS NULL;

ALTER TABLE crm.instance
  ALTER COLUMN connection_mode SET DEFAULT 'local';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instance_connection_mode_check'
      AND conrelid = 'crm.instance'::regclass
  ) THEN
    ALTER TABLE crm.instance
      ADD CONSTRAINT instance_connection_mode_check
      CHECK (connection_mode IN ('local', 'external_webhook'));
  END IF;
END;
$$;
