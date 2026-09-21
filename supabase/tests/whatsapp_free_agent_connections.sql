BEGIN;

SELECT plan(10);

INSERT INTO crm.accounts (id, name, status)
VALUES (9898, 'WhatsApp Free Connections Test', 'active');

INSERT INTO crm.instance (
  aces_id,
  instancia,
  connection_mode,
  status,
  setup_status
) VALUES
  (9898, 'whatsapp-free-one', 'local', 'connected', 'connected'),
  (9898, 'whatsapp-free-two', 'local', 'connected', 'connected');

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
WHERE instance.aces_id = 9898
  AND COALESCE(instance.connection_mode, 'local') <> 'instagram'
  AND NOT EXISTS (
    SELECT 1
    FROM crm.instance_channels AS existing_channel
    WHERE existing_channel.aces_id = instance.aces_id
      AND existing_channel.instance_name = instance.instancia
  )
ON CONFLICT (aces_id, instance_name) DO NOTHING;

SELECT is(
  (SELECT count(*)::integer FROM crm.instance_channels WHERE aces_id = 9898),
  2,
  'duas instancias Free geram dois canais'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.instance_channels WHERE aces_id = 9898 AND channel_type = 'whatsapp'),
  2,
  'os dois canais sao WhatsApp'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.instance_channels WHERE aces_id = 9898 AND provider = 'evolution'),
  2,
  'os dois canais usam Evolution'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.instance_channels WHERE aces_id = 9898 AND capability = 'full' AND status = 'active'),
  2,
  'os dois canais ficam ativos com capacidade completa'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.messaging_connections WHERE aces_id = 9898),
  2,
  'o trigger disponibiliza as duas conexoes no seletor'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM crm.messaging_connections
    WHERE aces_id = 9898
      AND legacy_instance_name IN ('whatsapp-free-one', 'whatsapp-free-two')
      AND channel_type = 'whatsapp'
      AND provider = 'evolution'
      AND status = 'active'
  ),
  2,
  'as conexoes preservam a identidade das instancias Free'
);

INSERT INTO agents.ai_agents (
  id,
  aces_id,
  instance_name,
  name,
  system_prompt,
  model,
  is_active,
  agent_type
) VALUES (
  '98980000-0000-4000-8000-000000000001',
  9898,
  'whatsapp-free-one',
  'WhatsApp Free Agent',
  'Atenda com objetividade.',
  'gemini-2.5-flash',
  true,
  'primary'
);

INSERT INTO agents.agent_messaging_connections (
  agent_id,
  connection_id,
  aces_id,
  is_active
)
SELECT
  '98980000-0000-4000-8000-000000000001',
  connection.id,
  9898,
  true
FROM crm.messaging_connections AS connection
WHERE connection.aces_id = 9898;

SELECT is(
  (
    SELECT count(*)::integer
    FROM agents.agent_messaging_connections
    WHERE agent_id = '98980000-0000-4000-8000-000000000001'
      AND is_active IS TRUE
  ),
  2,
  'o mesmo agente aceita as duas conexoes Evolution'
);

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
WHERE instance.aces_id = 9898
  AND COALESCE(instance.connection_mode, 'local') <> 'instagram'
  AND NOT EXISTS (
    SELECT 1
    FROM crm.instance_channels AS existing_channel
    WHERE existing_channel.aces_id = instance.aces_id
      AND existing_channel.instance_name = instance.instancia
  )
ON CONFLICT (aces_id, instance_name) DO NOTHING;

SELECT is(
  (SELECT count(*)::integer FROM crm.instance_channels WHERE aces_id = 9898),
  2,
  'repetir o upsert nao duplica canais'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.messaging_connections WHERE aces_id = 9898),
  2,
  'repetir o upsert nao duplica conexoes'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM agents.agent_messaging_connections
    WHERE agent_id = '98980000-0000-4000-8000-000000000001'
  ),
  2,
  'repetir o upsert preserva os dois vinculos do agente'
);

SELECT * FROM finish();
ROLLBACK;
