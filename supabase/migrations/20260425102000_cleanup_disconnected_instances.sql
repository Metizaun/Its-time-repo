WITH disconnected_instances AS (
  SELECT
    aces_id,
    instancia
  FROM crm.instance
  WHERE lower(COALESCE(status, '')) IN ('disconnected', 'close', 'closed', 'not_connected')
    OR lower(COALESCE(setup_status, '')) IN ('cancelled', 'expired')
)
UPDATE crm.leads l
SET
  instancia = NULL,
  updated_at = now()
FROM disconnected_instances di
WHERE l.aces_id = di.aces_id
  AND l.instancia = di.instancia;

WITH disconnected_instances AS (
  SELECT
    aces_id,
    instancia
  FROM crm.instance
  WHERE lower(COALESCE(status, '')) IN ('disconnected', 'close', 'closed', 'not_connected')
    OR lower(COALESCE(setup_status, '')) IN ('cancelled', 'expired')
)
UPDATE crm.message_history mh
SET instance = NULL
FROM disconnected_instances di
WHERE mh.aces_id = di.aces_id
  AND mh.instance = di.instancia;

WITH disconnected_instances AS (
  SELECT
    aces_id,
    instancia
  FROM crm.instance
  WHERE lower(COALESCE(status, '')) IN ('disconnected', 'close', 'closed', 'not_connected')
    OR lower(COALESCE(setup_status, '')) IN ('cancelled', 'expired')
)
DELETE FROM crm.automation_instance_dispatch_state aids
USING disconnected_instances di
WHERE aids.aces_id = di.aces_id
  AND aids.instance_name = di.instancia;

DELETE FROM crm.instance
WHERE lower(COALESCE(status, '')) IN ('disconnected', 'close', 'closed', 'not_connected')
   OR lower(COALESCE(setup_status, '')) IN ('cancelled', 'expired');
