-- Secure foundation for the official Meta WhatsApp channel.
-- Runtime routing remains canonical in crm.instance_channels. Sensitive Meta
-- configuration is backend-only and never exposed through Data API grants.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'meta_whatsapp_channels_id_account_unique'
      AND conrelid = 'meta.whatsapp_channels'::regclass
  ) THEN
    ALTER TABLE meta.whatsapp_channels
      ADD CONSTRAINT meta_whatsapp_channels_id_account_unique UNIQUE (id, aces_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'meta_whatsapp_channels_nonblank_ids'
      AND conrelid = 'meta.whatsapp_channels'::regclass
  ) THEN
    ALTER TABLE meta.whatsapp_channels
      ADD CONSTRAINT meta_whatsapp_channels_nonblank_ids CHECK (
        (waba_id IS NULL OR btrim(waba_id) <> '')
        AND (phone_number_id IS NULL OR btrim(phone_number_id) <> '')
        AND (access_token_secret_ref IS NULL OR btrim(access_token_secret_ref) <> '')
        AND (app_secret_ref IS NULL OR btrim(app_secret_ref) <> '')
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'meta_whatsapp_channels_active_complete'
      AND conrelid = 'meta.whatsapp_channels'::regclass
  ) THEN
    ALTER TABLE meta.whatsapp_channels
      ADD CONSTRAINT meta_whatsapp_channels_active_complete CHECK (
        status <> 'active'
        OR (
          NULLIF(btrim(waba_id), '') IS NOT NULL
          AND NULLIF(btrim(phone_number_id), '') IS NOT NULL
          AND NULLIF(btrim(access_token_secret_ref), '') IS NOT NULL
          AND NULLIF(btrim(app_secret_ref), '') IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS meta.admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  channel_id uuid,
  actor_id text NOT NULL CHECK (btrim(actor_id) <> '' AND length(actor_id) <= 255),
  action text NOT NULL CHECK (
    action IN ('bootstrap', 'activate', 'disable', 'validation_failed')
  ),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_admin_audit_events_channel_account_fkey
    FOREIGN KEY (channel_id, aces_id)
    REFERENCES meta.whatsapp_channels(id, aces_id)
    ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_meta_admin_audit_account_created
  ON meta.admin_audit_events(aces_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meta_admin_audit_channel_created
  ON meta.admin_audit_events(channel_id, created_at DESC)
  WHERE channel_id IS NOT NULL;

ALTER TABLE meta.instance ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.whatsapp_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.whatsapp_provider_status_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta.admin_audit_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_instance_select ON meta.instance;
DROP POLICY IF EXISTS meta_instance_insert ON meta.instance;
DROP POLICY IF EXISTS meta_instance_update ON meta.instance;
DROP POLICY IF EXISTS meta_whatsapp_channels_select ON meta.whatsapp_channels;
DROP POLICY IF EXISTS meta_whatsapp_channels_insert ON meta.whatsapp_channels;
DROP POLICY IF EXISTS meta_whatsapp_channels_update ON meta.whatsapp_channels;
DROP POLICY IF EXISTS meta_whatsapp_channels_delete ON meta.whatsapp_channels;
DROP POLICY IF EXISTS meta_whatsapp_templates_select ON meta.whatsapp_templates;
DROP POLICY IF EXISTS meta_whatsapp_templates_insert ON meta.whatsapp_templates;
DROP POLICY IF EXISTS meta_whatsapp_templates_update ON meta.whatsapp_templates;
DROP POLICY IF EXISTS meta_whatsapp_templates_delete ON meta.whatsapp_templates;
DROP POLICY IF EXISTS meta_whatsapp_provider_status_events_select ON meta.whatsapp_provider_status_events;

REVOKE ALL ON TABLE meta.instance FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON TABLE meta.whatsapp_channels FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON TABLE meta.whatsapp_templates FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON TABLE meta.whatsapp_provider_status_events FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON TABLE meta.admin_audit_events FROM PUBLIC, anon, authenticated, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meta.instance TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meta.whatsapp_channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meta.whatsapp_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE meta.whatsapp_provider_status_events TO service_role;
GRANT SELECT, INSERT ON TABLE meta.admin_audit_events TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA meta
  REVOKE ALL ON TABLES FROM anon, authenticated, authenticator;

CREATE OR REPLACE FUNCTION crm.rpc_upsert_meta_whatsapp_channel(
  p_aces_id integer,
  p_instance_name text,
  p_waba_id text DEFAULT NULL,
  p_phone_number_id text DEFAULT NULL,
  p_business_id text DEFAULT NULL,
  p_display_phone_number text DEFAULT NULL,
  p_access_token_secret_ref text DEFAULT NULL,
  p_app_secret_ref text DEFAULT NULL,
  p_webhook_verify_token text DEFAULT NULL,
  p_status text DEFAULT 'draft'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_instance crm.instance%ROWTYPE;
  v_binding crm.instance_channels%ROWTYPE;
  v_channel meta.whatsapp_channels%ROWTYPE;
  v_binding_exists boolean := false;
  v_waba_id text := NULLIF(btrim(COALESCE(p_waba_id, '')), '');
  v_phone_number_id text := NULLIF(btrim(COALESCE(p_phone_number_id, '')), '');
  v_business_id text := NULLIF(btrim(COALESCE(p_business_id, '')), '');
  v_display_phone_number text := NULLIF(btrim(COALESCE(p_display_phone_number, '')), '');
  v_access_token_secret_ref text := NULLIF(btrim(COALESCE(p_access_token_secret_ref, '')), '');
  v_app_secret_ref text := NULLIF(btrim(COALESCE(p_app_secret_ref, '')), '');
  v_webhook_verify_token text := NULLIF(btrim(COALESCE(p_webhook_verify_token, '')), '');
BEGIN
  IF p_status NOT IN ('draft', 'active', 'disabled', 'error') THEN
    RAISE EXCEPTION 'Status Meta invalido' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_instance_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Instancia Meta obrigatoria' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_instance
  FROM crm.instance
  WHERE aces_id = p_aces_id
    AND instancia = btrim(p_instance_name)
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Instancia nao encontrada para esta conta' USING ERRCODE = 'P0002';
  END IF;

  SELECT *
  INTO v_binding
  FROM crm.instance_channels
  WHERE aces_id = p_aces_id
    AND instance_name = v_instance.instancia
  FOR UPDATE;

  v_binding_exists := FOUND;

  IF v_binding_exists AND v_binding.channel_type <> 'whatsapp' THEN
    RAISE EXCEPTION 'Instancia vinculada a canal nao WhatsApp' USING ERRCODE = '23514';
  END IF;

  IF p_status = 'active' AND (
    v_waba_id IS NULL
    OR v_phone_number_id IS NULL
    OR v_access_token_secret_ref IS NULL
    OR v_app_secret_ref IS NULL
  ) THEN
    RAISE EXCEPTION 'Configuracao Meta incompleta para ativacao' USING ERRCODE = '23514';
  END IF;

  INSERT INTO meta.whatsapp_channels (
    aces_id,
    instance_name,
    waba_id,
    phone_number_id,
    business_id,
    display_phone_number,
    access_token_secret_ref,
    app_secret_ref,
    webhook_verify_token,
    status,
    updated_at
  ) VALUES (
    p_aces_id,
    v_instance.instancia,
    v_waba_id,
    v_phone_number_id,
    v_business_id,
    v_display_phone_number,
    v_access_token_secret_ref,
    v_app_secret_ref,
    v_webhook_verify_token,
    p_status,
    now()
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    waba_id = COALESCE(EXCLUDED.waba_id, meta.whatsapp_channels.waba_id),
    phone_number_id = COALESCE(EXCLUDED.phone_number_id, meta.whatsapp_channels.phone_number_id),
    business_id = COALESCE(EXCLUDED.business_id, meta.whatsapp_channels.business_id),
    display_phone_number = COALESCE(EXCLUDED.display_phone_number, meta.whatsapp_channels.display_phone_number),
    access_token_secret_ref = COALESCE(EXCLUDED.access_token_secret_ref, meta.whatsapp_channels.access_token_secret_ref),
    app_secret_ref = COALESCE(EXCLUDED.app_secret_ref, meta.whatsapp_channels.app_secret_ref),
    webhook_verify_token = COALESCE(EXCLUDED.webhook_verify_token, meta.whatsapp_channels.webhook_verify_token),
    status = EXCLUDED.status,
    updated_at = now()
  RETURNING * INTO v_channel;

  IF NOT v_binding_exists THEN
    INSERT INTO crm.instance_channels (
      aces_id, instance_name, channel_type, provider, capability, status
    ) VALUES (
      p_aces_id,
      v_instance.instancia,
      'whatsapp',
      CASE WHEN p_status = 'active' THEN 'meta' ELSE 'evolution' END,
      CASE WHEN p_status IN ('disabled', 'error') THEN 'disabled' ELSE 'full' END,
      CASE WHEN p_status = 'active' THEN 'active' ELSE p_status END
    )
    RETURNING * INTO v_binding;
  ELSIF p_status = 'active' THEN
    UPDATE crm.instance_channels
    SET provider = 'meta',
        capability = 'full',
        status = 'active'
    WHERE id = v_binding.id
    RETURNING * INTO v_binding;
  ELSIF p_status IN ('disabled', 'error') AND v_binding.provider = 'meta' THEN
    UPDATE crm.instance_channels
    SET capability = 'disabled',
        status = p_status
    WHERE id = v_binding.id
    RETURNING * INTO v_binding;
  END IF;

  INSERT INTO meta.instance (aces_id, instance_name, provider, meta_channel_id, updated_at)
  VALUES (
    p_aces_id,
    v_instance.instancia,
    CASE WHEN p_status = 'active' THEN 'meta' ELSE v_binding.provider END,
    v_channel.id,
    now()
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    provider = CASE
      WHEN p_status = 'active' THEN 'meta'
      ELSE meta.instance.provider
    END,
    meta_channel_id = EXCLUDED.meta_channel_id,
    updated_at = now();

  RETURN to_jsonb(v_channel);
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_upsert_meta_whatsapp_channel(
  integer, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, authenticator;

GRANT EXECUTE ON FUNCTION crm.rpc_upsert_meta_whatsapp_channel(
  integer, text, text, text, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION crm.rpc_bootstrap_meta_whatsapp_channel(
  p_aces_id integer,
  p_instance_name text,
  p_waba_id text,
  p_phone_number_id text,
  p_business_id text,
  p_display_phone_number text,
  p_access_token_secret_ref text,
  p_app_secret_ref text,
  p_webhook_verify_token text,
  p_actor_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_channel jsonb;
BEGIN
  IF NULLIF(btrim(COALESCE(p_actor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Operador do bootstrap obrigatorio' USING ERRCODE = '22023';
  END IF;

  v_channel := crm.rpc_upsert_meta_whatsapp_channel(
    p_aces_id,
    p_instance_name,
    p_waba_id,
    p_phone_number_id,
    p_business_id,
    p_display_phone_number,
    p_access_token_secret_ref,
    p_app_secret_ref,
    p_webhook_verify_token,
    'draft'
  );

  INSERT INTO meta.admin_audit_events (
    aces_id,
    channel_id,
    actor_id,
    action,
    outcome,
    metadata
  ) VALUES (
    p_aces_id,
    (v_channel->>'id')::uuid,
    btrim(p_actor_id),
    'bootstrap',
    'succeeded',
    jsonb_build_object(
      'instanceName', v_channel->>'instance_name',
      'wabaId', v_channel->>'waba_id',
      'phoneNumberId', v_channel->>'phone_number_id'
    )
  );

  RETURN v_channel;
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_bootstrap_meta_whatsapp_channel(
  integer, text, text, text, text, text, text, text, text, text
) FROM PUBLIC, anon, authenticated, authenticator;

GRANT EXECUTE ON FUNCTION crm.rpc_bootstrap_meta_whatsapp_channel(
  integer, text, text, text, text, text, text, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION crm.rpc_set_meta_whatsapp_channel_status(
  p_aces_id integer,
  p_instance_name text,
  p_status text,
  p_actor_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_existing meta.whatsapp_channels%ROWTYPE;
  v_channel jsonb;
  v_action text;
BEGIN
  IF p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'Transicao administrativa Meta invalida' USING ERRCODE = '22023';
  END IF;

  IF NULLIF(btrim(COALESCE(p_actor_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Operador da transicao obrigatorio' USING ERRCODE = '22023';
  END IF;

  SELECT *
  INTO v_existing
  FROM meta.whatsapp_channels
  WHERE aces_id = p_aces_id
    AND instance_name = btrim(p_instance_name)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canal Meta nao encontrado para esta conta' USING ERRCODE = 'P0002';
  END IF;

  v_channel := crm.rpc_upsert_meta_whatsapp_channel(
    p_aces_id,
    v_existing.instance_name,
    v_existing.waba_id,
    v_existing.phone_number_id,
    v_existing.business_id,
    v_existing.display_phone_number,
    v_existing.access_token_secret_ref,
    v_existing.app_secret_ref,
    v_existing.webhook_verify_token,
    p_status
  );

  v_action := CASE WHEN p_status = 'active' THEN 'activate' ELSE 'disable' END;

  INSERT INTO meta.admin_audit_events (
    aces_id,
    channel_id,
    actor_id,
    action,
    outcome,
    metadata
  ) VALUES (
    p_aces_id,
    (v_channel->>'id')::uuid,
    btrim(p_actor_id),
    v_action,
    'succeeded',
    jsonb_build_object(
      'instanceName', v_channel->>'instance_name',
      'previousStatus', v_existing.status,
      'status', v_channel->>'status'
    )
  );

  RETURN v_channel;
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_set_meta_whatsapp_channel_status(
  integer, text, text, text
) FROM PUBLIC, anon, authenticated, authenticator;

GRANT EXECUTE ON FUNCTION crm.rpc_set_meta_whatsapp_channel_status(
  integer, text, text, text
) TO service_role;

CREATE OR REPLACE FUNCTION crm.rpc_disable_meta_whatsapp_channel(
  p_aces_id integer,
  p_instance_name text,
  p_actor_id text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT crm.rpc_set_meta_whatsapp_channel_status(
    p_aces_id,
    p_instance_name,
    'disabled',
    p_actor_id
  );
$$;

REVOKE ALL ON FUNCTION crm.rpc_disable_meta_whatsapp_channel(integer, text, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.rpc_disable_meta_whatsapp_channel(integer, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION meta.rpc_whatsapp_foundation_preflight()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'ok',
      to_regclass('meta.whatsapp_channels') IS NOT NULL
      AND to_regclass('meta.admin_audit_events') IS NOT NULL
      AND to_regclass('crm.instance_channels') IS NOT NULL
      AND NOT has_table_privilege('anon', 'meta.whatsapp_channels', 'SELECT')
      AND NOT has_table_privilege('authenticated', 'meta.whatsapp_channels', 'SELECT')
      AND has_table_privilege('service_role', 'meta.whatsapp_channels', 'SELECT')
      AND has_table_privilege('service_role', 'meta.admin_audit_events', 'INSERT')
      AND NOT has_function_privilege(
        'authenticated',
        'crm.rpc_upsert_meta_whatsapp_channel(integer,text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'crm.rpc_bootstrap_meta_whatsapp_channel(integer,text,text,text,text,text,text,text,text,text)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'crm.rpc_set_meta_whatsapp_channel_status(integer,text,text,text)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'authenticated',
        'crm.rpc_disable_meta_whatsapp_channel(integer,text,text)',
        'EXECUTE'
      ),
    'channelsRls', (
      SELECT relrowsecurity
      FROM pg_catalog.pg_class
      WHERE oid = 'meta.whatsapp_channels'::regclass
    ),
    'auditRls', (
      SELECT relrowsecurity
      FROM pg_catalog.pg_class
      WHERE oid = 'meta.admin_audit_events'::regclass
    ),
    'anonCanReadChannels', has_table_privilege('anon', 'meta.whatsapp_channels', 'SELECT'),
    'authenticatedCanReadChannels', has_table_privilege('authenticated', 'meta.whatsapp_channels', 'SELECT'),
    'serviceRoleCanReadChannels', has_table_privilege('service_role', 'meta.whatsapp_channels', 'SELECT'),
    'serviceRoleCanAudit', has_table_privilege('service_role', 'meta.admin_audit_events', 'INSERT'),
    'authenticatedCanBootstrap', has_function_privilege(
      'authenticated',
      'crm.rpc_bootstrap_meta_whatsapp_channel(integer,text,text,text,text,text,text,text,text,text)',
      'EXECUTE'
    ),
    'authenticatedCanChangeStatus', has_function_privilege(
      'authenticated',
      'crm.rpc_set_meta_whatsapp_channel_status(integer,text,text,text)',
      'EXECUTE'
    )
  );
$$;

REVOKE ALL ON FUNCTION meta.rpc_whatsapp_foundation_preflight()
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION meta.rpc_whatsapp_foundation_preflight() TO service_role;

COMMENT ON TABLE meta.admin_audit_events IS
  'Backend-only audit trail for Meta WhatsApp administrative operations.';
COMMENT ON COLUMN meta.whatsapp_channels.webhook_verify_token IS
  'Backend-only verify-token reference or legacy protected value. Never expose through administrative DTOs.';
COMMENT ON FUNCTION meta.rpc_whatsapp_foundation_preflight() IS
  'Validates the minimum secure Meta WhatsApp database foundation.';

NOTIFY pgrst, 'reload schema';
