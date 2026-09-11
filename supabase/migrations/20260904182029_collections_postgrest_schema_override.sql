-- Keep the role-level PostgREST override aligned with config.toml. Role-level
-- settings take precedence over container environment/config values.
ALTER ROLE authenticator SET pgrst.db_schemas =
  'public,storage,graphql_public,crm,meta,calendar,agents,bi,locator,gupshup,rb,instagram,collections';
ALTER ROLE authenticator SET pgrst.db_extra_search_path =
  'public,extensions,crm,agents,bi,locator,meta,calendar,gupshup,rb,instagram,collections';
NOTIFY pgrst, 'reload config';
