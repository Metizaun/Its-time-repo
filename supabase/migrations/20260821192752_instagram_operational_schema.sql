-- Set 1: backend-only Instagram operational schema.
-- Access tokens are encrypted by the backend with AES-256-GCM before insertion.

CREATE SCHEMA IF NOT EXISTS instagram;

REVOKE ALL ON SCHEMA instagram FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA instagram TO service_role, authenticator;

CREATE TABLE instagram.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  ig_user_id text NOT NULL CHECK (btrim(ig_user_id) <> ''),
  ig_username text,
  token_obtained_at timestamptz,
  token_expires_at timestamptz,
  last_refreshed_at timestamptz,
  health_status text NOT NULL DEFAULT 'pending'
    CHECK (health_status IN ('pending', 'healthy', 'warning', 'error', 'reconnect_required', 'disabled')),
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instagram_channels_channel_unique UNIQUE (channel_id),
  CONSTRAINT instagram_channels_channel_account_unique UNIQUE (channel_id, aces_id),
  CONSTRAINT instagram_channels_ig_user_unique UNIQUE (ig_user_id),
  CONSTRAINT instagram_channels_binding_account_fkey
    FOREIGN KEY (channel_id, aces_id)
    REFERENCES crm.instance_channels(id, aces_id)
    ON DELETE CASCADE
);

CREATE TABLE instagram.channel_credentials (
  channel_id uuid PRIMARY KEY
    REFERENCES instagram.channels(channel_id) ON DELETE CASCADE,
  access_token_ciphertext bytea NOT NULL,
  iv bytea NOT NULL CHECK (octet_length(iv) = 12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag) = 16),
  key_version text NOT NULL CHECK (btrim(key_version) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE instagram.oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash bytea NOT NULL UNIQUE,
  nonce_hash bytea NOT NULL UNIQUE,
  authorization_code_hash bytea UNIQUE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  initiated_by uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  return_path text NOT NULL CHECK (return_path ~ '^/[A-Za-z0-9/_?&=.%-]*$'),
  redirect_uri text NOT NULL CHECK (redirect_uri ~ '^https://'),
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'exchanging', 'succeeded', 'failed', 'expired')),
  completed_channel_id uuid REFERENCES instagram.channels(channel_id) ON DELETE SET NULL,
  error_code text,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instagram_oauth_states_instance_fkey
    FOREIGN KEY (aces_id, instance_name)
    REFERENCES crm.instance(aces_id, instancia)
    ON DELETE CASCADE
);

CREATE TABLE instagram.webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE CHECK (btrim(event_key) <> ''),
  channel_id uuid,
  aces_id integer,
  external_account_id text,
  event_type text NOT NULL,
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload_summary) = 'object'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'processed', 'failed', 'dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instagram_webhook_events_channel_account_fkey
    FOREIGN KEY (channel_id, aces_id)
    REFERENCES instagram.channels(channel_id, aces_id)
    MATCH FULL
    ON DELETE CASCADE
);

CREATE TABLE instagram.provider_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL,
  aces_id integer NOT NULL,
  event_key text NOT NULL UNIQUE CHECK (btrim(event_key) <> ''),
  provider_message_id text NOT NULL CHECK (btrim(provider_message_id) <> ''),
  status text NOT NULL CHECK (btrim(status) <> ''),
  provider_event_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload_summary) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT instagram_provider_status_channel_account_fkey
    FOREIGN KEY (channel_id, aces_id)
    REFERENCES instagram.channels(channel_id, aces_id)
    ON DELETE CASCADE
);

CREATE INDEX idx_instagram_channels_account_health
  ON instagram.channels(aces_id, health_status);
CREATE INDEX idx_instagram_channels_token_expiry
  ON instagram.channels(token_expires_at)
  WHERE health_status IN ('healthy', 'warning');
CREATE INDEX idx_instagram_oauth_states_pending_expiry
  ON instagram.oauth_states(status, expires_at)
  WHERE status IN ('pending', 'exchanging');
CREATE INDEX idx_instagram_webhook_events_claim
  ON instagram.webhook_events(status, available_at, lease_expires_at);
CREATE INDEX idx_instagram_provider_status_message
  ON instagram.provider_status_events(channel_id, provider_message_id, received_at DESC);

CREATE TRIGGER trg_instagram_channels_updated_at
BEFORE UPDATE ON instagram.channels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_instagram_channel_credentials_updated_at
BEFORE UPDATE ON instagram.channel_credentials
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_instagram_oauth_states_updated_at
BEFORE UPDATE ON instagram.oauth_states
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_instagram_webhook_events_updated_at
BEFORE UPDATE ON instagram.webhook_events
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE instagram.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram.channel_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram.oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram.provider_status_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA instagram FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA instagram FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA instagram FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA instagram TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA instagram TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA instagram
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA instagram
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA instagram
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA instagram
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA instagram
  GRANT USAGE, SELECT ON SEQUENCES TO service_role;

ALTER ROLE authenticator SET pgrst.db_schemas =
  'public,storage,graphql_public,crm,meta,calendar,agents,gupshup,rb,instagram';

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

COMMENT ON SCHEMA instagram IS
  'Backend-only operational data for Instagram Messaging.';
COMMENT ON TABLE instagram.channel_credentials IS
  'AES-256-GCM encrypted access tokens. Plaintext tokens are forbidden.';
