-- Suporte para onboarding de novas instancias via QR code no backend.
-- Nao lista instancias externas da Evolution; apenas registra/consulta por nome.

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS token text;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS status text;

UPDATE crm.instance
SET status = 'disconnected'
WHERE status IS NULL OR btrim(status) = '';

ALTER TABLE crm.instance
  ALTER COLUMN status SET DEFAULT 'disconnected';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instance_status_check'
      AND conrelid = 'crm.instance'::regclass
  ) THEN
    ALTER TABLE crm.instance
      ADD CONSTRAINT instance_status_check
      CHECK (status IN ('connected', 'disconnected', 'connecting', 'error'));
  END IF;
END;
$$;

DROP POLICY IF EXISTS instance_insert ON crm.instance;
CREATE POLICY instance_insert
ON crm.instance
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS instance_update ON crm.instance;
CREATE POLICY instance_update
ON crm.instance
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS instance_delete ON crm.instance;
CREATE POLICY instance_delete
ON crm.instance
FOR DELETE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.instance TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.instance TO service_role;
