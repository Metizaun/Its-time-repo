-- The classifier standardization migration can be inserted before the tenant
-- hardening migration in an existing production history. Reassert the final
-- privilege contract at the tip so arbitrary account bootstrap helpers remain
-- service-only regardless of migration insertion order.
REVOKE ALL ON FUNCTION crm.ensure_default_pipeline(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.ensure_default_pipeline(integer) TO service_role;

REVOKE ALL ON FUNCTION crm.fn_create_default_pipeline_stages(integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.fn_create_default_pipeline_stages(integer) TO service_role;
