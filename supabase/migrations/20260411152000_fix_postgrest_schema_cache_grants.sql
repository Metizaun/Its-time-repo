-- Permissoes para o papel usado pelo PostgREST montar o schema cache
GRANT USAGE ON SCHEMA Crm TO anon, authenticated, service_role, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA Crm
  TO anon, authenticated, service_role, authenticator;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA Crm
  TO anon, authenticated, service_role, authenticator;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA Crm
  TO anon, authenticated, service_role, authenticator;

ALTER DEFAULT PRIVILEGES IN SCHEMA Crm
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO anon, authenticated, service_role, authenticator;

ALTER DEFAULT PRIVILEGES IN SCHEMA Crm
  GRANT USAGE, SELECT ON SEQUENCES
  TO anon, authenticated, service_role, authenticator;

ALTER DEFAULT PRIVILEGES IN SCHEMA Crm
  GRANT EXECUTE ON FUNCTIONS
  TO anon, authenticated, service_role, authenticator;

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
