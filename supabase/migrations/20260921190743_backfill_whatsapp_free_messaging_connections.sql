BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

INSERT INTO crm.instance_channels (
  aces_id,
  instance_name,
  channel_type,
  provider,
  capability,
  status,
  messaging_connection_id
)
SELECT
  instance.aces_id,
  instance.instancia,
  'whatsapp',
  'evolution',
  'full',
  'active',
  connection.id
FROM crm.instance AS instance
LEFT JOIN crm.messaging_connections AS connection
  ON connection.aces_id = instance.aces_id
 AND connection.provider = 'evolution'
 AND connection.provider_external_id = 'instance:' || instance.instancia
WHERE COALESCE(instance.connection_mode, 'local') <> 'instagram'
ON CONFLICT (aces_id, instance_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
