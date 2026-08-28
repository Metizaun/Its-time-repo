-- Set 1: neutral messaging-channel routing and external lead identities.
-- meta.instance remains synchronized only as a rollback compatibility surface;
-- runtime routing must read crm.instance_channels exclusively.

CREATE TABLE crm.instance_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  channel_type text NOT NULL
    CHECK (channel_type IN ('whatsapp', 'instagram')),
  provider text NOT NULL
    CHECK (provider IN ('evolution', 'meta', 'gupshup', 'instagram')),
  capability text NOT NULL DEFAULT 'full'
    CHECK (capability IN ('manual_only', 'full', 'disabled')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'disabled', 'error', 'reconnect_required')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instance_channels_account_instance_unique UNIQUE (aces_id, instance_name),
  CONSTRAINT instance_channels_id_account_unique UNIQUE (id, aces_id),
  CONSTRAINT instance_channels_instance_fkey
    FOREIGN KEY (aces_id, instance_name)
    REFERENCES crm.instance(aces_id, instancia)
    ON DELETE CASCADE,
  CONSTRAINT instance_channels_provider_matches_channel CHECK (
    (channel_type = 'whatsapp' AND provider IN ('evolution', 'meta', 'gupshup'))
    OR (channel_type = 'instagram' AND provider = 'instagram')
  ),
  CONSTRAINT instance_channels_instagram_manual_only CHECK (
    channel_type <> 'instagram' OR capability IN ('manual_only', 'disabled')
  )
);

INSERT INTO crm.instance_channels (
  aces_id,
  instance_name,
  channel_type,
  provider,
  capability,
  status
)
SELECT
  instance.aces_id,
  instance.instancia,
  'whatsapp',
  CASE
    WHEN meta_instance.provider IN ('evolution', 'meta', 'gupshup') THEN meta_instance.provider
    ELSE 'evolution'
  END,
  'full',
  'active'
FROM crm.instance AS instance
LEFT JOIN meta.instance AS meta_instance
  ON meta_instance.aces_id = instance.aces_id
 AND meta_instance.instance_name = instance.instancia
ON CONFLICT (aces_id, instance_name) DO NOTHING;

CREATE INDEX idx_instance_channels_account_provider_status
  ON crm.instance_channels(aces_id, provider, status);

CREATE INDEX idx_instance_channels_instance_name
  ON crm.instance_channels(instance_name);

CREATE TRIGGER trg_instance_channels_updated_at
BEFORE UPDATE ON crm.instance_channels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE crm.leads
  ALTER COLUMN contact_phone DROP NOT NULL;

ALTER TABLE crm.leads
  ADD CONSTRAINT leads_id_account_unique UNIQUE (id, aces_id);

CREATE TABLE crm.lead_channel_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  provider_user_id text NOT NULL
    CHECK (btrim(provider_user_id) <> '' AND length(provider_user_id) <= 255),
  display_username text,
  profile_picture_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_channel_identities_channel_user_unique
    UNIQUE (channel_id, provider_user_id),
  CONSTRAINT lead_channel_identities_lead_channel_unique
    UNIQUE (lead_id, channel_id),
  CONSTRAINT lead_channel_identities_lead_account_fkey
    FOREIGN KEY (lead_id, aces_id)
    REFERENCES crm.leads(id, aces_id)
    ON DELETE CASCADE,
  CONSTRAINT lead_channel_identities_channel_account_fkey
    FOREIGN KEY (channel_id, aces_id)
    REFERENCES crm.instance_channels(id, aces_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_lead_channel_identities_lead
  ON crm.lead_channel_identities(lead_id, channel_id);

CREATE INDEX idx_lead_channel_identities_account
  ON crm.lead_channel_identities(aces_id, channel_id);

CREATE TRIGGER trg_lead_channel_identities_updated_at
BEFORE UPDATE ON crm.lead_channel_identities
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DO $$
BEGIN
  ALTER TABLE crm.message_history DROP CONSTRAINT IF EXISTS message_history_provider_check;
  ALTER TABLE crm.message_history
    ADD CONSTRAINT message_history_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup', 'instagram'));

  ALTER TABLE crm.automation_executions DROP CONSTRAINT IF EXISTS automation_executions_provider_check;
  ALTER TABLE crm.automation_executions
    ADD CONSTRAINT automation_executions_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup', 'instagram'));

  ALTER TABLE crm.follow_up_tasks DROP CONSTRAINT IF EXISTS follow_up_tasks_provider_check;
  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_provider_check
    CHECK (provider IS NULL OR provider IN ('evolution', 'meta', 'gupshup', 'instagram'));
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_find_or_create_channel_lead(
  p_channel_id uuid,
  p_provider_user_id text,
  p_name text DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_display_username text DEFAULT NULL,
  p_profile_picture_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_channel crm.instance_channels%ROWTYPE;
  v_identity crm.lead_channel_identities%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_provider_user_id text := NULLIF(btrim(COALESCE(p_provider_user_id, '')), '');
  v_name text := NULLIF(btrim(COALESCE(p_name, '')), '');
  v_stage crm.pipeline_stages%ROWTYPE;
BEGIN
  IF v_provider_user_id IS NULL OR length(v_provider_user_id) > 255 THEN
    RAISE EXCEPTION 'Identidade externa invalida';
  END IF;

  SELECT *
  INTO v_channel
  FROM crm.instance_channels
  WHERE id = p_channel_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canal nao encontrado';
  END IF;

  IF v_channel.channel_type <> 'instagram' OR v_channel.provider <> 'instagram' THEN
    RAISE EXCEPTION 'Canal nao aceita identidade Instagram';
  END IF;

  IF v_channel.status <> 'active' OR v_channel.capability = 'disabled' THEN
    RAISE EXCEPTION 'Canal Instagram inativo';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_channel_id::text || ':' || v_provider_user_id, 0)
  );

  SELECT *
  INTO v_identity
  FROM crm.lead_channel_identities
  WHERE channel_id = p_channel_id
    AND provider_user_id = v_provider_user_id;

  IF FOUND THEN
    UPDATE crm.lead_channel_identities
    SET display_username = COALESCE(NULLIF(btrim(p_display_username), ''), display_username),
        profile_picture_url = COALESCE(NULLIF(btrim(p_profile_picture_url), ''), profile_picture_url)
    WHERE id = v_identity.id;

    SELECT * INTO v_lead
    FROM crm.leads
    WHERE id = v_identity.lead_id;

    RETURN jsonb_build_object(
      'created', false,
      'lead_id', v_lead.id,
      'identity_id', v_identity.id,
      'aces_id', v_channel.aces_id,
      'instance_name', v_channel.instance_name
    );
  END IF;

  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.users
    WHERE id = p_owner_id AND aces_id = v_channel.aces_id
  ) THEN
    RAISE EXCEPTION 'Responsavel nao pertence ao tenant do canal';
  END IF;

  IF p_stage_id IS NOT NULL THEN
    SELECT * INTO v_stage
    FROM crm.pipeline_stages
    WHERE id = p_stage_id AND aces_id = v_channel.aces_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa nao pertence ao tenant do canal';
    END IF;
  END IF;

  INSERT INTO crm.leads (
    aces_id,
    owner_id,
    name,
    contact_phone,
    status,
    stage_id,
    instancia,
    "Fonte",
    "Plataform",
    view
  )
  VALUES (
    v_channel.aces_id,
    p_owner_id,
    COALESCE(v_name, NULLIF(btrim(p_display_username), ''), 'Lead Instagram'),
    NULL,
    COALESCE(v_stage.name, 'Novo'),
    p_stage_id,
    v_channel.instance_name,
    'Instagram',
    'Instagram',
    TRUE
  )
  RETURNING * INTO v_lead;

  INSERT INTO crm.lead_channel_identities (
    aces_id,
    lead_id,
    channel_id,
    provider_user_id,
    display_username,
    profile_picture_url
  )
  VALUES (
    v_channel.aces_id,
    v_lead.id,
    v_channel.id,
    v_provider_user_id,
    NULLIF(btrim(p_display_username), ''),
    NULLIF(btrim(p_profile_picture_url), '')
  )
  RETURNING * INTO v_identity;

  RETURN jsonb_build_object(
    'created', true,
    'lead_id', v_lead.id,
    'identity_id', v_identity.id,
    'aces_id', v_channel.aces_id,
    'instance_name', v_channel.instance_name
  );
END;
$$;

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
  v_channel meta.whatsapp_channels%ROWTYPE;
  v_provider text;
BEGIN
  IF p_status NOT IN ('draft', 'active', 'disabled', 'error') THEN
    RAISE EXCEPTION 'Status Meta invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM crm.instance
    WHERE aces_id = p_aces_id AND instancia = p_instance_name
  ) THEN
    RAISE EXCEPTION 'Instancia nao encontrada para esta conta';
  END IF;

  INSERT INTO meta.whatsapp_channels (
    aces_id, instance_name, waba_id, phone_number_id, business_id,
    display_phone_number, access_token_secret_ref, app_secret_ref,
    webhook_verify_token, status, updated_at
  ) VALUES (
    p_aces_id, p_instance_name, NULLIF(btrim(p_waba_id), ''),
    NULLIF(btrim(p_phone_number_id), ''), NULLIF(btrim(p_business_id), ''),
    NULLIF(btrim(p_display_phone_number), ''), NULLIF(btrim(p_access_token_secret_ref), ''),
    NULLIF(btrim(p_app_secret_ref), ''), NULLIF(btrim(p_webhook_verify_token), ''),
    p_status, now()
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    waba_id = EXCLUDED.waba_id,
    phone_number_id = EXCLUDED.phone_number_id,
    business_id = EXCLUDED.business_id,
    display_phone_number = EXCLUDED.display_phone_number,
    access_token_secret_ref = EXCLUDED.access_token_secret_ref,
    app_secret_ref = EXCLUDED.app_secret_ref,
    webhook_verify_token = EXCLUDED.webhook_verify_token,
    status = EXCLUDED.status,
    updated_at = now()
  RETURNING * INTO v_channel;

  v_provider := CASE WHEN p_status = 'active' THEN 'meta' ELSE 'evolution' END;

  INSERT INTO crm.instance_channels (
    aces_id, instance_name, channel_type, provider, capability, status
  ) VALUES (
    p_aces_id, p_instance_name, 'whatsapp', v_provider, 'full', 'active'
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    channel_type = 'whatsapp',
    provider = EXCLUDED.provider,
    capability = 'full',
    status = 'active';

  INSERT INTO meta.instance (aces_id, instance_name, provider, meta_channel_id, updated_at)
  VALUES (p_aces_id, p_instance_name, v_provider, v_channel.id, now())
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    provider = EXCLUDED.provider,
    meta_channel_id = EXCLUDED.meta_channel_id,
    updated_at = now();

  RETURN to_jsonb(v_channel);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_upsert_gupshup_channel(
  p_aces_id integer,
  p_instance_name text,
  p_app_id text,
  p_app_name text,
  p_api_key text,
  p_phone_number text,
  p_status text DEFAULT 'draft'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_channel gupshup.channel%ROWTYPE;
  v_provider text;
BEGIN
  IF p_status NOT IN ('draft', 'active', 'disabled') THEN
    RAISE EXCEPTION 'Status Gupshup invalido';
  END IF;

  IF NULLIF(btrim(p_app_name), '') IS NULL
     OR NULLIF(btrim(p_api_key), '') IS NULL
     OR NULLIF(btrim(p_phone_number), '') IS NULL THEN
    RAISE EXCEPTION 'Configuracao Gupshup incompleta';
  END IF;

  IF p_status = 'active' AND NULLIF(btrim(p_app_id), '') IS NULL THEN
    RAISE EXCEPTION 'appId Gupshup obrigatorio para ativar o canal';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM crm.instance
    WHERE aces_id = p_aces_id AND instancia = p_instance_name
  ) THEN
    RAISE EXCEPTION 'Instancia nao encontrada para esta conta';
  END IF;

  INSERT INTO gupshup.channel (
    aces_id, instance_name, app_id, app_name, api_key, phone_number, status, updated_at
  ) VALUES (
    p_aces_id, p_instance_name, NULLIF(btrim(p_app_id), ''), btrim(p_app_name),
    btrim(p_api_key), btrim(p_phone_number), p_status, now()
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    app_id = EXCLUDED.app_id,
    app_name = EXCLUDED.app_name,
    api_key = EXCLUDED.api_key,
    phone_number = EXCLUDED.phone_number,
    status = EXCLUDED.status,
    updated_at = now()
  RETURNING * INTO v_channel;

  v_provider := CASE WHEN p_status = 'active' THEN 'gupshup' ELSE 'evolution' END;

  INSERT INTO crm.instance_channels (
    aces_id, instance_name, channel_type, provider, capability, status
  ) VALUES (
    p_aces_id, p_instance_name, 'whatsapp', v_provider, 'full', 'active'
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    channel_type = 'whatsapp',
    provider = EXCLUDED.provider,
    capability = 'full',
    status = 'active';

  INSERT INTO meta.instance (aces_id, instance_name, provider, updated_at)
  VALUES (p_aces_id, p_instance_name, v_provider, now())
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    provider = EXCLUDED.provider,
    updated_at = now();

  RETURN to_jsonb(v_channel);
END;
$$;

ALTER TABLE crm.instance_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_channel_identities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE crm.instance_channels FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE crm.lead_channel_identities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE crm.instance_channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE crm.lead_channel_identities TO service_role;

REVOKE ALL ON FUNCTION crm.rpc_find_or_create_channel_lead(uuid, text, text, uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.rpc_upsert_meta_whatsapp_channel(integer, text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.rpc_upsert_gupshup_channel(integer, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION crm.rpc_find_or_create_channel_lead(uuid, text, text, uuid, uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_upsert_meta_whatsapp_channel(integer, text, text, text, text, text, text, text, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_upsert_gupshup_channel(integer, text, text, text, text, text, text)
  TO service_role;

COMMENT ON TABLE crm.instance_channels IS
  'Canonical provider and capability binding for every CRM messaging instance.';
COMMENT ON TABLE crm.lead_channel_identities IS
  'Provider-scoped lead identities. Instagram stores IGSID in provider_user_id.';
COMMENT ON COLUMN crm.leads.contact_phone IS
  'Nullable for non-phone channels. Manual lead creation continues to require a phone.';

;
