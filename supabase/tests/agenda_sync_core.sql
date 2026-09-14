BEGIN;

SELECT plan(33);

SELECT has_schema('agenda_sync', 'schema privado da Agenda Universal existe');
SELECT has_table('agenda_sync', 'connections', 'conexoes existem');
SELECT has_table('agenda_sync', 'connection_units', 'escopos por unidade existem');
SELECT has_table('agenda_sync', 'connection_assignments', 'escopos independentes existem');
SELECT has_table('agenda_sync', 'credentials', 'credenciais criptografadas existem');
SELECT has_table('agenda_sync', 'resource_versions', 'versoes de recurso existem');
SELECT has_table('agenda_sync', 'outbox', 'outbox existe');
SELECT has_table('agenda_sync', 'deliveries', 'historico de entregas existe');
SELECT has_table('agenda_sync', 'inbound_events', 'idempotencia de entrada existe');

SELECT has_column('crm', 'empresas', 'agenda_metadata', 'unidade possui metadata canonica');
SELECT has_column('calendar', 'professionals', 'agenda_metadata', 'profissional possui metadata canonica');
SELECT has_column('calendar', 'professional_locations', 'agenda_metadata', 'assignment possui metadata canonica');

SELECT ok(NOT has_table_privilege('anon', 'agenda_sync.connections', 'SELECT'), 'anon nao acessa conexoes');
SELECT ok(NOT has_table_privilege('authenticated', 'agenda_sync.connections', 'SELECT'), 'frontend nao acessa conexoes diretamente');
SELECT ok(NOT has_table_privilege('anon', 'agenda_sync.credentials', 'SELECT'), 'anon nao acessa credenciais');
SELECT ok(NOT has_table_privilege('authenticated', 'agenda_sync.credentials', 'SELECT'), 'frontend nao acessa credenciais');
SELECT ok(has_table_privilege('service_role', 'agenda_sync.connections', 'SELECT'), 'backend acessa conexoes');
SELECT ok(has_table_privilege('service_role', 'agenda_sync.credentials', 'SELECT'), 'backend acessa credenciais');
SELECT ok(NOT has_schema_privilege('anon', 'agenda_sync', 'USAGE'), 'anon nao descobre o schema privado');
SELECT ok(NOT has_schema_privilege('authenticated', 'agenda_sync', 'USAGE'), 'frontend nao descobre o schema privado');
SELECT ok(has_schema_privilege('authenticator', 'agenda_sync', 'USAGE'), 'PostgREST pode descobrir somente o schema');

INSERT INTO crm.accounts (id, name, status)
VALUES (9981, 'Agenda Sync Test A', 'active'), (9982, 'Agenda Sync Test B', 'active');

INSERT INTO crm.empresas (id, aces_id, cnpj, legal_name, name, address, city, state)
VALUES
  ('99810000-0000-4000-8000-000000000001', 9981, '66972304000129', 'Unit A LTDA', 'Unit A', 'Rua A', 'Curitiba', 'PR'),
  ('99820000-0000-4000-8000-000000000001', 9982, '66972192000106', 'Unit B LTDA', 'Unit B', 'Rua B', 'Curitiba', 'PR');

INSERT INTO agenda_sync.connections (id, aces_id, name, scope_mode)
VALUES
  ('99810000-0000-4000-8000-000000000010', 9981, 'Connection A', 'selected_scope'),
  ('99820000-0000-4000-8000-000000000010', 9982, 'Connection B', 'selected_scope');

SELECT is(
  length((SELECT public_id FROM agenda_sync.connections WHERE id = '99810000-0000-4000-8000-000000000010')),
  48,
  'identificador publico possui 192 bits aleatorios codificados em hexadecimal'
);

SELECT lives_ok($$
  INSERT INTO agenda_sync.connection_units (connection_id, aces_id, unit_id)
  VALUES ('99810000-0000-4000-8000-000000000010', 9981, '99810000-0000-4000-8000-000000000001')
$$, 'vinculo do mesmo tenant e aceito');

SELECT throws_ok($$
  INSERT INTO agenda_sync.connection_units (connection_id, aces_id, unit_id)
  VALUES ('99810000-0000-4000-8000-000000000010', 9981, '99820000-0000-4000-8000-000000000001')
$$, '23503', NULL, 'vinculo entre tenants e recusado');

SELECT lives_ok($$
  INSERT INTO agenda_sync.credentials (
    connection_id, aces_id, direction, ciphertext, iv, auth_tag, key_version
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981, 'inbound',
    decode('01', 'hex'), decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'), 'v1'
  )
$$, 'credencial AES-GCM com formato valido e aceita');

SELECT throws_ok($$
  INSERT INTO agenda_sync.credentials (
    connection_id, aces_id, direction, ciphertext, iv, auth_tag, key_version
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981, 'outbound',
    decode('01', 'hex'), decode('01', 'hex'), decode(repeat('02', 16), 'hex'), 'v1'
  )
$$, '23514', NULL, 'IV AES-GCM fora do formato e recusado');

SELECT lives_ok($$
  INSERT INTO agenda_sync.resource_versions (aces_id, resource_type, resource_id, version)
  VALUES (9981, 'appointment', '99810000-0000-4000-8000-000000000020', 1)
$$, 'versao positiva e aceita');

SELECT throws_ok($$
  INSERT INTO agenda_sync.resource_versions (aces_id, resource_type, resource_id, version)
  VALUES (9981, 'unknown', '99810000-0000-4000-8000-000000000021', 1)
$$, '23514', NULL, 'tipo de recurso desconhecido e recusado');

SELECT lives_ok($$
  INSERT INTO agenda_sync.outbox (
    connection_id, aces_id, sequence, event_type, resource_type,
    resource_id, resource_version, envelope, payload_hash
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981, 1, 'appointment.created', 'appointment',
    '99810000-0000-4000-8000-000000000020', 1, '{}'::jsonb, repeat('a', 64)
  )
$$, 'evento completo entra na outbox');

SELECT throws_ok($$
  INSERT INTO agenda_sync.outbox (
    connection_id, aces_id, sequence, event_type, resource_type,
    resource_id, resource_version, envelope, payload_hash
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981, 2, 'appointment.created', 'appointment',
    '99810000-0000-4000-8000-000000000020', 0, '{}'::jsonb, repeat('a', 64)
  )
$$, '23514', NULL, 'evento operacional exige versao positiva');

SELECT throws_ok($$
  INSERT INTO agenda_sync.outbox (
    connection_id, aces_id, sequence, event_type, envelope, payload_hash
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981, 1, 'integration.test', '{}'::jsonb, repeat('b', 64)
  )
$$, '23505', NULL, 'sequencia da conexao e unica');

SELECT lives_ok($$
  INSERT INTO agenda_sync.inbound_events (
    connection_id, aces_id, event_id, event_type, payload_hash
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981,
    '99810000-0000-4000-8000-000000000030', 'appointment.status_reported', repeat('c', 64)
  )
$$, 'primeiro evento de entrada e aceito');

SELECT throws_ok($$
  INSERT INTO agenda_sync.inbound_events (
    connection_id, aces_id, event_id, event_type, payload_hash
  ) VALUES (
    '99810000-0000-4000-8000-000000000010', 9981,
    '99810000-0000-4000-8000-000000000030', 'appointment.status_reported', repeat('d', 64)
  )
$$, '23505', NULL, 'eventId de entrada e idempotente por conexao');

SELECT * FROM finish();
ROLLBACK;
