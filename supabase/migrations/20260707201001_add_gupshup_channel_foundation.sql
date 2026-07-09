CREATE SCHEMA IF NOT EXISTS gupshup;

GRANT USAGE ON SCHEMA gupshup TO anon, authenticated, service_role, authenticator;

CREATE TABLE IF NOT EXISTS gupshup.channel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  app_id text,
  app_name text NOT NULL,
  api_key text NOT NULL,
  phone_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gupshup_channel_account_instance_unique UNIQUE (aces_id, instance_name)
);

CREATE INDEX IF NOT EXISTS idx_gupshup_channel_aces_status
  ON gupshup.channel(aces_id, status);

CREATE INDEX IF NOT EXISTS idx_gupshup_channel_instance
  ON gupshup.channel(instance_name);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instance_provider_check'
      AND conrelid = 'meta.instance'::regclass
  ) THEN
    ALTER TABLE meta.instance DROP CONSTRAINT instance_provider_check;
  END IF;

  ALTER TABLE meta.instance
    ADD CONSTRAINT instance_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup'));
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'whatsapp_provider_status_events_provider_check'
      AND conrelid = 'meta.whatsapp_provider_status_events'::regclass
  ) THEN
    ALTER TABLE meta.whatsapp_provider_status_events
      DROP CONSTRAINT whatsapp_provider_status_events_provider_check;
  END IF;

  ALTER TABLE meta.whatsapp_provider_status_events
    ADD CONSTRAINT whatsapp_provider_status_events_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup'));
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_history_provider_check'
      AND conrelid = 'crm.message_history'::regclass
  ) THEN
    ALTER TABLE crm.message_history
      DROP CONSTRAINT message_history_provider_check;
  END IF;

  ALTER TABLE crm.message_history
    ADD CONSTRAINT message_history_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup'));
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_executions_provider_check'
      AND conrelid = 'crm.automation_executions'::regclass
  ) THEN
    ALTER TABLE crm.automation_executions
      DROP CONSTRAINT automation_executions_provider_check;
  END IF;

  ALTER TABLE crm.automation_executions
    ADD CONSTRAINT automation_executions_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup'));
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_tasks_provider_check'
      AND conrelid = 'crm.follow_up_tasks'::regclass
  ) THEN
    ALTER TABLE crm.follow_up_tasks
      DROP CONSTRAINT follow_up_tasks_provider_check;
  END IF;

  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_provider_check
    CHECK ((provider IS NULL) OR (provider IN ('evolution', 'meta', 'gupshup')));
END;
$$;

ALTER TABLE gupshup.channel ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gupshup_channel_select ON gupshup.channel;
CREATE POLICY gupshup_channel_select
ON gupshup.channel
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS gupshup_channel_insert ON gupshup.channel;
CREATE POLICY gupshup_channel_insert
ON gupshup.channel
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS gupshup_channel_update ON gupshup.channel;
CREATE POLICY gupshup_channel_update
ON gupshup.channel
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS gupshup_channel_delete ON gupshup.channel;
CREATE POLICY gupshup_channel_delete
ON gupshup.channel
FOR DELETE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT, INSERT, UPDATE, DELETE ON gupshup.channel TO authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON gupshup.channel TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA gupshup
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role, authenticator;

ALTER ROLE authenticator SET pgrst.db_schemas = 'public,storage,graphql_public,crm,meta,calendar,agents,gupshup';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
