-- The former admin switch was stored in is_active. Credentials now represent
-- whether the RB connection is configured; billing_enabled is the operational
-- switch for new billing pulls and dispatches.
UPDATE rb.connections
SET is_active = TRUE,
    updated_at = now()
WHERE rb_token_api IS NOT NULL
  AND is_active IS DISTINCT FROM TRUE;
