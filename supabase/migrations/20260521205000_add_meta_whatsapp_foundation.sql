-- Meta WhatsApp API foundation.
-- Additive and backward-compatible: existing CRM data remains in schema crm.
-- Meta-specific configuration lives in schema meta, e.g. meta.instance.provider.

CREATE SCHEMA IF NOT EXISTS meta;

GRANT USAGE ON SCHEMA meta TO anon, authenticated, service_role, authenticator;

CREATE TABLE IF NOT EXISTS meta.instance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'evolution'
    CHECK (provider IN ('evolution', 'meta')),
  meta_channel_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_instance_account_instance_unique UNIQUE (aces_id, instance_name)
);

INSERT INTO meta.instance (aces_id, instance_name, provider)
SELECT i.aces_id, i.instancia, 'evolution'
FROM crm.instance i
WHERE i.aces_id IS NOT NULL
ON CONFLICT (aces_id, instance_name) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_meta_instance_provider
  ON meta.instance(provider);

CREATE TABLE IF NOT EXISTS meta.whatsapp_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  waba_id text,
  phone_number_id text,
  business_id text,
  display_phone_number text,
  access_token_secret_ref text,
  app_secret_ref text,
  webhook_verify_token text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'disabled', 'error')),
  last_template_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_whatsapp_channels_account_instance_unique UNIQUE (aces_id, instance_name),
  CONSTRAINT meta_whatsapp_channels_phone_number_unique UNIQUE (phone_number_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meta_instance_meta_channel_id_fkey'
      AND conrelid = 'meta.instance'::regclass
  ) THEN
    ALTER TABLE meta.instance
      ADD CONSTRAINT meta_instance_meta_channel_id_fkey
      FOREIGN KEY (meta_channel_id)
      REFERENCES meta.whatsapp_channels(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_channels_aces
  ON meta.whatsapp_channels(aces_id, status);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_channels_instance
  ON meta.whatsapp_channels(instance_name);

CREATE TABLE IF NOT EXISTS meta.whatsapp_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES meta.whatsapp_channels(id) ON DELETE CASCADE,
  meta_template_id text,
  name text NOT NULL,
  language text NOT NULL DEFAULT 'pt_BR',
  category text NOT NULL DEFAULT 'UTILITY',
  status text NOT NULL DEFAULT 'UNKNOWN',
  components_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  variables_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejection_reason text,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_whatsapp_templates_channel_name_language_unique UNIQUE (channel_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_templates_channel_status
  ON meta.whatsapp_templates(channel_id, status);

CREATE TABLE IF NOT EXISTS meta.whatsapp_provider_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES meta.whatsapp_channels(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('evolution', 'meta')),
  provider_message_id text NOT NULL,
  status text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  provider_error_code text,
  provider_error_message text,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_whatsapp_provider_status_events_unique UNIQUE (
    provider,
    provider_message_id,
    status,
    event_timestamp
  )
);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_provider_status_events_aces
  ON meta.whatsapp_provider_status_events(aces_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_whatsapp_provider_status_events_message
  ON meta.whatsapp_provider_status_events(provider, provider_message_id);

ALTER TABLE crm.message_history
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_error_message text,
  ADD COLUMN IF NOT EXISTS provider_payload_summary jsonb;

UPDATE crm.message_history
SET provider = 'evolution'
WHERE provider IS NULL OR btrim(provider) = '';

ALTER TABLE crm.message_history
  ALTER COLUMN provider SET DEFAULT 'evolution',
  ALTER COLUMN provider SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_history_provider_check'
      AND conrelid = 'crm.message_history'::regclass
  ) THEN
    ALTER TABLE crm.message_history
      ADD CONSTRAINT message_history_provider_check
      CHECK (provider IN ('evolution', 'meta'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_message_history_provider_message_unique
  ON crm.message_history(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_history_provider_status
  ON crm.message_history(provider, provider_status, sent_at DESC);

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_error_message text,
  ADD COLUMN IF NOT EXISTS provider_payload_summary jsonb;

UPDATE crm.automation_executions
SET provider = 'evolution'
WHERE provider IS NULL OR btrim(provider) = '';

ALTER TABLE crm.automation_executions
  ALTER COLUMN provider SET DEFAULT 'evolution',
  ALTER COLUMN provider SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_executions_provider_check'
      AND conrelid = 'crm.automation_executions'::regclass
  ) THEN
    ALTER TABLE crm.automation_executions
      ADD CONSTRAINT automation_executions_provider_check
      CHECK (provider IN ('evolution', 'meta'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_automation_executions_provider_message
  ON crm.automation_executions(provider, provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE meta.instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.whatsapp_provider_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_instance_select ON meta.instance;
CREATE POLICY meta_instance_select
ON meta.instance
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_instance_insert ON meta.instance;
CREATE POLICY meta_instance_insert
ON meta.instance
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_instance_update ON meta.instance;
CREATE POLICY meta_instance_update
ON meta.instance
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_whatsapp_channels_select ON meta.whatsapp_channels;
CREATE POLICY meta_whatsapp_channels_select
ON meta.whatsapp_channels
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_whatsapp_channels_insert ON meta.whatsapp_channels;
CREATE POLICY meta_whatsapp_channels_insert
ON meta.whatsapp_channels
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_whatsapp_channels_update ON meta.whatsapp_channels;
CREATE POLICY meta_whatsapp_channels_update
ON meta.whatsapp_channels
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_whatsapp_channels_delete ON meta.whatsapp_channels;
CREATE POLICY meta_whatsapp_channels_delete
ON meta.whatsapp_channels
FOR DELETE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS meta_whatsapp_templates_select ON meta.whatsapp_templates;
CREATE POLICY meta_whatsapp_templates_select
ON meta.whatsapp_templates
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM meta.whatsapp_channels c
    WHERE c.id = whatsapp_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS meta_whatsapp_templates_insert ON meta.whatsapp_templates;
CREATE POLICY meta_whatsapp_templates_insert
ON meta.whatsapp_templates
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM meta.whatsapp_channels c
    WHERE c.id = whatsapp_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS meta_whatsapp_templates_update ON meta.whatsapp_templates;
CREATE POLICY meta_whatsapp_templates_update
ON meta.whatsapp_templates
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM meta.whatsapp_channels c
    WHERE c.id = whatsapp_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM meta.whatsapp_channels c
    WHERE c.id = whatsapp_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS meta_whatsapp_templates_delete ON meta.whatsapp_templates;
CREATE POLICY meta_whatsapp_templates_delete
ON meta.whatsapp_templates
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM meta.whatsapp_channels c
    WHERE c.id = whatsapp_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS meta_whatsapp_provider_status_events_select ON meta.whatsapp_provider_status_events;
CREATE POLICY meta_whatsapp_provider_status_events_select
ON meta.whatsapp_provider_status_events
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT, INSERT, UPDATE, DELETE ON meta.instance TO authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta.whatsapp_channels TO authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta.whatsapp_templates TO authenticated, authenticator;
GRANT SELECT ON meta.whatsapp_provider_status_events TO authenticated, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE ON meta.instance TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta.whatsapp_channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta.whatsapp_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON meta.whatsapp_provider_status_events TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA meta
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role, authenticator;

ALTER ROLE authenticator SET pgrst.db_schemas = 'public,storage,graphql_public,crm,meta';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
