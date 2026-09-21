BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

INSERT INTO crm.instance_channels (
  aces_id,
  instance_name,
  channel_type,
  provider,
  capability,
  status
)
SELECT
  instance.aces_id,
  instance.instancia,
  'whatsapp',
  'evolution',
  'full',
  'active'
FROM crm.instance AS instance
WHERE COALESCE(instance.connection_mode, 'local') <> 'instagram'
ON CONFLICT (aces_id, instance_name) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
