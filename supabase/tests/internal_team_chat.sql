BEGIN;

SELECT plan(47);

SELECT has_table('crm', 'internal_conversations', 'internal_conversations existe');
SELECT has_table('crm', 'internal_conversation_members', 'internal_conversation_members existe');
SELECT has_table('crm', 'internal_messages', 'internal_messages existe');
SELECT has_table('crm', 'internal_message_mentions', 'internal_message_mentions existe');
SELECT has_table('crm', 'internal_message_attachments', 'internal_message_attachments existe');
SELECT has_table('crm', 'internal_message_attachment_upload_intents', 'upload intents internos existem');
SELECT has_index('crm', 'internal_conversations', 'internal_conversations_direct_key_uidx', 'conversa direta possui indice unico');
SELECT has_index('crm', 'internal_messages', 'internal_messages_conversation_cursor_idx', 'paginacao de mensagens possui indice');
SELECT has_index('crm', 'internal_message_mentions', 'internal_mentions_lead_idx', 'mencoes de lead possuem indice');
SELECT has_index('crm', 'internal_message_attachments', 'internal_attachments_conversation_idx', 'anexos possuem indice por conversa');
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'crm.internal_conversations'::regclass
      AND conname = 'internal_conversations_shape_check'
      AND contype = 'c'
  ),
  'formato de conversa possui constraint'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'crm' AND c.relname LIKE 'internal_%' AND c.relrowsecurity),
  6,
  'RLS esta ativo em todas as tabelas internas'
);

SELECT is(
  (SELECT count(*)::integer FROM pg_publication_tables
   WHERE pubname = 'supabase_realtime' AND schemaname = 'crm'
     AND tablename IN ('internal_conversations', 'internal_conversation_members', 'internal_messages', 'internal_message_mentions', 'internal_message_attachments')),
  5,
  'entidades de tempo real estao publicadas'
);

INSERT INTO crm.accounts (id, name, status) VALUES
  (9701, 'Internal Chat A', 'active'),
  (9702, 'Internal Chat B', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('97000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@internal.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'seller-a@internal.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'seller-b@internal.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'outsider@internal.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'pending@internal.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('97000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'tenant-b@internal.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id) VALUES
  ('97100000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'admin@internal.test', 'Admin Conta', 'ADMIN', 9701),
  ('97100000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000002', 'seller-a@internal.test', 'Seller A', 'VENDEDOR', 9701),
  ('97100000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000003', 'seller-b@internal.test', 'Seller B', 'VENDEDOR', 9701),
  ('97100000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000004', 'outsider@internal.test', 'Outsider', 'VENDEDOR', 9701),
  ('97100000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000005', 'pending@internal.test', 'Pending', 'NENHUM', 9701),
  ('97200000-0000-0000-0000-000000000006', '97000000-0000-0000-0000-000000000006', 'tenant-b@internal.test', 'Tenant B', 'VENDEDOR', 9702);

INSERT INTO crm.leads (id, aces_id, owner_id, name, contact_phone) VALUES
  ('97300000-0000-0000-0000-000000000001', 9701, '97100000-0000-0000-0000-000000000002', 'Lead permitido', '559700000001'),
  ('97300000-0000-0000-0000-000000000002', 9701, '97100000-0000-0000-0000-000000000003', 'Lead restrito', '559700000002');

CREATE TEMP TABLE internal_test_ids (name text PRIMARY KEY, id uuid NOT NULL);
GRANT ALL ON internal_test_ids TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);

INSERT INTO internal_test_ids(name, id)
SELECT 'direct', crm.rpc_create_internal_conversation(
  'direct', NULL, ARRAY['97100000-0000-0000-0000-000000000003'::uuid]
);

SELECT ok((SELECT id IS NOT NULL FROM internal_test_ids WHERE name = 'direct'), 'vendedor cria conversa direta');
SELECT is(
  crm.rpc_create_internal_conversation('direct', NULL, ARRAY['97100000-0000-0000-0000-000000000003'::uuid]),
  (SELECT id FROM internal_test_ids WHERE name = 'direct'),
  'conversa direta existente e reutilizada'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.internal_conversation_members WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'direct')),
  2,
  'conversa direta possui exatamente dois membros'
);

INSERT INTO internal_test_ids(name, id)
SELECT 'group', crm.rpc_create_internal_conversation(
  'group', 'Operacao', ARRAY['97100000-0000-0000-0000-000000000003'::uuid]
);
SELECT ok((SELECT id IS NOT NULL FROM internal_test_ids WHERE name = 'group'), 'vendedor cria grupo');
SELECT is(
  (SELECT count(*)::integer FROM crm.internal_conversation_members WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')),
  2,
  'grupo aceita usuarios ativos da mesma conta independentemente de empresa'
);

SELECT throws_ok(
  $$SELECT crm.rpc_create_internal_conversation('direct', NULL, ARRAY['97200000-0000-0000-0000-000000000006'::uuid])$$,
  'P0001', 'Participante invalido para esta conta', 'participante de outro aces_id e bloqueado'
);

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000005","role":"authenticated"}', TRUE);
SELECT throws_ok(
  $$SELECT crm.rpc_create_internal_conversation('direct', NULL, ARRAY['97100000-0000-0000-0000-000000000002'::uuid])$$,
  'P0001', 'Usuario sem acesso ao Chat interno', 'usuario NENHUM e bloqueado'
);

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
SELECT ok(
  crm.rpc_send_internal_message(
    (SELECT id FROM internal_test_ids WHERE name = 'direct'), 'Ola time', NULL,
    '97400000-0000-0000-0000-000000000001', '[]'::jsonb, NULL
  ) IS NOT NULL,
  'membro envia mensagem'
);
SELECT is(
  crm.rpc_send_internal_message(
    (SELECT id FROM internal_test_ids WHERE name = 'direct'), 'Ola time', NULL,
    '97400000-0000-0000-0000-000000000001', '[]'::jsonb, NULL
  ),
  (SELECT id FROM crm.internal_messages WHERE client_message_id = '97400000-0000-0000-0000-000000000001'),
  'reenvio idempotente retorna a mesma mensagem'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.internal_messages WHERE client_message_id = '97400000-0000-0000-0000-000000000001'),
  1,
  'idempotencia impede mensagem duplicada'
);

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000004","role":"authenticated"}', TRUE);
SELECT is(
  (SELECT count(*)::integer FROM crm.internal_messages WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'direct')),
  0,
  'usuario da conta fora da conversa nao le mensagens'
);

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000006","role":"authenticated"}', TRUE);
SELECT is((SELECT count(*)::integer FROM crm.internal_conversations WHERE id IN (SELECT id FROM internal_test_ids)), 0, 'RLS isola outra conta');

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
SELECT is((SELECT count(*)::integer FROM crm.internal_conversations WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group')), 1, 'ADMIN ve metadados de grupo sem ser membro');
SELECT is((SELECT count(*)::integer FROM crm.internal_messages WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'direct')), 0, 'ADMIN nao le mensagens sem ser membro');
UPDATE crm.internal_conversations SET name = 'Operacao gerenciada' WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group');
SELECT is((SELECT name FROM crm.internal_conversations WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group')), 'Operacao gerenciada', 'ADMIN gerencia metadados sem ler conteudo');
SELECT throws_ok(
  $$UPDATE crm.internal_conversation_members SET is_active = FALSE
    WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'direct')
      AND user_id = '97100000-0000-0000-0000-000000000003'$$,
  'P0001', 'Participantes de conversa direta nao podem ser alterados', 'conversa direta preserva exatamente dois participantes'
);

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
SELECT throws_ok(
  $$UPDATE crm.internal_conversation_members SET is_admin = false
    WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')
      AND user_id = '97100000-0000-0000-0000-000000000002'$$,
  'P0001', 'A conversa precisa manter pelo menos um administrador', 'ultimo administrador nao pode ser rebaixado'
);

SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000001","role":"authenticated"}', TRUE);
UPDATE crm.internal_conversation_members SET is_admin = TRUE
WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')
  AND user_id = '97100000-0000-0000-0000-000000000003';
SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}', TRUE);
UPDATE crm.internal_conversation_members SET is_admin = FALSE
WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')
  AND user_id = '97100000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
UPDATE crm.internal_conversations SET name = 'Alteracao indevida'
WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group');
SELECT is(
  (SELECT name FROM crm.internal_conversations WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group')),
  'Operacao gerenciada',
  'criador rebaixado nao conserva privilegio administrativo'
);

SELECT throws_ok(
  $$SELECT crm.rpc_send_internal_message(
    (SELECT id FROM internal_test_ids WHERE name = 'group'), 'Resposta invalida',
    (SELECT id FROM crm.internal_messages WHERE client_message_id = '97400000-0000-0000-0000-000000000001'),
    '97400000-0000-0000-0000-000000000002', '[]'::jsonb, NULL
  )$$,
  'P0001', 'A resposta deve apontar para a mesma conversa', 'resposta entre conversas e bloqueada'
);

SELECT ok(
  crm.rpc_send_internal_message(
    (SELECT id FROM internal_test_ids WHERE name = 'group'),
    '#[lead:97300000-0000-0000-0000-000000000001]', NULL,
    '97400000-0000-0000-0000-000000000003',
    '[{"type":"lead","leadId":"97300000-0000-0000-0000-000000000001","start":0,"length":44}]'::jsonb,
    NULL
  ) IS NOT NULL,
  'lead acessivel pode ser mencionado com referencia estruturada'
);
SELECT is(
  (SELECT count(*)::integer FROM crm.internal_message_mentions WHERE lead_id = '97300000-0000-0000-0000-000000000001'),
  1,
  'lead_id da mencao foi persistido'
);
SELECT throws_ok(
  $$SELECT crm.rpc_send_internal_message(
    (SELECT id FROM internal_test_ids WHERE name = 'group'),
    '#[lead:97300000-0000-0000-0000-000000000002]', NULL,
    '97400000-0000-0000-0000-000000000004',
    '[{"type":"lead","leadId":"97300000-0000-0000-0000-000000000002","start":0,"length":44}]'::jsonb,
    NULL
  )$$,
  'P0001', 'Lead mencionado indisponivel', 'remetente nao pode mencionar lead sem acesso'
);

-- now() permanece fixo durante a transacao pgTAP; simula uma leitura anterior
-- para validar o mesmo comportamento observado entre requisicoes reais.
SELECT set_config('request.jwt.claims', '{"sub":"97000000-0000-0000-0000-000000000003","role":"authenticated"}', TRUE);
UPDATE crm.internal_conversation_members
SET last_read_at = now() - interval '1 second'
WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')
  AND user_id = '97100000-0000-0000-0000-000000000003';
SELECT ok(
  (SELECT unread_count > 0 FROM crm.rpc_get_internal_unread_counts() WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')),
  'destinatario recebe contador nao lido'
);
SELECT lives_ok(
  $$SELECT crm.rpc_mark_internal_conversation_read((SELECT id FROM internal_test_ids WHERE name = 'group'))$$,
  'membro marca conversa como lida'
);
SELECT is(
  COALESCE((SELECT unread_count::integer FROM crm.rpc_get_internal_unread_counts() WHERE conversation_id = (SELECT id FROM internal_test_ids WHERE name = 'group')), 0),
  0,
  'contador zera depois da leitura'
);

UPDATE crm.internal_conversations SET archived_at = now()
WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group');
SELECT ok(
  (SELECT archived_at IS NOT NULL FROM crm.internal_conversations WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group')),
  'administrador arquiva conversa'
);
SELECT throws_ok(
  $$SELECT crm.rpc_send_internal_message(
    (SELECT id FROM internal_test_ids WHERE name = 'group'), 'Nao deve enviar', NULL,
    '97400000-0000-0000-0000-000000000005', '[]'::jsonb, NULL
  )$$,
  'P0001', 'Restaure a conversa antes de enviar mensagens', 'conversa arquivada fica somente leitura'
);
UPDATE crm.internal_conversations SET archived_at = NULL
WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group');
SELECT ok(
  (SELECT archived_at IS NULL FROM crm.internal_conversations WHERE id = (SELECT id FROM internal_test_ids WHERE name = 'group')),
  'administrador restaura conversa'
);

RESET ROLE;

SELECT ok(NOT has_table_privilege('anon', 'crm.internal_messages', 'SELECT'), 'anon nao le mensagens internas');
SELECT ok(NOT has_table_privilege('authenticated', 'crm.internal_messages', 'UPDATE'), 'edicao de mensagem ainda nao foi exposta');
SELECT ok(
  NOT has_table_privilege('authenticated', 'crm.internal_conversations', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'crm.internal_messages', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'crm.internal_message_mentions', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'crm.internal_message_attachment_upload_intents', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'crm.internal_message_attachment_upload_intents', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'crm.internal_message_attachment_upload_intents', 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'crm.internal_message_attachments', 'INSERT'),
  'escritas estruturais sao exclusivas das RPCs protegidas'
);
SELECT ok(
  (SELECT prosecdef FROM pg_proc WHERE oid = 'crm.rpc_create_internal_conversation(text,text,uuid[])'::regprocedure)
  AND (SELECT prosecdef FROM pg_proc WHERE oid = 'crm.rpc_send_internal_message(uuid,text,uuid,uuid,jsonb,uuid)'::regprocedure),
  'RPCs de escrita executam o fluxo atomico validado'
);
SELECT ok((SELECT NOT public FROM storage.buckets WHERE id = 'chat-attachments'), 'bucket compartilhado continua privado');
SELECT ok(has_function_privilege('authenticated', 'crm.rpc_send_internal_message(uuid,text,uuid,uuid,jsonb,uuid)', 'EXECUTE'), 'envio interno esta exposto somente por RPC autorizada');

SELECT * FROM finish();
ROLLBACK;
