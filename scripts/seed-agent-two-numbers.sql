-- Massa local idempotente para validar um agente principal em dois canais.
-- Cria a instancia ficticia TESTE_OTICA_C e vincula o agente "teste"
-- aos canais TESTE_OTICA_B e TESTE_OTICA_C.

BEGIN;

SET LOCAL statement_timeout = '2min';

INSERT INTO crm.instance (
  instancia,
  aces_id,
  color,
  status,
  setup_status,
  setup_started_at,
  setup_expires_at,
  created_by,
  connection_mode
)
SELECT
  'TESTE_OTICA_C',
  1,
  '#F59E0B',
  'connected',
  'connected',
  now(),
  now() + interval '30 days',
  agent.created_by,
  'local'
FROM agents.ai_agents AS agent
WHERE agent.aces_id = 1
  AND agent.name = 'teste'
  AND agent.agent_type = 'primary'
ORDER BY agent.created_at
LIMIT 1
ON CONFLICT (instancia) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    color = EXCLUDED.color,
    status = EXCLUDED.status,
    setup_status = EXCLUDED.setup_status,
    setup_started_at = EXCLUDED.setup_started_at,
    setup_expires_at = EXCLUDED.setup_expires_at,
    created_by = EXCLUDED.created_by,
    connection_mode = EXCLUDED.connection_mode,
    last_error = NULL;

DO $$
DECLARE
  v_agent_id uuid;
  v_existing_agent_id uuid;
BEGIN
  SELECT id
  INTO v_agent_id
  FROM agents.ai_agents
  WHERE aces_id = 1
    AND name = 'teste'
    AND agent_type = 'primary'
  ORDER BY created_at
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Agente principal "teste" nao encontrado na conta 1';
  END IF;

  SELECT binding.agent_id
  INTO v_existing_agent_id
  FROM agents.agent_messaging_connections AS binding
  JOIN crm.messaging_connections AS connection
    ON connection.id = binding.connection_id
   AND connection.aces_id = binding.aces_id
  WHERE binding.aces_id = 1
    AND binding.is_active
    AND connection.legacy_instance_name = 'TESTE_OTICA_B'
  LIMIT 1;

  IF v_existing_agent_id IS NOT NULL AND v_existing_agent_id <> v_agent_id THEN
    RAISE EXCEPTION 'TESTE_OTICA_B ja esta vinculado a outro agente principal';
  END IF;
END;
$$;

-- O trigger sincroniza cada canal com a conexao canonica correspondente.
INSERT INTO crm.instance_channels (
  id,
  aces_id,
  instance_name,
  channel_type,
  provider,
  capability,
  status,
  messaging_connection_id
)
VALUES (
  '61000000-0000-0000-0000-000000000003',
  1,
  'TESTE_OTICA_C',
  'whatsapp',
  'evolution',
  'full',
  'active',
  '61000000-0000-0000-0000-000000000003'
)
ON CONFLICT (id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    instance_name = EXCLUDED.instance_name,
    channel_type = EXCLUDED.channel_type,
    provider = EXCLUDED.provider,
    capability = EXCLUDED.capability,
    status = EXCLUDED.status,
    messaging_connection_id = EXCLUDED.messaging_connection_id;

DO $$
DECLARE
  v_agent_id uuid;
  v_created_by uuid;
  v_connection_id uuid;
  v_b_connection_id uuid;
BEGIN
  SELECT id, created_by
  INTO v_agent_id, v_created_by
  FROM agents.ai_agents
  WHERE aces_id = 1
    AND name = 'teste'
    AND agent_type = 'primary'
  ORDER BY created_at
  LIMIT 1;

  SELECT id
  INTO v_b_connection_id
  FROM crm.messaging_connections
  WHERE aces_id = 1
    AND legacy_instance_name = 'TESTE_OTICA_B'
    AND provider = 'evolution'
    AND channel_type = 'whatsapp';

  SELECT id
  INTO v_connection_id
  FROM crm.messaging_connections
  WHERE aces_id = 1
    AND legacy_instance_name = 'TESTE_OTICA_C'
    AND provider = 'evolution'
    AND channel_type = 'whatsapp';

  IF v_b_connection_id IS NULL OR v_connection_id IS NULL THEN
    RAISE EXCEPTION 'Conexoes canonicas de TESTE_OTICA_B/C nao foram criadas';
  END IF;

  INSERT INTO agents.agent_messaging_connections (
    agent_id,
    connection_id,
    aces_id,
    is_active,
    created_by
  )
  VALUES
    (v_agent_id, v_b_connection_id, 1, true, v_created_by),
    (v_agent_id, v_connection_id, 1, true, v_created_by)
  ON CONFLICT (agent_id, connection_id) DO UPDATE
  SET aces_id = EXCLUDED.aces_id,
      is_active = true,
      created_by = EXCLUDED.created_by,
      updated_at = now();
END;
$$;

COMMIT;
