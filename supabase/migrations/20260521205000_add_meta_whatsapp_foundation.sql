-- Meta WhatsApp API foundation.
-- Additive and backward-compatible: existing instances remain on Evolution.

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS provider text;

UPDATE crm.instance
SET provider = 'evolution'
WHERE provider IS NULL OR btrim(provider) = '';

ALTER TABLE crm.instance
  ALTER COLUMN provider SET DEFAULT 'evolution',
  ALTER COLUMN provider SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instance_provider_check'
      AND conrelid = 'crm.instance'::regclass
  ) THEN
    ALTER TABLE crm.instance
      ADD CONSTRAINT instance_provider_check
      CHECK (provider IN ('evolution', 'meta'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS crm.whatsapp_meta_channels (
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
  CONSTRAINT whatsapp_meta_channels_account_instance_unique UNIQUE (aces_id, instance_name),
  CONSTRAINT whatsapp_meta_channels_phone_number_unique UNIQUE (phone_number_id)
);

ALTER TABLE crm.instance
  ADD COLUMN IF NOT EXISTS meta_channel_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'instance_meta_channel_id_fkey'
      AND conrelid = 'crm.instance'::regclass
  ) THEN
    ALTER TABLE crm.instance
      ADD CONSTRAINT instance_meta_channel_id_fkey
      FOREIGN KEY (meta_channel_id)
      REFERENCES crm.whatsapp_meta_channels(id)
      ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_instance_provider
  ON crm.instance(provider);

CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_channels_aces
  ON crm.whatsapp_meta_channels(aces_id, status);

CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_channels_instance
  ON crm.whatsapp_meta_channels(instance_name);

CREATE TABLE IF NOT EXISTS crm.whatsapp_meta_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES crm.whatsapp_meta_channels(id) ON DELETE CASCADE,
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
  CONSTRAINT whatsapp_meta_templates_channel_name_language_unique UNIQUE (channel_id, name, language)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_meta_templates_channel_status
  ON crm.whatsapp_meta_templates(channel_id, status);

CREATE TABLE IF NOT EXISTS crm.whatsapp_provider_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES crm.whatsapp_meta_channels(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'meta'
    CHECK (provider IN ('evolution', 'meta')),
  provider_message_id text NOT NULL,
  status text NOT NULL,
  event_timestamp timestamptz NOT NULL,
  provider_error_code text,
  provider_error_message text,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_provider_status_events_unique UNIQUE (
    provider,
    provider_message_id,
    status,
    event_timestamp
  )
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_provider_status_events_aces
  ON crm.whatsapp_provider_status_events(aces_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_whatsapp_provider_status_events_message
  ON crm.whatsapp_provider_status_events(provider, provider_message_id);

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

ALTER TABLE crm.whatsapp_meta_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.whatsapp_meta_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.whatsapp_provider_status_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_meta_channels_select ON crm.whatsapp_meta_channels;
CREATE POLICY whatsapp_meta_channels_select
ON crm.whatsapp_meta_channels
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS whatsapp_meta_channels_insert ON crm.whatsapp_meta_channels;
CREATE POLICY whatsapp_meta_channels_insert
ON crm.whatsapp_meta_channels
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS whatsapp_meta_channels_update ON crm.whatsapp_meta_channels;
CREATE POLICY whatsapp_meta_channels_update
ON crm.whatsapp_meta_channels
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS whatsapp_meta_channels_delete ON crm.whatsapp_meta_channels;
CREATE POLICY whatsapp_meta_channels_delete
ON crm.whatsapp_meta_channels
FOR DELETE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS whatsapp_meta_templates_select ON crm.whatsapp_meta_templates;
CREATE POLICY whatsapp_meta_templates_select
ON crm.whatsapp_meta_templates
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM crm.whatsapp_meta_channels c
    WHERE c.id = whatsapp_meta_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS whatsapp_meta_templates_insert ON crm.whatsapp_meta_templates;
CREATE POLICY whatsapp_meta_templates_insert
ON crm.whatsapp_meta_templates
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM crm.whatsapp_meta_channels c
    WHERE c.id = whatsapp_meta_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS whatsapp_meta_templates_update ON crm.whatsapp_meta_templates;
CREATE POLICY whatsapp_meta_templates_update
ON crm.whatsapp_meta_templates
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM crm.whatsapp_meta_channels c
    WHERE c.id = whatsapp_meta_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM crm.whatsapp_meta_channels c
    WHERE c.id = whatsapp_meta_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS whatsapp_meta_templates_delete ON crm.whatsapp_meta_templates;
CREATE POLICY whatsapp_meta_templates_delete
ON crm.whatsapp_meta_templates
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM crm.whatsapp_meta_channels c
    WHERE c.id = whatsapp_meta_templates.channel_id
      AND c.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS whatsapp_provider_status_events_select ON crm.whatsapp_provider_status_events;
CREATE POLICY whatsapp_provider_status_events_select
ON crm.whatsapp_provider_status_events
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.whatsapp_meta_channels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.whatsapp_meta_templates TO authenticated;
GRANT SELECT ON crm.whatsapp_provider_status_events TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.whatsapp_meta_channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.whatsapp_meta_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.whatsapp_provider_status_events TO service_role;
