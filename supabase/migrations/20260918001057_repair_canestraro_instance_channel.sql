BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.instance
    WHERE aces_id = 11
      AND instancia = 'Canestraro'
  ) THEN
    INSERT INTO crm.instance_channels (
    aces_id,
    instance_name,
    channel_type,
    provider,
    capability,
    status
  ) VALUES (
    11,
    'Canestraro',
    'whatsapp',
    'evolution',
    'full',
    'active'
  )
    ON CONFLICT (aces_id, instance_name) DO UPDATE
    SET channel_type = EXCLUDED.channel_type,
        provider = EXCLUDED.provider,
        capability = EXCLUDED.capability,
        status = EXCLUDED.status,
        updated_at = now();
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
