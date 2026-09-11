BEGIN;

SELECT plan(36);

SELECT has_function(
  'collections', 'rotate_source_credential',
  ARRAY['integer', 'uuid', 'text', 'bytea', 'bytea', 'bytea', 'text', 'timestamp with time zone'],
  'rotacao transacional de credencial existe'
);
SELECT has_function(
  'collections', 'prepare_rb_source',
  ARRAY['integer', 'uuid', 'jsonb', 'jsonb'],
  'preparacao idempotente de fonte RB existe'
);
SELECT has_function(
  'collections', 'activate_collection_onboarding', ARRAY['integer', 'uuid'],
  'ativacao transacional do onboarding existe'
);
SELECT has_function(
  'collections', 'set_rb_billing_state', ARRAY['integer', 'boolean'],
  'transicao de billing RB existe'
);
SELECT has_function(
  'collections', 'complete_canonical_cutover', ARRAY['integer', 'uuid', 'text', 'uuid'],
  'cutover canonico idempotente existe'
);
SELECT ok(
  NOT has_function_privilege('anon', 'collections.rotate_source_credential(integer,uuid,text,bytea,bytea,bytea,text,timestamptz)', 'EXECUTE'),
  'anon nao rotaciona credenciais'
);
SELECT ok(
  NOT has_function_privilege('anon', 'collections.activate_collection_onboarding(integer,uuid)', 'EXECUTE'),
  'anon nao ativa onboarding'
);
SELECT ok(
  has_function_privilege('service_role', 'collections.rotate_source_credential(integer,uuid,text,bytea,bytea,bytea,text,timestamptz)', 'EXECUTE'),
  'service_role executa rotacao de credencial'
);
SELECT ok(
  has_function_privilege('service_role', 'collections.prepare_rb_source(integer,uuid,jsonb,jsonb)', 'EXECUTE'),
  'service_role executa preparacao RB'
);

INSERT INTO crm.accounts (id, name, status)
VALUES (9971, 'Collections Integrity Test', 'active');

INSERT INTO rb.connections (
  id, aces_id, rb_token_api, rb_empresa_ids, is_active, billing_enabled
)
VALUES (
  '99710000-0000-4000-8000-000000000001', 9971,
  'collections-integrity-rb-token', '["empresa-integrity"]'::jsonb, true, true
);

INSERT INTO collections.source_connections (
  id, public_id, aces_id, name, source_type, delivery_mode,
  default_ingestion_mode, capabilities, config, status
)
VALUES (
  '99710000-0000-4000-8000-000000000002', 'collections-integrity-rb', 9971,
  'RB Integrity', 'rb', 'pull', 'incremental', '{}'::jsonb,
  jsonb_build_object(
    'legacyConnectionId', '99710000-0000-4000-8000-000000000001',
    'dispatcherMode', 'canonical'
  ), 'active'
);

SELECT is(
  collections.resolve_source_dispatcher('99710000-0000-4000-8000-000000000002'),
  'canonical', 'RB ativo com billing e token validos usa fluxo canonico'
);

SELECT lives_ok($$
  SELECT collections.prepare_rb_source(
    9971,
    '99710000-0000-4000-8000-000000000001',
    jsonb_build_object('triggerTime', '09:00'),
    jsonb_build_object('delivery', 'pull')
  )
$$, 'preparacao RB repetida permanece segura');
SELECT is(
  (SELECT count(*)::integer FROM collections.source_connections
   WHERE aces_id = 9971 AND source_type = 'rb'),
  1, 'preparacao RB nao duplica fonte vinculada'
);

UPDATE rb.connections SET billing_enabled = false
WHERE id = '99710000-0000-4000-8000-000000000001';

SELECT is(
  collections.resolve_source_dispatcher('99710000-0000-4000-8000-000000000002'),
  'paused', 'RB canonico sem billing nao despacha'
);

SELECT throws_ok(
  $$UPDATE rb.connections SET rb_token_api = ''
    WHERE id = '99710000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'RB sem token e rejeitado pelo schema antes do despacho'
);

UPDATE rb.connections
SET billing_enabled = true, rb_token_api = 'collections-integrity-rb-token'
WHERE id = '99710000-0000-4000-8000-000000000001';

UPDATE rb.connections
SET rb_token_api = 'collections-integrity-rb-token', is_active = false
WHERE id = '99710000-0000-4000-8000-000000000001';

SELECT is(
  collections.resolve_source_dispatcher('99710000-0000-4000-8000-000000000002'),
  'paused', 'RB canonico inativo nao despacha'
);

UPDATE rb.connections SET is_active = true;
UPDATE collections.source_connections
SET config = jsonb_build_object(
  'legacyConnectionId', '99710000-0000-4000-8000-000000000001',
  'dispatcherMode', 'legacy_rb'
)
WHERE id = '99710000-0000-4000-8000-000000000002';

SELECT is(
  collections.resolve_source_dispatcher('99710000-0000-4000-8000-000000000002'),
  'legacy_rb', 'RB vinculado sem cutover permanece no legado'
);

UPDATE collections.source_connections
SET config = jsonb_build_object(
  'legacyConnectionId', '99710000-0000-4000-8000-000000000001',
  'dispatcherMode', 'canonical'
)
WHERE id = '99710000-0000-4000-8000-000000000002';

SELECT is(
  collections.resolve_source_dispatcher('99710000-0000-4000-8000-000000000002'),
  'canonical', 'RB vinculado volta ao fluxo canonico'
);

UPDATE collections.source_connections
SET config = '{"dispatcherMode":"canonical"}'::jsonb
WHERE id = '99710000-0000-4000-8000-000000000002';

SELECT is(
  collections.resolve_source_dispatcher('99710000-0000-4000-8000-000000000002'),
  'paused', 'RB canonico sem conexao vinculada nao despacha'
);

UPDATE collections.source_connections
SET config = jsonb_build_object(
  'legacyConnectionId', '99710000-0000-4000-8000-000000000001',
  'dispatcherMode', 'canonical'
)
WHERE id = '99710000-0000-4000-8000-000000000002';

INSERT INTO collections.source_credentials (
  aces_id, source_connection_id, credential_type,
  ciphertext, iv, auth_tag, key_version, status
)
VALUES (
  9971, '99710000-0000-4000-8000-000000000002', 'webhook_hmac',
  decode('aa', 'hex'), decode(repeat('11', 12), 'hex'),
  decode(repeat('22', 16), 'hex'), 'v1', 'current'
);

SELECT lives_ok($$
  SELECT collections.rotate_source_credential(
    9971,
    '99710000-0000-4000-8000-000000000002',
    'webhook_hmac',
    decode('bb', 'hex'),
    decode(repeat('33', 12), 'hex'),
    decode(repeat('44', 16), 'hex'),
    'v1',
    now() + interval '1 hour'
  )
$$, 'rotacao de credencial substitui o current sem quebrar a chave anterior');

SELECT is(
  (SELECT count(*)::integer FROM collections.source_credentials
   WHERE source_connection_id = '99710000-0000-4000-8000-000000000002' AND status = 'current'),
  1, 'existe exatamente uma credencial current'
);
SELECT is(
  (SELECT count(*)::integer FROM collections.source_credentials
   WHERE source_connection_id = '99710000-0000-4000-8000-000000000002' AND status = 'previous'),
  1, 'credencial anterior fica previous'
);
SELECT ok(
  (SELECT valid_until IS NOT NULL FROM collections.source_credentials
   WHERE source_connection_id = '99710000-0000-4000-8000-000000000002' AND status = 'previous'),
  'credencial anterior possui janela de validade'
);

SELECT lives_ok($$
  SELECT collections.set_rb_billing_state(9971, false)
$$, 'desativacao de billing RB e fonte ocorre em uma operacao');
SELECT is(
  (SELECT status FROM collections.source_connections
   WHERE id = '99710000-0000-4000-8000-000000000002'),
  'paused', 'desativacao de billing pausa a fonte canonica'
);
SELECT is(
  (SELECT billing_enabled FROM rb.connections
   WHERE id = '99710000-0000-4000-8000-000000000001'),
  false, 'desativacao de billing persiste no RB'
);

SELECT lives_ok($$
  SELECT collections.set_rb_billing_state(9971, true)
$$, 'reativacao de billing RB e fonte ocorre em uma operacao');
SELECT is(
  (SELECT status FROM collections.source_connections
   WHERE id = '99710000-0000-4000-8000-000000000002'),
  'active', 'reativacao de billing reativa a fonte'
);

SELECT throws_ok(
  $$SELECT collections.activate_collection_onboarding(9971, '99710000-0000-4000-8000-000000000002')$$,
  '23503', NULL, 'ativacao sem onboarding preparado falha sem efeitos parciais'
);
SELECT throws_ok(
  $$SELECT collections.complete_canonical_cutover(9971, '99710000-0000-4000-8000-000000000002', 'teste de integridade', NULL)$$,
  '22023', NULL, 'cutover sem runtime pausado falha fechado'
);
SELECT is(
  (SELECT count(*)::integer FROM collections.onboarding_bindings WHERE aces_id = 9971),
  0, 'falha de ativacao nao cria onboarding parcial'
);

INSERT INTO crm.instance (instancia, aces_id, status)
VALUES ('collections-integrity-instance', 9971, 'connected');

INSERT INTO agents.ai_agents (
  id, aces_id, name, system_prompt, instance_name, is_active
)
VALUES (
  '99710000-0000-4000-8000-000000000003', 9971,
  'Collections Integrity Agent', 'Responda de forma objetiva.',
  'collections-integrity-instance', false
);

INSERT INTO agents.agent_tools (
  id, aces_id, agent_id, tool_key, tool_version, is_enabled, readiness
)
VALUES (
  '99710000-0000-4000-8000-000000000004', 9971,
  '99710000-0000-4000-8000-000000000003',
  'collection_orchestration', 1, false, 'needs_config'
);

INSERT INTO crm.pipelines (id, aces_id, name)
VALUES (
  '99710000-0000-4000-8000-000000000005', 9971,
  'Collections Integrity Pipeline'
);

INSERT INTO crm.pipeline_stages (id, aces_id, pipeline_id, name, position)
VALUES (
  '99710000-0000-4000-8000-000000000011', 9971,
  '99710000-0000-4000-8000-000000000005', 'Atendimento', 0
);

INSERT INTO crm.automation_funnels (
  id, aces_id, name, instance_name, is_active, entry_source, reply_target_stage_id
)
VALUES (
  '99710000-0000-4000-8000-000000000006', 9971,
  'Collections Integrity Funnel', 'collections-integrity-instance', false,
  'collection', '99710000-0000-4000-8000-000000000011'
);

INSERT INTO crm.automation_steps (
  id, funnel_id, position, label, message_template, is_active
)
VALUES (
  '99710000-0000-4000-8000-000000000007',
  '99710000-0000-4000-8000-000000000006', 0,
  'Primeiro contato', 'Mensagem de teste', false
);

INSERT INTO collections.journey_rules (
  id, aces_id, funnel_id, timing_relation, is_active
)
VALUES (
  '99710000-0000-4000-8000-000000000008', 9971,
  '99710000-0000-4000-8000-000000000006', 'on_due', false
);

INSERT INTO collections.agent_source_bindings (
  id, aces_id, agent_tool_id, source_connection_id, is_enabled
)
VALUES (
  '99710000-0000-4000-8000-000000000009', 9971,
  '99710000-0000-4000-8000-000000000004',
  '99710000-0000-4000-8000-000000000002', true
);

INSERT INTO collections.onboarding_bindings (
  id, aces_id, source_connection_id, instance_name, agent_id,
  agent_tool_id, pipeline_id, funnel_id, journey_rule_id, first_step_id
)
VALUES (
  '99710000-0000-4000-8000-000000000010', 9971,
  '99710000-0000-4000-8000-000000000002', 'collections-integrity-instance',
  '99710000-0000-4000-8000-000000000003',
  '99710000-0000-4000-8000-000000000004',
  '99710000-0000-4000-8000-000000000005',
  '99710000-0000-4000-8000-000000000006',
  '99710000-0000-4000-8000-000000000008',
  '99710000-0000-4000-8000-000000000007'
);

SELECT lives_ok($$
  SELECT collections.activate_collection_onboarding(
    9971, '99710000-0000-4000-8000-000000000002'
  )
$$, 'ativacao completa o onboarding em uma operacao');
SELECT is(
  (collections.activate_collection_onboarding(
    9971, '99710000-0000-4000-8000-000000000002'
  )->>'alreadyActive'),
  'true', 'repeticao da ativacao e idempotente'
);

INSERT INTO collections.runtime_controls (aces_id, active_dispatcher)
VALUES (9971, 'paused')
ON CONFLICT (aces_id) DO UPDATE SET active_dispatcher = 'paused';

SELECT lives_ok($$
  SELECT collections.complete_canonical_cutover(
    9971, '99710000-0000-4000-8000-000000000002', 'teste de cutover', NULL
  )
$$, 'cutover canonico conclui com a conta pausada');
SELECT lives_ok($$
  SELECT collections.complete_canonical_cutover(
    9971, '99710000-0000-4000-8000-000000000002', 'teste de cutover repetido', NULL
  )
$$, 'repeticao do cutover canonico permanece segura');
SELECT is(
  (SELECT active_dispatcher FROM collections.runtime_controls WHERE aces_id = 9971),
  'canonical', 'cutover repetido mantém o dispatcher canonico'
);
SELECT is(
  (SELECT count(*)::integer FROM collections.operational_events
   WHERE aces_id = 9971 AND event_type = 'dispatcher.changed'),
  1, 'cutover repetido nao duplica evento de transicao'
);

SELECT * FROM finish();
ROLLBACK;
