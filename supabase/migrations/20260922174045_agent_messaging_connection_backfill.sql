BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

-- A previous release backfilled agent bindings only once, before all
-- messaging connections had been created. Repair any missing legacy-instance
-- bindings without taking over a connection that is already assigned.
INSERT INTO agents.agent_messaging_connections (
  agent_id,
  connection_id,
  aces_id,
  is_active,
  created_by
)
SELECT
  agent.id,
  connection.id,
  agent.aces_id,
  true,
  agent.created_by
FROM agents.ai_agents AS agent
JOIN crm.messaging_connections AS connection
  ON connection.aces_id = agent.aces_id
 AND connection.legacy_instance_name = agent.instance_name
 AND connection.channel_type <> 'legacy'
WHERE agent.agent_type = 'primary'
  AND agent.instance_name IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM agents.agent_messaging_connections AS current_binding
    WHERE current_binding.connection_id = connection.id
      AND current_binding.is_active IS TRUE
  )
ON CONFLICT (agent_id, connection_id) DO NOTHING;

-- Keep the legacy instance-to-connection compatibility path working for
-- channels created after an agent. Explicit bindings remain authoritative.
CREATE OR REPLACE FUNCTION crm.bind_agent_to_messaging_connection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  matched_agent agents.ai_agents%ROWTYPE;
BEGIN
  IF NEW.channel_type = 'legacy' OR NEW.legacy_instance_name IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM agents.agent_messaging_connections AS current_binding
    WHERE current_binding.connection_id = NEW.id
      AND current_binding.is_active IS TRUE
  ) THEN
    RETURN NEW;
  END IF;

  SELECT agent.*
  INTO matched_agent
  FROM agents.ai_agents AS agent
  WHERE agent.aces_id = NEW.aces_id
    AND agent.agent_type = 'primary'
    AND agent.instance_name = NEW.legacy_instance_name
  ORDER BY agent.created_at ASC, agent.id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  INSERT INTO agents.agent_messaging_connections (
    agent_id,
    connection_id,
    aces_id,
    is_active,
    created_by
  ) VALUES (
    matched_agent.id,
    NEW.id,
    NEW.aces_id,
    true,
    matched_agent.created_by
  )
  ON CONFLICT (agent_id, connection_id) DO UPDATE
    SET is_active = true,
        updated_at = now();

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm.bind_agent_to_messaging_connection() FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.bind_agent_to_messaging_connection() TO service_role;

DROP TRIGGER IF EXISTS trg_bind_agent_to_messaging_connection
  ON crm.messaging_connections;

CREATE TRIGGER trg_bind_agent_to_messaging_connection
AFTER INSERT OR UPDATE OF aces_id, channel_type, legacy_instance_name
ON crm.messaging_connections
FOR EACH ROW
EXECUTE FUNCTION crm.bind_agent_to_messaging_connection();

NOTIFY pgrst, 'reload schema';

COMMIT;
