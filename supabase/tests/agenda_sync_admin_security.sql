BEGIN;

SELECT plan(36);

SELECT has_table('agenda_sync', 'connection_audit', 'auditoria administrativa existe');
SELECT has_function('agenda_sync', 'assert_admin_actor', ARRAY['integer', 'uuid'], 'ator admin e validado no banco');
SELECT has_function('agenda_sync', 'assert_connection_scope', ARRAY['integer', 'text', 'uuid[]', 'uuid[]'], 'escopo e validado no banco');
SELECT has_function('agenda_sync', 'create_connection', ARRAY['integer', 'uuid', 'text', 'text', 'text', 'uuid[]', 'uuid[]', 'text', 'bytea', 'bytea', 'bytea', 'text', 'bytea', 'bytea', 'bytea', 'text'], 'criacao transacional existe');
SELECT has_function('agenda_sync', 'update_connection', ARRAY['integer', 'uuid', 'uuid', 'text', 'text', 'text', 'uuid[]', 'uuid[]', 'text'], 'edicao transacional existe');
SELECT has_function('agenda_sync', 'rotate_connection_credential', ARRAY['integer', 'uuid', 'uuid', 'text', 'bytea', 'bytea', 'bytea', 'text'], 'rotacao transacional existe');
SELECT has_function('agenda_sync', 'enqueue_connection_test', ARRAY['integer', 'uuid', 'uuid'], 'teste entra na outbox');
SELECT has_function('agenda_sync', 'set_connection_operation', ARRAY['integer', 'uuid', 'uuid', 'text'], 'transicao operacional existe');

SELECT ok(NOT has_function_privilege('anon', 'agenda_sync.create_connection(integer,uuid,text,text,text,uuid[],uuid[],text,bytea,bytea,bytea,text,bytea,bytea,bytea,text)', 'EXECUTE'), 'anon nao cria conexao');
SELECT ok(NOT has_function_privilege('authenticated', 'agenda_sync.rotate_connection_credential(integer,uuid,uuid,text,bytea,bytea,bytea,text)', 'EXECUTE'), 'frontend nao rotaciona segredo');
SELECT ok(NOT has_function_privilege('authenticated', 'agenda_sync.enqueue_connection_test(integer,uuid,uuid)', 'EXECUTE'), 'frontend nao enfileira teste diretamente');
SELECT ok(has_function_privilege('service_role', 'agenda_sync.create_connection(integer,uuid,text,text,text,uuid[],uuid[],text,bytea,bytea,bytea,text,bytea,bytea,bytea,text)', 'EXECUTE'), 'backend cria conexao');
SELECT ok(has_function_privilege('service_role', 'agenda_sync.rotate_connection_credential(integer,uuid,uuid,text,bytea,bytea,bytea,text)', 'EXECUTE'), 'backend rotaciona segredo');
SELECT ok(NOT has_table_privilege('anon', 'agenda_sync.connection_audit', 'SELECT'), 'anon nao le auditoria');
SELECT ok(has_table_privilege('service_role', 'agenda_sync.connection_audit', 'SELECT'), 'backend le auditoria');

INSERT INTO crm.accounts (id, name, status)
VALUES (9983, 'Agenda Admin Test A', 'active'), (9984, 'Agenda Admin Test B', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('99830000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'agenda-admin-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('99830000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'agenda-seller-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('99840000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'agenda-admin-b@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('99831000-0000-4000-8000-000000000001', '99830000-0000-4000-8000-000000000001', 'agenda-admin-a@test.local', 'Agenda Admin A', 'ADMIN', 9983),
  ('99831000-0000-4000-8000-000000000002', '99830000-0000-4000-8000-000000000002', 'agenda-seller-a@test.local', 'Agenda Seller A', 'VENDEDOR', 9983),
  ('99841000-0000-4000-8000-000000000001', '99840000-0000-4000-8000-000000000001', 'agenda-admin-b@test.local', 'Agenda Admin B', 'ADMIN', 9984);

INSERT INTO crm.empresas (id, aces_id, cnpj, legal_name, name, address, city, state)
VALUES
  ('99832000-0000-4000-8000-000000000001', 9983, '66972304000129', 'Agenda Unit A LTDA', 'Agenda Unit A', 'Rua A', 'Curitiba', 'PR'),
  ('99842000-0000-4000-8000-000000000001', 9984, '66972192000106', 'Agenda Unit B LTDA', 'Agenda Unit B', 'Rua B', 'Curitiba', 'PR');

SELECT lives_ok($$
  SELECT agenda_sync.create_connection(
    9983, '99831000-0000-4000-8000-000000000001', 'Partner A', 'https://partner.example/events',
    'selected_scope', ARRAY['99832000-0000-4000-8000-000000000001']::uuid[], ARRAY[]::uuid[], 'America/Sao_Paulo',
    decode('01', 'hex'), decode(repeat('01', 12), 'hex'), decode(repeat('02', 16), 'hex'), 'v1',
    decode('03', 'hex'), decode(repeat('03', 12), 'hex'), decode(repeat('04', 16), 'hex'), 'v1'
  )
$$, 'admin cria conexao, escopo e dois segredos em uma transacao');

SELECT is((SELECT count(*)::integer FROM agenda_sync.connections WHERE aces_id = 9983), 1, 'conexao ficou no tenant correto');
SELECT is((SELECT count(*)::integer FROM agenda_sync.credentials WHERE aces_id = 9983), 2, 'segredos de entrada e saida foram persistidos');
SELECT is((SELECT count(*)::integer FROM agenda_sync.connection_units WHERE aces_id = 9983), 1, 'escopo foi persistido');
SELECT is((SELECT action FROM agenda_sync.connection_audit WHERE aces_id = 9983 ORDER BY created_at LIMIT 1), 'connection.created', 'criacao foi auditada sem segredo');

SELECT throws_ok($$
  SELECT agenda_sync.assert_admin_actor(9983, '99831000-0000-4000-8000-000000000002')
$$, '42501', 'AGENDA_ADMIN_FORBIDDEN', 'vendedor nao passa pela defesa no banco');

SELECT throws_ok($$
  SELECT agenda_sync.assert_admin_actor(9983, '99841000-0000-4000-8000-000000000001')
$$, '42501', 'AGENDA_ADMIN_FORBIDDEN', 'admin de outro tenant nao passa pela defesa no banco');

SELECT throws_ok($$
  SELECT agenda_sync.assert_connection_scope(
    9983, 'selected_scope', ARRAY['99842000-0000-4000-8000-000000000001']::uuid[], ARRAY[]::uuid[]
  )
$$, '23503', 'AGENDA_SCOPE_UNIT_INVALID', 'unidade de outro tenant e recusada');

SELECT throws_ok($$
  SELECT agenda_sync.assert_connection_scope(
    9983, 'all_resources', ARRAY['99832000-0000-4000-8000-000000000001']::uuid[], ARRAY[]::uuid[]
  )
$$, '22023', 'AGENDA_ALL_RESOURCES_SCOPE_MUST_BE_EMPTY', 'escopo total nao aceita selecoes ambiguas');

SELECT lives_ok($$
  SELECT agenda_sync.enqueue_connection_test(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983)
  )
$$, 'teste valido entra na fila');

SELECT is((SELECT event_type FROM agenda_sync.outbox WHERE aces_id = 9983), 'integration.test', 'outbox identifica teste sem dado pessoal');
SELECT ok(NOT ((SELECT envelope FROM agenda_sync.outbox WHERE aces_id = 9983) ? 'resourceVersion'), 'teste nao possui resourceVersion');

SELECT throws_ok($$
  SELECT agenda_sync.set_connection_operation(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983), 'activate'
  )
$$, '55000', 'AGENDA_CONNECTION_ACTIVATION_REQUIRES_TEST', 'ativacao exige teste entregue');

UPDATE agenda_sync.connections SET tested_at = now() WHERE aces_id = 9983;

SELECT is(
  agenda_sync.set_connection_operation(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983), 'activate'
  ),
  'syncing', 'ativacao aprovada entra em sincronizacao'
);

SELECT throws_ok($$
  SELECT agenda_sync.update_connection(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983),
    'Partner A Changed', 'https://partner.example/new', 'selected_scope',
    ARRAY['99832000-0000-4000-8000-000000000001']::uuid[], ARRAY[]::uuid[], 'America/Sao_Paulo'
  )
$$, '55000', 'AGENDA_CONNECTION_ACTIVE_UPDATE_FORBIDDEN', 'conexao sincronizando nao pode mudar URL ou escopo');

SELECT is(
  agenda_sync.set_connection_operation(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983), 'pause'
  ),
  'paused', 'sincronizacao pode ser pausada'
);

SELECT lives_ok($$
  SELECT agenda_sync.rotate_connection_credential(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983), 'inbound',
    decode('05', 'hex'), decode(repeat('05', 12), 'hex'), decode(repeat('06', 16), 'hex'), 'v1'
  )
$$, 'segredo e rotacionado atomicamente');

SELECT ok(
  (SELECT previous_valid_until > now() + interval '23 hours 59 minutes' FROM agenda_sync.credentials WHERE aces_id = 9983 AND direction = 'inbound'),
  'segredo anterior permanece valido por 24 horas'
);

SELECT lives_ok($$
  SELECT agenda_sync.update_connection(
    9983, '99831000-0000-4000-8000-000000000001',
    (SELECT id FROM agenda_sync.connections WHERE aces_id = 9983),
    'Partner A Changed', 'https://partner.example/new', 'selected_scope',
    ARRAY['99832000-0000-4000-8000-000000000001']::uuid[], ARRAY[]::uuid[], 'America/Sao_Paulo'
  )
$$, 'conexao pausada pode ser alterada');

SELECT ok((SELECT tested_at IS NULL FROM agenda_sync.connections WHERE aces_id = 9983), 'mudanca de URL invalida teste anterior');
SELECT is((SELECT scope_revision FROM agenda_sync.connections WHERE aces_id = 9983), 2::bigint, 'mudanca operacional incrementa revisao de escopo');

SELECT * FROM finish();
ROLLBACK;
