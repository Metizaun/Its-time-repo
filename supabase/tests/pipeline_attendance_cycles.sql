BEGIN;

SELECT plan(10);

INSERT INTO crm.accounts (id, name, status)
VALUES (9301, 'Pipeline Test Account', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '93000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'pipeline-admin@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES (
  '93100000-0000-0000-0000-000000000001',
  '93000000-0000-0000-0000-000000000001',
  'pipeline-admin@test.local', 'Pipeline Admin', 'ADMIN', 9301
);

INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES (
  'pipeline-test-instance', 9301, 'connected', 'connected',
  '93100000-0000-0000-0000-000000000001'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);

SELECT crm.rpc_create_pipeline('Pipeline A', 'Teste', true);
SELECT crm.rpc_create_pipeline('Pipeline B', 'Teste', true);

RESET ROLE;

SELECT is(
  (SELECT ai_classification_enabled FROM crm.pipelines WHERE aces_id = 9301 AND name = 'Pipeline A'),
  true,
  'pipeline novo nasce com classificacao ativa'
);

SELECT is(
  (SELECT count(*)::integer FROM crm.pipeline_stages AS stage
    JOIN crm.pipelines AS pipeline ON pipeline.id = stage.pipeline_id
    WHERE pipeline.aces_id = 9301 AND pipeline.name = 'Pipeline A'
      AND stage.classifier_semantic_key = 'active_service'),
  1,
  'pipeline possui exatamente uma etapa Atendimento'
);

INSERT INTO crm.pipeline_stages (
  id, aces_id, pipeline_id, name, color, position, category,
  classifier_semantic_key, classifier_is_destination
)
SELECT
  item.id::uuid, 9301, pipeline.id, item.name, '#64748b', item.position, item.category,
  item.semantic_key, true
FROM crm.pipelines AS pipeline
CROSS JOIN (VALUES
  ('93300000-0000-0000-0000-000000000001', 'Fechado', 2, 'Ganho', 'won'),
  ('93300000-0000-0000-0000-000000000002', 'Perdido', 3, 'Perdido', 'lost'),
  ('93300000-0000-0000-0000-000000000003', 'Customizada', 4, 'Aberto', NULL)
) AS item(id, name, position, category, semantic_key)
WHERE pipeline.aces_id = 9301 AND pipeline.name = 'Pipeline A';

INSERT INTO crm.leads (
  id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, view
)
SELECT
  item.id::uuid, 9301, '93100000-0000-0000-0000-000000000001', item.name,
  item.phone, item.status, item.stage_id::uuid, 'pipeline-test-instance', true
FROM (VALUES
  ('93400000-0000-0000-0000-000000000001', 'Lead Entrada', '559300000001', 'Novo',
    (SELECT stage.id::text FROM crm.pipeline_stages AS stage JOIN crm.pipelines AS pipeline ON pipeline.id = stage.pipeline_id WHERE pipeline.name = 'Pipeline A' AND pipeline.aces_id = 9301 AND stage.classifier_semantic_key = 'new')),
  ('93400000-0000-0000-0000-000000000002', 'Lead Fechado', '559300000002', 'Fechado', '93300000-0000-0000-0000-000000000001'),
  ('93400000-0000-0000-0000-000000000003', 'Lead Perdido', '559300000003', 'Perdido', '93300000-0000-0000-0000-000000000002')
) AS item(id, name, phone, status, stage_id);

INSERT INTO crm.leads (
  id, aces_id, owner_id, name, contact_phone, status, stage_id, instancia, view
)
SELECT
  '93400000-0000-0000-0000-000000000004', 9301,
  '93100000-0000-0000-0000-000000000001', 'Lead Pipeline B',
  '559300000004', 'Novo', stage.id, 'pipeline-test-instance', true
FROM crm.pipeline_stages AS stage
JOIN crm.pipelines AS pipeline ON pipeline.id = stage.pipeline_id
WHERE pipeline.name = 'Pipeline B'
  AND pipeline.aces_id = 9301
  AND stage.classifier_semantic_key = 'new';

INSERT INTO crm.message_history (
  id, lead_id, aces_id, content, direction, conversation_id, instance, sent_at, source_type
) VALUES
  ('93500000-0000-0000-0000-000000000001', '93400000-0000-0000-0000-000000000001', 9301, 'Ola', 'inbound', 'cycle-entry', 'pipeline-test-instance', '2026-07-17T12:00:00Z', 'lead'),
  ('93500000-0000-0000-0000-000000000002', '93400000-0000-0000-0000-000000000002', 9301, 'Quero voltar', 'inbound', 'cycle-won', 'pipeline-test-instance', '2026-07-17T12:01:00Z', 'lead'),
  ('93500000-0000-0000-0000-000000000003', '93400000-0000-0000-0000-000000000003', 9301, 'Mudei de ideia', 'inbound', 'cycle-lost', 'pipeline-test-instance', '2026-07-17T12:02:00Z', 'lead'),
  ('93500000-0000-0000-0000-000000000004', '93400000-0000-0000-0000-000000000004', 9301, 'Pipeline B', 'inbound', 'cycle-b', 'pipeline-test-instance', '2026-07-17T12:03:00Z', 'lead');

SELECT is(
  (SELECT origin.classifier_semantic_key FROM crm.leads AS lead JOIN crm.pipeline_stages AS origin ON origin.id = lead.pre_attendance_stage_id WHERE lead.id = '93400000-0000-0000-0000-000000000001'),
  'new',
  'inbound vindo de etapa aberta preserva a origem'
);

SELECT is(
  (SELECT origin.classifier_semantic_key FROM crm.leads AS lead JOIN crm.pipeline_stages AS origin ON origin.id = lead.pre_attendance_stage_id WHERE lead.id = '93400000-0000-0000-0000-000000000002'),
  'won',
  'inbound reabre lead Fechado em Atendimento'
);

SELECT is(
  (SELECT origin.classifier_semantic_key FROM crm.leads AS lead JOIN crm.pipeline_stages AS origin ON origin.id = lead.pre_attendance_stage_id WHERE lead.id = '93400000-0000-0000-0000-000000000003'),
  'lost',
  'inbound reabre lead Perdido em Atendimento'
);

INSERT INTO crm.message_history (
  id, lead_id, aces_id, content, direction, conversation_id, instance, sent_at, source_type
) VALUES (
  '93500000-0000-0000-0000-000000000005', '93400000-0000-0000-0000-000000000001',
  9301, 'Outra mensagem', 'inbound', 'cycle-entry', 'pipeline-test-instance',
  '2026-07-17T12:10:00Z', 'lead'
);

SELECT is(
  (SELECT attendance_cycle_started_at::text FROM crm.leads WHERE id = '93400000-0000-0000-0000-000000000001'),
  '2026-07-17 12:00:00+00',
  'mensagens consecutivas preservam o inicio do ciclo'
);

SELECT is(
  (SELECT pipeline.name
   FROM crm.leads AS lead
   JOIN crm.pipeline_stages AS current_stage ON current_stage.id = lead.stage_id
   JOIN crm.pipelines AS pipeline ON pipeline.id = current_stage.pipeline_id
   WHERE lead.id = '93400000-0000-0000-0000-000000000004'),
  'Pipeline B',
  'inbound nunca atravessa pipelines'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);

SELECT crm.rpc_designate_attendance_stage(
  (SELECT id FROM crm.pipelines WHERE aces_id = 9301 AND name = 'Pipeline A'),
  '93300000-0000-0000-0000-000000000003'
);

RESET ROLE;

SELECT is(
  (SELECT count(*)::integer FROM crm.pipeline_stages AS stage JOIN crm.pipelines AS pipeline ON pipeline.id = stage.pipeline_id WHERE pipeline.aces_id = 9301 AND pipeline.name = 'Pipeline A' AND stage.classifier_semantic_key = 'active_service'),
  1,
  'transferencia mantem um unico Atendimento'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"93000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);

SELECT throws_ok(
  $$SELECT crm.rpc_move_lead_to_stage(
    '93400000-0000-0000-0000-000000000001',
    (SELECT stage.id FROM crm.pipeline_stages AS stage JOIN crm.pipelines AS pipeline ON pipeline.id = stage.pipeline_id WHERE pipeline.aces_id = 9301 AND pipeline.name = 'Pipeline B' AND stage.classifier_semantic_key = 'new')
  )$$,
  'Movimento entre pipelines nao e permitido',
  'movimento manual entre pipelines e bloqueado'
);

RESET ROLE;

SELECT throws_ok(
  $$DELETE FROM crm.pipeline_stages WHERE id = '93300000-0000-0000-0000-000000000003'; SET CONSTRAINTS ALL IMMEDIATE$$,
  'Pipeline ativo deve possuir exatamente uma etapa de Atendimento',
  'a unica etapa operacional nao pode ser excluida'
);

SELECT * FROM finish();
ROLLBACK;
