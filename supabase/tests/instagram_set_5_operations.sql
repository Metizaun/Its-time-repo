BEGIN;

SELECT plan(17);

SELECT has_table('instagram', 'admin_audit_events', 'auditoria administrativa Instagram existe');
SELECT has_column('instagram', 'admin_audit_events', 'outcome', 'auditoria registra resultado');
SELECT ok(has_function_privilege('service_role', 'instagram.rpc_claim_manual_token_refresh(uuid,integer,text,integer,integer)', 'EXECUTE'), 'service_role executa claim manual');
SELECT ok(has_function_privilege('service_role', 'instagram.rpc_disable_channel(uuid,integer,uuid)', 'EXECUTE'), 'service_role executa desativacao');
SELECT ok(has_function_privilege('service_role', 'instagram.rpc_mark_reconnect_required(uuid,integer,text)', 'EXECUTE'), 'service_role executa transicao de reconexao');
SELECT ok(NOT has_function_privilege('authenticated', 'instagram.rpc_disable_channel(uuid,integer,uuid)', 'EXECUTE'), 'authenticated nao executa desativacao');

INSERT INTO crm.accounts (id, name, status)
VALUES (9893, 'Instagram Operations A', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '98930000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'instagram-ops@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES (
  '98930000-0000-0000-0000-000000000002',
  '98930000-0000-0000-0000-000000000001',
  'instagram-ops@test.local', 'Admin Instagram Operations', 'ADMIN', 9893
);

INSERT INTO crm.instance (instancia, aces_id, created_by, status, setup_status, connection_mode)
VALUES ('instagram-operations-a', 9893, '98930000-0000-0000-0000-000000000002', 'connected', 'connected', 'instagram');

INSERT INTO crm.instance_channels (id, aces_id, instance_name, channel_type, provider, capability, status)
VALUES ('98930000-0000-0000-0000-000000000010', 9893, 'instagram-operations-a', 'instagram', 'instagram', 'manual_only', 'active');

INSERT INTO instagram.channels (
  channel_id, aces_id, ig_user_id, token_obtained_at, token_expires_at,
  next_refresh_at, health_status
) VALUES (
  '98930000-0000-0000-0000-000000000010', 9893, 'ig-operations-a',
  now() - interval '48 hours', now() + interval '20 days',
  now() - interval '1 minute', 'healthy'
);

INSERT INTO instagram.channel_credentials (channel_id, access_token_ciphertext, iv, auth_tag, key_version)
VALUES ('98930000-0000-0000-0000-000000000010', decode(repeat('11', 32), 'hex'), decode(repeat('22', 12), 'hex'), decode(repeat('33', 16), 'hex'), 'test-v1');

SELECT is((SELECT count(*)::integer FROM instagram.rpc_claim_manual_token_refresh(
  '98930000-0000-0000-0000-000000000010', 9893, 'manual-a', 24, 120
)), 1, 'claim manual respeita idade minima e agenda');
SELECT is((SELECT count(*)::integer FROM instagram.rpc_claim_manual_token_refresh(
  '98930000-0000-0000-0000-000000000010', 9893, 'manual-b', 24, 120
)), 0, 'segundo claim nao ignora lease');

UPDATE instagram.channels
SET token_expires_at = now() - interval '1 minute', health_status = 'healthy'
WHERE channel_id = '98930000-0000-0000-0000-000000000010';
SELECT ok(instagram.rpc_mark_reconnect_required(
  '98930000-0000-0000-0000-000000000010', 9893, 'token_expired'
), 'token expirado muda o canal para reconexao');
SELECT is((SELECT health_status FROM instagram.channels WHERE channel_id = '98930000-0000-0000-0000-000000000010'), 'reconnect_required', 'token expirado registra reconexao necessaria');
SELECT is((SELECT status FROM crm.instance_channels WHERE id = '98930000-0000-0000-0000-000000000010'), 'reconnect_required', 'binding Instagram acompanha reconexao necessaria');

SELECT is(
  instagram.rpc_disable_channel(
    '98930000-0000-0000-0000-000000000010', 9893,
    '98930000-0000-0000-0000-000000000002'
  )->>'status',
  'disabled',
  'desativacao retorna estado disabled'
);
SELECT is((SELECT status FROM crm.instance_channels WHERE id = '98930000-0000-0000-0000-000000000010'), 'disabled', 'desativacao atualiza binding Instagram');
SELECT is((SELECT health_status FROM instagram.channels WHERE channel_id = '98930000-0000-0000-0000-000000000010'), 'disabled', 'desativacao atualiza saude Instagram');
SELECT is((SELECT count(*)::integer FROM instagram.admin_audit_events WHERE action = 'disable' AND outcome = 'succeeded'), 1, 'desativacao gera auditoria');

SELECT instagram.rpc_record_refresh_alert('98930000-0000-0000-0000-000000000010', 9893, 'meta_expired', true);
SELECT instagram.rpc_record_refresh_alert('98930000-0000-0000-0000-000000000010', 9893, 'meta_expired', true);
SELECT is((SELECT count(*)::integer FROM crm.notifications WHERE idempotency_key LIKE 'instagram_refresh_failure:98930000-0000-0000-0000-000000000010:%'), 1, 'alerta de refresh e idempotente');

SELECT ok((instagram.rpc_operational_metrics(9893, now() - interval '1 day') ? 'webhookPersistenceLatencyMs'), 'metricas retornam latencia de persistencia');

SELECT * FROM finish();
ROLLBACK;
