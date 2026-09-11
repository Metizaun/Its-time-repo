-- PostgREST introspects exposed schemas through authenticator. Keep all
-- table/function privileges private while allowing schema-cache discovery.
GRANT USAGE ON SCHEMA collections TO authenticator;
