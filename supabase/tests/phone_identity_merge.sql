BEGIN;

SELECT plan(29);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'crm.merge_active_phone_identity_duplicates()',
    'EXECUTE'
  ),
  'authenticated nao pode executar a consolidacao global'
);
SELECT ok(
  NOT has_table_privilege(
    'authenticated',
    'crm.lead_phone_identity_merge_audit',
    'SELECT'
  ),
  'auditoria da consolidacao nao e exposta ao frontend'
);

DROP INDEX crm.idx_leads_active_phone_identity_unique;

INSERT INTO crm.accounts (id, name, status)
VALUES (9601, 'Phone Merge Test', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '96000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'phone-merge@test.local',
  '',
  now(),
  '{}'::jsonb,
  '{}'::jsonb,
  now(),
  now()
);

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES (
  '96100000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  'phone-merge@test.local',
  'Phone Merge Admin',
  'ADMIN',
  9601
);

INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES (
  'phone-merge-instance',
  9601,
  'connected',
  'connected',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO agents.ai_agents (
  id, aces_id, instance_name, name, system_prompt, created_by
)
VALUES (
  '96100000-0000-0000-0000-000000000002',
  9601,
  'phone-merge-instance',
  'Phone Merge Agent',
  'Teste de consolidacao',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO crm.leads (
  id, aces_id, owner_id, name, contact_phone, status, instancia, view,
  last_message_at, created_at, updated_at
)
VALUES
  (
    '96200000-0000-0000-0000-000000000001',
    9601,
    '96100000-0000-0000-0000-000000000001',
    'Lead canonico RB',
    '1187654321',
    'Novo',
    'phone-merge-instance',
    TRUE,
    now() - interval '2 days',
    now() - interval '5 days',
    now() - interval '2 days'
  ),
  (
    '96200000-0000-0000-0000-000000000002',
    9601,
    '96100000-0000-0000-0000-000000000001',
    'Lead duplicado com conversa',
    '5511987654321',
    'Novo',
    'phone-merge-instance',
    TRUE,
    now(),
    now() - interval '1 day',
    now()
  );

INSERT INTO rb.lead_metadata (lead_id, aces_id, clie_id)
VALUES ('96200000-0000-0000-0000-000000000001', 9601, 'rb-canonical');

INSERT INTO crm.message_history (
  id, lead_id, aces_id, content, direction, instance, provider,
  provider_message_id, sent_at
)
VALUES (
  '96300000-0000-0000-0000-000000000001',
  '96200000-0000-0000-0000-000000000002',
  9601,
  'Mensagem preservada',
  'inbound',
  'phone-merge-instance',
  'evolution',
  'phone-merge-provider-message',
  now()
);

INSERT INTO crm.message_attachments (
  id, message_id, aces_id, lead_id, kind, mime_type,
  storage_bucket, storage_path, file_name, file_size
)
VALUES (
  '96400000-0000-0000-0000-000000000001',
  '96300000-0000-0000-0000-000000000001',
  9601,
  '96200000-0000-0000-0000-000000000002',
  'image',
  'image/png',
  'chat-attachments',
  'phone-merge/test.png',
  'test.png',
  10
);

INSERT INTO crm.message_attachment_upload_intents (
  id, message_id, attachment_id, aces_id, lead_id, kind, mime_type,
  storage_bucket, storage_path, file_name, file_size, intent_expires_at
)
VALUES (
  '96500000-0000-0000-0000-000000000001',
  '96300000-0000-0000-0000-000000000001',
  '96400000-0000-0000-0000-000000000001',
  9601,
  '96200000-0000-0000-0000-000000000002',
  'image',
  'image/png',
  'chat-attachments',
  'phone-merge/test.png',
  'test.png',
  10,
  now() + interval '1 hour'
);

INSERT INTO crm.opportunities (id, lead_id, aces_id, status, value)
VALUES (
  '96600000-0000-0000-0000-000000000001',
  '96200000-0000-0000-0000-000000000002',
  9601,
  'Novo',
  100
);

INSERT INTO agents.ai_lead_state (
  agent_id, lead_id, last_processed_message_at, memory_summary
)
VALUES (
  '96100000-0000-0000-0000-000000000002',
  '96200000-0000-0000-0000-000000000002',
  now(),
  'Memoria preservada'
);

INSERT INTO agents.ai_runs (
  id, agent_id, lead_id, message_history_ids, action_taken
)
VALUES (
  '96800000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000002',
  '96200000-0000-0000-0000-000000000002',
  '["96300000-0000-0000-0000-000000000001"]'::jsonb,
  'reply_only'
);

INSERT INTO crm.lead_pipeline_analysis (lead_id, aces_id, pipeline_id, summary)
SELECT
  '96200000-0000-0000-0000-000000000002',
  9601,
  pipeline.id,
  'Analise preservada'
FROM crm.pipelines AS pipeline
WHERE pipeline.aces_id = 9601
ORDER BY pipeline.is_default DESC, pipeline.created_at
LIMIT 1;

INSERT INTO crm.tags (id, aces_id, name)
VALUES ('96700000-0000-0000-0000-000000000001', 9601, 'Tag preservada');
INSERT INTO crm.lead_tags (lead_id, tag_id)
VALUES (
  '96200000-0000-0000-0000-000000000002',
  '96700000-0000-0000-0000-000000000001'
);

CREATE TEMP TABLE phone_merge_result AS
SELECT * FROM crm.merge_active_phone_identity_duplicates();

SELECT is((SELECT groups_merged FROM phone_merge_result), 1, 'um grupo consolidado');
SELECT is((SELECT leads_archived FROM phone_merge_result), 1, 'um lead arquivado');
SELECT is((SELECT messages_moved FROM phone_merge_result), 1, 'mensagem movida');
SELECT is((SELECT attachments_moved FROM phone_merge_result), 1, 'anexo movido');
SELECT is((SELECT upload_intents_moved FROM phone_merge_result), 1, 'intent de upload movido');
SELECT is((SELECT opportunities_moved FROM phone_merge_result), 1, 'oportunidade movida');
SELECT is((SELECT ai_runs_moved FROM phone_merge_result), 1, 'execucao de IA movida');
SELECT is((SELECT ai_states_moved FROM phone_merge_result), 1, 'estado de IA movido');
SELECT is(
  (SELECT pipeline_analyses_moved FROM phone_merge_result),
  1,
  'analise de pipeline movida'
);
SELECT is((SELECT tags_copied FROM phone_merge_result), 1, 'tag copiada');

SELECT is(
  (SELECT count(*)::integer FROM crm.leads WHERE aces_id = 9601 AND view IS TRUE),
  1,
  'somente um lead permanece ativo'
);
SELECT is(
  (SELECT view FROM crm.leads WHERE id = '96200000-0000-0000-0000-000000000002'),
  FALSE,
  'lead duplicado foi arquivado sem exclusao'
);
SELECT is(
  (SELECT lead_id FROM crm.message_history WHERE id = '96300000-0000-0000-0000-000000000001'),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'historico aponta para o canonico RB'
);
SELECT is(
  (SELECT lead_id FROM crm.message_attachments WHERE id = '96400000-0000-0000-0000-000000000001'),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'anexo aponta para o canonico'
);
SELECT is(
  (SELECT lead_id FROM crm.message_attachment_upload_intents WHERE id = '96500000-0000-0000-0000-000000000001'),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'intent aponta para o canonico'
);
SELECT is(
  (SELECT lead_id FROM crm.opportunities WHERE id = '96600000-0000-0000-0000-000000000001'),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'oportunidade aponta para o canonico'
);
SELECT is(
  (
    SELECT lead_id
    FROM agents.ai_runs
    WHERE id = '96800000-0000-0000-0000-000000000001'
  ),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'execucao de IA aponta para o canonico'
);
SELECT is(
  (
    SELECT lead_id
    FROM agents.ai_lead_state
    WHERE agent_id = '96100000-0000-0000-0000-000000000002'
  ),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'estado de IA aponta para o canonico'
);
SELECT is(
  (
    SELECT lead_id
    FROM crm.lead_pipeline_analysis
    WHERE summary = 'Analise preservada'
  ),
  '96200000-0000-0000-0000-000000000001'::uuid,
  'analise de pipeline aponta para o canonico'
);
SELECT is(
  (
    SELECT count(*)::integer
    FROM crm.lead_tags
    WHERE lead_id = '96200000-0000-0000-0000-000000000001'
      AND tag_id = '96700000-0000-0000-0000-000000000001'
  ),
  1,
  'tag esta disponivel no canonico'
);
SELECT is(
  (
    SELECT messages_moved
    FROM crm.lead_phone_identity_merge_audit
    WHERE source_lead_id = '96200000-0000-0000-0000-000000000002'
  ),
  1,
  'auditoria registra a movimentacao'
);

CREATE TEMP TABLE phone_merge_second_result AS
SELECT * FROM crm.merge_active_phone_identity_duplicates();
SELECT is(
  (SELECT leads_archived FROM phone_merge_second_result),
  0,
  'segunda execucao e idempotente'
);

INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES (
  'phone-merge-instance-2',
  9601,
  'connected',
  'connected',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO crm.leads (
  id, aces_id, owner_id, name, contact_phone, status, instancia, view
)
VALUES
  (
    '96200000-0000-0000-0000-000000000011',
    9601,
    '96100000-0000-0000-0000-000000000001',
    'Conflito instancia A',
    '1176543210',
    'Novo',
    'phone-merge-instance',
    TRUE
  ),
  (
    '96200000-0000-0000-0000-000000000012',
    9601,
    '96100000-0000-0000-0000-000000000001',
    'Conflito instancia B',
    '5511976543210',
    'Novo',
    'phone-merge-instance-2',
    TRUE
  );
SELECT throws_ok(
  $$SELECT * FROM crm.merge_active_phone_identity_duplicates()$$,
  'P0001',
  NULL,
  'consolidacao automatica bloqueia grupos entre instancias'
);
UPDATE crm.leads
SET view = FALSE
WHERE id IN (
  '96200000-0000-0000-0000-000000000011',
  '96200000-0000-0000-0000-000000000012'
);

INSERT INTO crm.leads (
  id, aces_id, owner_id, name, contact_phone, status, instancia, view
)
VALUES
  (
    '96200000-0000-0000-0000-000000000021',
    9601,
    '96100000-0000-0000-0000-000000000001',
    'Conflito RB A',
    '1165432109',
    'Novo',
    'phone-merge-instance',
    TRUE
  ),
  (
    '96200000-0000-0000-0000-000000000022',
    9601,
    '96100000-0000-0000-0000-000000000001',
    'Conflito RB B',
    '5511965432109',
    'Novo',
    'phone-merge-instance',
    TRUE
  );
INSERT INTO rb.lead_metadata (lead_id, aces_id, clie_id)
VALUES
  ('96200000-0000-0000-0000-000000000021', 9601, 'rb-conflict-a'),
  ('96200000-0000-0000-0000-000000000022', 9601, 'rb-conflict-b');
SELECT throws_ok(
  $$SELECT * FROM crm.merge_active_phone_identity_duplicates()$$,
  'P0001',
  NULL,
  'consolidacao automatica bloqueia grupos com dois cadastros RB'
);
UPDATE crm.leads
SET view = FALSE
WHERE id IN (
  '96200000-0000-0000-0000-000000000021',
  '96200000-0000-0000-0000-000000000022'
);

CREATE UNIQUE INDEX idx_leads_active_phone_identity_unique
  ON crm.leads (aces_id, phone_identity)
  WHERE view = TRUE AND phone_identity IS NOT NULL;

SELECT throws_ok(
  $$
    INSERT INTO crm.leads (
      id, aces_id, owner_id, name, contact_phone, status, instancia, view
    ) VALUES (
      '96200000-0000-0000-0000-000000000003',
      9601,
      '96100000-0000-0000-0000-000000000001',
      'Nova duplicata bloqueada',
      '11987654321',
      'Novo',
      'phone-merge-instance',
      TRUE
    )
  $$,
  '23505',
  NULL,
  'nova variacao do telefone e bloqueada'
);

SELECT ok(
  (
    SELECT index_definition.indisunique
    FROM pg_index AS index_definition
    WHERE index_definition.indexrelid =
      'crm.idx_leads_active_phone_identity_unique'::regclass
  ),
  'indice normalizado permanece como protecao concorrente'
);

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"96000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);
SELECT is(
  (crm.rpc_create_lead(
    p_name => 'Duplicata via RPC',
    p_contact_phone => '+55 11 98765-4321',
    p_instance => 'phone-merge-instance'
  )->>'success')::boolean,
  false,
  'RPC trata variacao normalizada duplicada sem criar outro lead'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
