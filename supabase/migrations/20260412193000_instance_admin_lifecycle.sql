-- Ciclo de vida administrativo de instancias (setup, lock operacional e auditoria).

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS setup_status text;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS setup_started_at timestamptz;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS setup_expires_at timestamptz;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS operation_lock_until timestamptz;

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS last_error text;

UPDATE crm.instance
SET setup_status = CASE
  WHEN lower(coalesce(status, '')) = 'connected' THEN 'connected'
  ELSE 'pending_qr'
END
WHERE setup_status IS NULL;

UPDATE crm.instance
SET setup_started_at = coalesce(setup_started_at, created_at, now())
WHERE setup_started_at IS NULL;

UPDATE crm.instance
SET setup_expires_at = CASE
  WHEN setup_status = 'connected' THEN NULL
  ELSE coalesce(setup_expires_at, now() + interval '24 hours')
END;

ALTER TABLE crm.instance
  ALTER COLUMN setup_status SET DEFAULT 'pending_qr';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instance_setup_status_check'
      AND conrelid = 'crm.instance'::regclass
  ) THEN
    ALTER TABLE crm.instance
      ADD CONSTRAINT instance_setup_status_check
      CHECK (setup_status IN ('pending_qr', 'connected', 'expired', 'cancelled'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS crm.instance_events (
  id bigserial PRIMARY KEY,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instancia text NOT NULL,
  event_type text NOT NULL CHECK (
    event_type IN (
      'created',
      'qr_generated',
      'connected',
      'disconnected',
      'reconnect',
      'continue_setup',
      'expired',
      'deleted',
      'error'
    )
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instance_events_aces_created_idx
  ON crm.instance_events (aces_id, created_at DESC);

ALTER TABLE crm.instance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS instance_events_select ON crm.instance_events;
CREATE POLICY instance_events_select
ON crm.instance_events
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS instance_events_insert ON crm.instance_events;
CREATE POLICY instance_events_insert
ON crm.instance_events
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT, INSERT ON crm.instance_events TO authenticated;
GRANT SELECT, INSERT ON crm.instance_events TO service_role;

CREATE OR REPLACE FUNCTION crm.lock_instance_operation(
  p_instance text,
  p_aces_id integer,
  p_lock_seconds integer DEFAULT 45
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm, public
AS $$
DECLARE
  v_row_count integer := 0;
BEGIN
  UPDATE crm.instance
  SET operation_lock_until = now() + make_interval(secs => GREATEST(coalesce(p_lock_seconds, 45), 5))
  WHERE instancia = p_instance
    AND aces_id = p_aces_id
    AND (operation_lock_until IS NULL OR operation_lock_until < now());

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION crm.unlock_instance_operation(
  p_instance text,
  p_aces_id integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = crm, public
AS $$
BEGIN
  UPDATE crm.instance
  SET operation_lock_until = NULL
  WHERE instancia = p_instance
    AND aces_id = p_aces_id;
END;
$$;

GRANT EXECUTE ON FUNCTION crm.lock_instance_operation(text, integer, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.unlock_instance_operation(text, integer) TO authenticated, service_role;
