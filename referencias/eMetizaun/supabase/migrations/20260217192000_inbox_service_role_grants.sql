GRANT USAGE ON SCHEMA inbox TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
ON ALL TABLES IN SCHEMA inbox
TO authenticated, service_role;

GRANT USAGE, SELECT
ON ALL SEQUENCES IN SCHEMA inbox
TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA inbox
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA inbox
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated, service_role;
