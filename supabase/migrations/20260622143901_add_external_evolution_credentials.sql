CREATE TABLE IF NOT EXISTS crm.instance_provider_credentials (
  instance_name text PRIMARY KEY REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  evolution_api_key text NOT NULL CHECK (btrim(evolution_api_key) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instance_provider_credentials_account_idx
  ON crm.instance_provider_credentials (aces_id);

ALTER TABLE crm.instance_provider_credentials ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE crm.instance_provider_credentials FROM PUBLIC;
REVOKE ALL ON TABLE crm.instance_provider_credentials FROM anon;
REVOKE ALL ON TABLE crm.instance_provider_credentials FROM authenticated;
REVOKE ALL ON TABLE crm.instance_provider_credentials FROM authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.instance_provider_credentials
  TO service_role;
