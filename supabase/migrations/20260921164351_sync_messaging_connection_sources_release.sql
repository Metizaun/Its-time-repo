BEGIN;

CREATE OR REPLACE FUNCTION crm.sync_instance_channel_messaging_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.messaging_connection_id := COALESCE(NEW.messaging_connection_id, NEW.id);
  INSERT INTO crm.messaging_connections (
    id, aces_id, channel_type, provider, display_name, provider_external_id,
    legacy_instance_name, capability, status, metadata
  ) VALUES (
    NEW.messaging_connection_id, NEW.aces_id, NEW.channel_type, NEW.provider,
    NEW.instance_name, 'instance:' || NEW.instance_name, NEW.instance_name,
    NEW.capability, NEW.status, jsonb_build_object('source', 'instance_channels')
  )
  ON CONFLICT (id) DO UPDATE SET
    channel_type = excluded.channel_type,
    provider = excluded.provider,
    display_name = excluded.display_name,
    provider_external_id = excluded.provider_external_id,
    legacy_instance_name = excluded.legacy_instance_name,
    capability = excluded.capability,
    status = excluded.status,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_instance_channel_connection ON crm.instance_channels;
CREATE TRIGGER trg_sync_instance_channel_connection
BEFORE INSERT OR UPDATE OF channel_type, provider, instance_name, capability, status
ON crm.instance_channels
FOR EACH ROW EXECUTE FUNCTION crm.sync_instance_channel_messaging_connection();

CREATE OR REPLACE FUNCTION crm.sync_website_widget_messaging_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.messaging_connection_id := COALESCE(NEW.messaging_connection_id, NEW.id);
  INSERT INTO crm.messaging_connections (
    id, aces_id, channel_type, provider, display_name, provider_external_id,
    legacy_instance_name, capability, status, metadata
  ) VALUES (
    NEW.messaging_connection_id, NEW.aces_id, 'website', 'website', NEW.name,
    'widget:' || NEW.public_key, NEW.instance_name, 'full',
    CASE WHEN NEW.status = 'active' THEN 'active' ELSE 'disabled' END,
    jsonb_build_object('source', 'website_widget_connections')
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = excluded.display_name,
    provider_external_id = excluded.provider_external_id,
    legacy_instance_name = excluded.legacy_instance_name,
    status = excluded.status,
    updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_website_widget_connection ON crm.website_widget_connections;
CREATE TRIGGER trg_sync_website_widget_connection
BEFORE INSERT OR UPDATE OF name, public_key, instance_name, status
ON crm.website_widget_connections
FOR EACH ROW EXECUTE FUNCTION crm.sync_website_widget_messaging_connection();

CREATE OR REPLACE FUNCTION crm.sync_website_widget_agent_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE agents.agent_messaging_connections
  SET is_active = false, updated_at = now()
  WHERE connection_id = NEW.messaging_connection_id
    AND agent_id IS DISTINCT FROM NEW.agent_id
    AND is_active IS TRUE;

  IF NEW.agent_id IS NOT NULL THEN
    INSERT INTO agents.agent_messaging_connections (
      agent_id, connection_id, aces_id, is_active, created_by
    ) VALUES (
      NEW.agent_id, NEW.messaging_connection_id, NEW.aces_id, true, NEW.created_by
    )
    ON CONFLICT (agent_id, connection_id) DO UPDATE SET
      is_active = true,
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_website_widget_agent_binding ON crm.website_widget_connections;
CREATE TRIGGER trg_sync_website_widget_agent_binding
AFTER INSERT OR UPDATE OF agent_id, messaging_connection_id
ON crm.website_widget_connections
FOR EACH ROW EXECUTE FUNCTION crm.sync_website_widget_agent_binding();

NOTIFY pgrst, 'reload schema';

COMMIT;
