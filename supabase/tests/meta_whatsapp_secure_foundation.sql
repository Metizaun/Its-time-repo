BEGIN;

SELECT plan(26);

SELECT has_table('meta', 'whatsapp_channels', 'meta.whatsapp_channels existe');
SELECT has_table('meta', 'admin_audit_events', 'meta.admin_audit_events existe');
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'meta.whatsapp_channels'::regclass),
  'RLS esta habilitado nos canais Meta'
);
SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'meta.admin_audit_events'::regclass),
  'RLS esta habilitado na auditoria Meta'
);
SELECT ok(NOT has_table_privilege('anon', 'meta.whatsapp_channels', 'SELECT'), 'anon nao le canais Meta');
SELECT ok(NOT has_table_privilege('authenticated', 'meta.whatsapp_channels', 'SELECT'), 'authenticated nao le canais Meta');
SELECT ok(has_table_privilege('service_role', 'meta.whatsapp_channels', 'SELECT'), 'service_role le canais Meta');
SELECT ok(has_table_privilege('service_role', 'meta.admin_audit_events', 'INSERT'), 'service_role grava auditoria Meta');
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'crm.rpc_upsert_meta_whatsapp_channel(integer,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated nao executa upsert Meta'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'crm.rpc_bootstrap_meta_whatsapp_channel(integer,text,text,text,text,text,text,text,text,text)',
    'EXECUTE'
  ),
  'authenticated nao executa bootstrap Meta'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'crm.rpc_set_meta_whatsapp_channel_status(integer,text,text,text)',
    'EXECUTE'
  ),
  'authenticated nao altera status Meta'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'crm.rpc_disable_meta_whatsapp_channel(integer,text,text)',
    'EXECUTE'
  ),
  'authenticated nao executa rollback Meta'
);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9891, 'Meta Secure A', 'active'),
  (9892, 'Meta Secure B', 'active'),
  (9893, 'Meta Secure Instagram', 'active'),
  (9894, 'Meta Secure Bootstrap', 'active');

INSERT INTO crm.instance (instancia, aces_id, status, setup_status)
VALUES
  ('meta-secure-a', 9891, 'connected', 'connected'),
  ('meta-secure-b', 9892, 'connected', 'connected'),
  ('meta-secure-instagram', 9893, 'connected', 'connected'),
  ('meta-secure-bootstrap', 9894, 'connected', 'connected');

INSERT INTO crm.instance_channels (aces_id, instance_name, channel_type, provider, capability, status)
VALUES
  (9891, 'meta-secure-a', 'whatsapp', 'gupshup', 'full', 'active'),
  (9892, 'meta-secure-b', 'whatsapp', 'evolution', 'full', 'active'),
  (9893, 'meta-secure-instagram', 'instagram', 'instagram', 'manual_only', 'active'),
  (9894, 'meta-secure-bootstrap', 'whatsapp', 'evolution', 'full', 'active');

SELECT crm.rpc_upsert_meta_whatsapp_channel(
  9891,
  'meta-secure-a',
  'waba-secure-a',
  'phone-secure-a',
  'business-secure-a',
  '+55 11 99999-0001',
  'META_SECURE_ACCESS_TOKEN',
  'META_SECURE_APP_SECRET',
  'META_SECURE_VERIFY_TOKEN',
  'draft'
);

SELECT is(
  (SELECT provider FROM crm.instance_channels WHERE aces_id = 9891 AND instance_name = 'meta-secure-a'),
  'gupshup',
  'draft Meta preserva o provider atual'
);

SELECT throws_ok(
  $$SELECT crm.rpc_upsert_meta_whatsapp_channel(9891, 'meta-secure-a', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'active')$$,
  '23514',
  'Configuracao Meta incompleta para ativacao',
  'ativacao incompleta e rejeitada'
);

SELECT throws_ok(
  $$SELECT crm.rpc_upsert_meta_whatsapp_channel(9893, 'meta-secure-instagram', 'waba-i', 'phone-i', NULL, NULL, 'META_ACCESS_I', 'META_SECRET_I', NULL, 'draft')$$,
  '23514',
  'Instancia vinculada a canal nao WhatsApp',
  'canal Instagram nao pode ser convertido em WhatsApp'
);

SELECT crm.rpc_set_meta_whatsapp_channel_status(
  9891,
  'meta-secure-a',
  'active',
  'operator-activate@test'
);

SELECT is(
  (SELECT provider FROM crm.instance_channels WHERE aces_id = 9891 AND instance_name = 'meta-secure-a'),
  'meta',
  'ativacao explicita promove o binding para Meta'
);
SELECT is(
  (SELECT status FROM meta.whatsapp_channels WHERE aces_id = 9891 AND instance_name = 'meta-secure-a'),
  'active',
  'canal Meta fica ativo apos configuracao completa'
);
SELECT is(
  (SELECT count(*)::integer FROM meta.admin_audit_events WHERE aces_id = 9891 AND action = 'activate' AND outcome = 'succeeded'),
  1,
  'ativacao Meta registra auditoria atomica'
);

SELECT crm.rpc_upsert_meta_whatsapp_channel(
  9891,
  'meta-secure-a',
  'waba-secure-a',
  'phone-secure-a',
  'business-secure-a',
  '+55 11 99999-0001',
  'META_SECURE_ACCESS_TOKEN',
  'META_SECURE_APP_SECRET',
  'META_SECURE_VERIFY_TOKEN',
  'active'
);

SELECT is(
  (SELECT count(*)::integer FROM meta.whatsapp_channels WHERE aces_id = 9891 AND instance_name = 'meta-secure-a'),
  1,
  'upsert Meta e idempotente'
);

SELECT throws_ok(
  $$SELECT crm.rpc_upsert_meta_whatsapp_channel(9892, 'meta-secure-b', 'waba-secure-b', 'phone-secure-a', NULL, NULL, 'META_ACCESS_B', 'META_SECRET_B', NULL, 'active')$$,
  '23505',
  NULL,
  'phone_number_id nao colide entre tenants'
);

SELECT throws_ok(
  $$SELECT crm.rpc_upsert_meta_whatsapp_channel(9892, 'meta-secure-a', 'waba-x', 'phone-x', NULL, NULL, 'META_ACCESS_X', 'META_SECRET_X', NULL, 'draft')$$,
  'P0002',
  'Instancia nao encontrada para esta conta',
  'tenant nao configura instancia de outra conta'
);

SELECT crm.rpc_bootstrap_meta_whatsapp_channel(
  9894,
  'meta-secure-bootstrap',
  'waba-bootstrap',
  'phone-bootstrap',
  'business-bootstrap',
  '+55 11 99999-0004',
  'META_BOOTSTRAP_ACCESS_TOKEN',
  'META_BOOTSTRAP_APP_SECRET',
  'META_BOOTSTRAP_VERIFY_TOKEN',
  'operator@test'
);

SELECT is(
  (SELECT count(*)::integer FROM meta.admin_audit_events WHERE aces_id = 9894 AND action = 'bootstrap' AND outcome = 'succeeded'),
  1,
  'bootstrap registra auditoria atomica'
);
SELECT crm.rpc_disable_meta_whatsapp_channel(
  9891,
  'meta-secure-a',
  'operator-disable@test'
);
SELECT is(
  (SELECT status FROM meta.whatsapp_channels WHERE aces_id = 9891 AND instance_name = 'meta-secure-a'),
  'disabled',
  'rollback desabilita o canal Meta sem apagar o registro'
);
SELECT is(
  (SELECT status FROM crm.instance_channels WHERE aces_id = 9891 AND instance_name = 'meta-secure-a'),
  'disabled',
  'rollback desabilita o binding canonico Meta'
);
SELECT is(
  (SELECT count(*)::integer FROM meta.admin_audit_events WHERE aces_id = 9891 AND action = 'disable' AND outcome = 'succeeded'),
  1,
  'rollback Meta registra auditoria atomica'
);
SELECT ok(
  COALESCE((meta.rpc_whatsapp_foundation_preflight()->>'ok')::boolean, false),
  'preflight da fundacao segura retorna ok'
);

SELECT * FROM finish();
ROLLBACK;
