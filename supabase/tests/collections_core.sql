BEGIN;

SELECT plan(61);

SELECT has_schema('collections', 'schema canonico existe');
SELECT has_table('collections', 'source_connections', 'fontes canonicas existem');
SELECT has_table('collections', 'operational_events', 'eventos operacionais existem');
SELECT has_table('collections', 'contact_communication_controls', 'pausa transversal existe');
SELECT has_table('collections', 'rb_migration_runs', 'auditoria da migracao RB existe');
SELECT has_function('collections', 'rebuild_case_projections',
  ARRAY['integer', 'uuid', 'uuid', 'text', 'uuid'], 'reconstrucao auditada existe');
SELECT has_function('collections', 'set_contact_communication_status',
  ARRAY['integer', 'text', 'text', 'text', 'uuid'], 'pausa por contato existe');
SELECT has_function('collections', 'get_case_route_status', ARRAY['uuid'], 'diagnostico de rota existe');
SELECT has_function('collections', 'record_ingestion_failure',
  ARRAY['uuid', 'text', 'text', 'text', 'jsonb', 'integer', 'text', 'text'], 'auditoria de falha existe');
SELECT has_function('collections', 'get_operational_health', ARRAY['integer'], 'saude operacional existe');
SELECT has_function('collections', 'claim_due_pull_sources',
  ARRAY['text', 'integer', 'integer'], 'lease de pull existe');
SELECT has_function('collections', 'resolve_source_dispatcher',
  ARRAY['uuid'], 'resolucao de dispatcher por fonte existe');
SELECT has_table('collections', 'rb_funnel_mappings', 'mapeamento shadow de funis RB existe');
SELECT has_function('collections', 'clone_rb_funnel_for_shadow',
  ARRAY['integer', 'uuid', 'uuid'], 'clone RB canonico e transacional');
SELECT has_function('collections', 'activate_canonical_dispatcher_after_cutover',
  ARRAY['integer', 'text', 'uuid'], 'cutover canonico possui guarda transacional');
SELECT has_function('collections', 'claim_expired_spreadsheet_imports',
  ARRAY['integer'], 'retencao de arquivos possui claim no backend');
SELECT has_function('collections', 'set_account_business_timezone',
  ARRAY['integer', 'text', 'uuid'], 'timezone de negocio e configuravel por conta');
SELECT has_function('collections', 'get_collection_context_authorized',
  ARRAY['integer', 'uuid', 'uuid', 'uuid'], 'contexto canonico exige tool e caso autorizados');

SELECT ok(
  NOT has_table_privilege('anon', 'collections.source_connections', 'SELECT'),
  'anon nao acessa fontes'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'collections.receivables', 'SELECT'),
  'frontend autenticado nao acessa titulos'
);
SELECT ok(
  has_table_privilege('service_role', 'collections.receivables', 'SELECT'),
  'backend acessa titulos'
);
SELECT ok(
  NOT has_table_privilege('anon', 'collections.source_credentials', 'SELECT'),
  'anon nao acessa credenciais'
);
SELECT ok(
  NOT has_function_privilege('anon', 'collections.ingest_envelope(uuid,text,text,text,jsonb,jsonb)', 'EXECUTE'),
  'anon nao executa ingestao privilegiada'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'collections.claim_outbox(text,integer,integer)', 'EXECUTE'),
  'frontend nao reclama outbox'
);
SELECT ok(
  has_function_privilege('service_role', 'collections.claim_outbox(text,integer,integer)', 'EXECUTE'),
  'worker executa claim do outbox'
);
SELECT ok(
  pg_get_functiondef('collections.get_collection_context(uuid,uuid)'::regprocedure) NOT LIKE '%source_metadata%'
    AND pg_get_functiondef('collections.get_collection_context(uuid,uuid)'::regprocedure) NOT LIKE '%metadata%',
  'contexto da cobranca nao incorpora metadata arbitraria'
);

INSERT INTO crm.accounts (id, name, status) VALUES
  (9895, 'Collections Test A', 'active'),
  (9896, 'Collections Test B', 'active');

INSERT INTO collections.source_connections (
  id, public_id, aces_id, name, source_type, delivery_mode,
  default_ingestion_mode, capabilities, stale_after_minutes
) VALUES
  ('98950000-0000-4000-8000-000000000001', 'collections-test-a', 9895,
   'Webhook A', 'webhook', 'push', 'incremental',
   '{"supportsAuthoritativeSnapshot":false,"suppliesPaymentInstructions":true}'::jsonb, 1440),
  ('98950000-0000-4000-8000-000000000002', 'collections-test-snapshot', 9895,
   'File A', 'file', 'file', 'snapshot',
   '{"supportsAuthoritativeSnapshot":true,"suppliesPaymentInstructions":true}'::jsonb, 1440),
  ('98960000-0000-4000-8000-000000000001', 'collections-test-b', 9896,
   'Webhook B', 'webhook', 'push', 'incremental',
   '{"supportsAuthoritativeSnapshot":false}'::jsonb, 1440);

INSERT INTO collections.source_connections (
  id, public_id, aces_id, name, source_type, delivery_mode,
  default_ingestion_mode, capabilities, config, stale_after_minutes
) VALUES
  ('98950000-0000-4000-8000-000000000003', 'collections-test-rb', 9895,
   'RB A', 'rb', 'pull', 'incremental', '{}',
   '{"legacyConnectionId":"98950000-0000-4000-8000-000000000004","dispatcherMode":"legacy_rb"}', 1440);

INSERT INTO rb.connections (
  id, aces_id, rb_token_api, rb_empresa_ids, is_active, billing_enabled
) VALUES ('98950000-0000-4000-8000-000000000004', 9895, 'collections-test-rb-token', '["empresa-a"]'::jsonb, true, true);

SELECT is(
  collections.resolve_source_dispatcher('98950000-0000-4000-8000-000000000001'),
  'canonical', 'webhook ativo usa fluxo automatico'
);

SELECT is(
  collections.resolve_source_dispatcher('98950000-0000-4000-8000-000000000002'),
  'canonical', 'arquivo ativo usa fluxo automatico'
);

SELECT is(
  collections.resolve_source_dispatcher('98950000-0000-4000-8000-000000000003'),
  'legacy_rb', 'RB sem migracao permanece no legado'
);

UPDATE collections.source_connections
SET config = '{"legacyConnectionId":"98950000-0000-4000-8000-000000000004","dispatcherMode":"canonical"}'::jsonb
WHERE id = '98950000-0000-4000-8000-000000000003';

SELECT is(
  collections.resolve_source_dispatcher('98950000-0000-4000-8000-000000000003'),
  'canonical', 'RB preparado usa fluxo automatico'
);

UPDATE collections.source_connections
SET status = 'paused'
WHERE id = '98950000-0000-4000-8000-000000000003';

SELECT is(
  collections.resolve_source_dispatcher('98950000-0000-4000-8000-000000000003'),
  'paused', 'pausa individual bloqueia somente a fonte'
);

INSERT INTO collections.runtime_controls (aces_id, active_dispatcher, change_reason)
VALUES (9895, 'paused', 'Teste de pausa global');

SELECT is(
  collections.resolve_source_dispatcher('98950000-0000-4000-8000-000000000001'),
  'paused', 'pausa global bloqueia a fonte webhook'
);

DELETE FROM collections.runtime_controls WHERE aces_id = 9895;

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000001', 'event-1', repeat('a', 64),
    'incremental', '{}'::jsonb,
    '[{"schemaVersion":"1.0","source":{"connectionId":"98950000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-04T12:00:00-03:00"},"customer":{"externalId":"customer-1","name":"Cliente A","phone":"41999990001"},"creditor":{"externalId":"creditor-1","name":"Loja A"},"receivable":{"externalId":"title-1","remainingAmount":"100.00","currency":"BRL","dueDate":"2026-09-01","status":"open"}}]'::jsonb
  )
$$, 'ingestao inicial funciona');

SELECT is(
  (SELECT count(*)::integer FROM collections.ingestion_runs
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001'),
  1, 'uma execucao foi auditada'
);

SELECT is(
  (SELECT count(*)::integer FROM collections.receivables
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001'),
  1, 'um titulo foi persistido'
);

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000001', 'event-1', repeat('a', 64),
    'incremental', '{}'::jsonb,
    '[{"schemaVersion":"1.0","source":{"connectionId":"98950000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-04T12:00:00-03:00"},"customer":{"externalId":"customer-1","name":"Cliente A","phone":"41999990001"},"creditor":{"externalId":"creditor-1"},"receivable":{"externalId":"title-1","remainingAmount":"100.00","currency":"BRL","dueDate":"2026-09-01","status":"open"}}]'::jsonb
  )
$$, 'repeticao identica e idempotente');

SELECT is(
  (SELECT count(*)::integer FROM collections.ingestion_runs
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001'),
  1, 'idempotencia nao duplica a auditoria'
);

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000001', 'event-old', repeat('b', 64),
    'incremental', '{}'::jsonb,
    '[{"schemaVersion":"1.0","source":{"connectionId":"98950000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-03T12:00:00-03:00"},"customer":{"externalId":"customer-1","name":"Cliente antigo","phone":"41999990001"},"creditor":{"externalId":"creditor-1"},"receivable":{"externalId":"title-1","remainingAmount":"1.00","currency":"BRL","dueDate":"2026-09-01","status":"settled"}}]'::jsonb
  )
$$, 'evento antigo e aceito para auditoria');

SELECT is(
  (SELECT remaining_amount::text FROM collections.receivables
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001' AND external_receivable_id = 'title-1'),
  '100.00', 'evento antigo nao sobrescreve o mais novo'
);

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000001', 'event-empty', repeat('c', 64),
    'incremental', '{}'::jsonb, '[]'::jsonb
  )
$$, 'incremental vazio nao falha');

SELECT is(
  (SELECT record_status FROM collections.receivables
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001' AND external_receivable_id = 'title-1'),
  'current', 'ausencia incremental nao altera o titulo'
);

SELECT is(
  (collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000001', 'snapshot-forbidden', repeat('d', 64),
    'snapshot', '{}'::jsonb, '[]'::jsonb
  )->>'accepted')::boolean,
  false, 'snapshot sem capacidade e rejeitado'
);

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000002', 'snapshot-seed', repeat('e', 64),
    'incremental', '{}'::jsonb,
    '[{"schemaVersion":"1.0","source":{"connectionId":"98950000-0000-4000-8000-000000000002","sourceUpdatedAt":"2026-09-04T12:00:00-03:00"},"customer":{"externalId":"customer-s","name":"Cliente S","phone":"41999990002"},"creditor":{"externalId":"creditor-s"},"receivable":{"externalId":"title-s","remainingAmount":"50.00","currency":"BRL","dueDate":"2026-09-02","status":"open"}}]'::jsonb
  )
$$, 'fonte de snapshot recebe estado inicial');

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000002', 'snapshot-empty', repeat('f', 64),
    'snapshot', '{}'::jsonb, '[]'::jsonb
  )
$$, 'snapshot autoritativo integral e aceito');

SELECT is(
  (SELECT record_status FROM collections.receivables
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000002' AND external_receivable_id = 'title-s'),
  'not_present', 'ausencia em snapshot vira not_present'
);

SELECT is(
  (SELECT financial_status FROM collections.receivables
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000002' AND external_receivable_id = 'title-s'),
  'open', 'not_present nunca vira pagamento'
);

SELECT throws_ok($$
  INSERT INTO collections.cases (
    aces_id, source_connection_id, external_customer_id, creditor_external_id,
    customer_name, customer_phone, last_source_update_at
  ) VALUES (
    9896, '98950000-0000-4000-8000-000000000001', 'cross-tenant', 'creditor',
    'Cross tenant', '41999990003', now()
  )
$$, '23503', NULL, 'constraint bloqueia vinculo entre contas');

SELECT lives_ok($$
  SELECT collections.rebuild_case_projections(9895, NULL, NULL, 'pgTAP', NULL)
$$, 'projecoes podem ser reconstruidas por conta');

INSERT INTO collections.outbox (
  id, aces_id, topic, aggregate_type, aggregate_id, idempotency_key
) VALUES (
  '98950000-0000-4000-8000-000000000099', 9895, 'test.lease', 'test',
  '98950000-0000-4000-8000-000000000099', 'collections-test-lease'
);

SELECT is(
  (SELECT count(*)::integer FROM collections.claim_outbox('worker-a', 500, 60)
   WHERE id = '98950000-0000-4000-8000-000000000099'),
  1, 'primeiro worker reclama o outbox'
);

SELECT is(
  (SELECT count(*)::integer FROM collections.claim_outbox('worker-b', 500, 60)
   WHERE id = '98950000-0000-4000-8000-000000000099'),
  0, 'lease impede claim concorrente'
);

UPDATE collections.outbox SET locked_at = now() - interval '2 minutes'
WHERE id = '98950000-0000-4000-8000-000000000099';

SELECT is(
  (SELECT count(*)::integer FROM collections.claim_outbox('worker-b', 500, 60)
   WHERE id = '98950000-0000-4000-8000-000000000099'),
  1, 'lease expirado e recuperado'
);

SELECT lives_ok($$
  SELECT collections.set_contact_communication_status(
    9895, '41 99999-0001', 'paused', 'Contestacao em teste', NULL
  )
$$, 'pausa transversal funciona');

SELECT is(
  (SELECT communication_status FROM collections.cases
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001'
     AND external_customer_id = 'customer-1'),
  'paused', 'todos os casos do contato ficam pausados'
);

SELECT lives_ok($$
  SELECT collections.set_contact_communication_status(
    9895, '41 99999-0001', 'active', 'Contestacao resolvida', NULL
  )
$$, 'retomada transversal funciona');

SELECT is(
  (SELECT communication_status FROM collections.cases
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001'
     AND external_customer_id = 'customer-1'),
  'eligible', 'caso fresco aberto volta a elegivel'
);

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98950000-0000-4000-8000-000000000001', 'event-settled', repeat('1', 64),
    'incremental', '{}'::jsonb,
    '[{"schemaVersion":"1.0","source":{"connectionId":"98950000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-05T12:00:00-03:00"},"customer":{"externalId":"customer-1","name":"Cliente A","phone":"41999990001"},"creditor":{"externalId":"creditor-1"},"receivable":{"externalId":"title-1","remainingAmount":"0.00","currency":"BRL","dueDate":"2026-09-01","status":"settled"}}]'::jsonb
  )
$$, 'baixa explicita e aplicada');

SELECT is(
  (SELECT communication_status FROM collections.cases
   WHERE source_connection_id = '98950000-0000-4000-8000-000000000001'
     AND external_customer_id = 'customer-1'),
  'completed', 'baixa encerra comunicacao do caso'
);

SELECT lives_ok($$
  SELECT collections.ingest_envelope(
    '98960000-0000-4000-8000-000000000001', 'status-set', repeat('2', 64),
    'incremental', '{}'::jsonb,
    '[
      {"schemaVersion":"1.0","source":{"connectionId":"98960000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-05T12:00:00-03:00"},"customer":{"externalId":"c-cancelled","name":"C","phone":"41999990010"},"creditor":{"externalId":"cred"},"receivable":{"externalId":"t-cancelled","remainingAmount":"10.00","currency":"BRL","dueDate":"2026-09-01","status":"cancelled"}},
      {"schemaVersion":"1.0","source":{"connectionId":"98960000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-05T12:00:00-03:00"},"customer":{"externalId":"c-suspended","name":"S","phone":"41999990011"},"creditor":{"externalId":"cred"},"receivable":{"externalId":"t-suspended","remainingAmount":"10.00","currency":"BRL","dueDate":"2026-09-01","status":"suspended"}},
      {"schemaVersion":"1.0","source":{"connectionId":"98960000-0000-4000-8000-000000000001","sourceUpdatedAt":"2026-09-05T12:00:00-03:00"},"customer":{"externalId":"c-unknown","name":"U","phone":"41999990012"},"creditor":{"externalId":"cred"},"receivable":{"externalId":"t-unknown","remainingAmount":"10.00","currency":"BRL","dueDate":"2026-09-01","status":"unknown"}}
    ]'::jsonb
  )
$$, 'estados nao comunicaveis sao persistidos');

SELECT is(
  (SELECT count(*)::integer FROM collections.receivables
   WHERE aces_id = 9896 AND financial_status IN ('cancelled', 'suspended', 'unknown')),
  3, 'cancelled suspended e unknown permanecem distintos'
);

SELECT is(
  (SELECT count(*)::integer FROM collections.cases
   WHERE aces_id = 9896 AND communication_status = 'completed'),
  3, 'estados nao abertos nao geram casos comunicaveis'
);

SELECT ok(
  (collections.get_operational_health(9895)->'outbox'->>'pending')::integer >= 0,
  'saude operacional retorna contadores'
);

SELECT * FROM finish();
ROLLBACK;
