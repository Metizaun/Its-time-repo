BEGIN;

SELECT plan(25);

SELECT has_column('instagram', 'channels', 'next_refresh_at', 'canal possui agenda de refresh');
SELECT has_column('instagram', 'webhook_events', 'normalized_payload', 'webhook persiste payload normalizado');
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'instagram.rpc_begin_oauth(integer,text,uuid,bytea,bytea,text,text,timestamptz)',
    'EXECUTE'
  ),
  'usuario autenticado nao executa RPC OAuth backend-only'
);
SELECT ok(
  has_function_privilege(
    'service_role',
    'instagram.rpc_begin_oauth(integer,text,uuid,bytea,bytea,text,text,timestamptz)',
    'EXECUTE'
  ),
  'service_role executa RPC OAuth'
);

INSERT INTO crm.accounts (id, name, status)
VALUES (9891, 'Instagram Runtime A', 'active'), (9892, 'Instagram Runtime B', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('98900000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'instagram-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('98900000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'instagram-b@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('98910000-0000-0000-0000-000000000001', '98900000-0000-0000-0000-000000000001', 'instagram-a@test.local', 'Admin Instagram A', 'ADMIN', 9891),
  ('98920000-0000-0000-0000-000000000001', '98900000-0000-0000-0000-000000000002', 'instagram-b@test.local', 'Admin Instagram B', 'ADMIN', 9892);

CREATE TEMP TABLE oauth_begin AS
SELECT instagram.rpc_begin_oauth(
  9891,
  'instagram-runtime-a',
  '98910000-0000-0000-0000-000000000001',
  decode(repeat('aa', 32), 'hex'),
  decode(repeat('bb', 32), 'hex'),
  '/admin?section=instances',
  'https://api.test.local/api/instagram/oauth/callback',
  now() + interval '10 minutes'
) AS result;

SELECT ok((SELECT result ? 'channelId' FROM oauth_begin), 'inicio OAuth cria o binding');
SELECT is(
  (SELECT connection_mode FROM crm.instance WHERE instancia = 'instagram-runtime-a'),
  'instagram',
  'instancia fica explicitamente vinculada ao Instagram'
);
SELECT is(
  (SELECT provider FROM crm.instance_channels WHERE instance_name = 'instagram-runtime-a'),
  'instagram',
  'binding canonico usa provider Instagram'
);

SELECT throws_ok(
  $$
    SELECT instagram.rpc_begin_oauth(
      9892, 'instagram-runtime-a', '98920000-0000-0000-0000-000000000001',
      decode(repeat('cc', 32), 'hex'), decode(repeat('dd', 32), 'hex'),
      '/admin', 'https://api.test.local/api/instagram/oauth/callback', now() + interval '10 minutes'
    )
  $$,
  'P0001',
  'Nome de instancia ja utilizado',
  'tenant diferente nao reutiliza nome de instancia'
);

CREATE TEMP TABLE oauth_claim AS
SELECT instagram.rpc_claim_oauth(
  decode(repeat('aa', 32), 'hex'),
  decode(repeat('ee', 32), 'hex')
) AS result;

SELECT ok((SELECT result ? 'stateId' FROM oauth_claim), 'primeiro callback reivindica o state');
SELECT throws_ok(
  $$ SELECT instagram.rpc_claim_oauth(decode(repeat('aa', 32), 'hex'), decode(repeat('ee', 32), 'hex')) $$,
  'P0001',
  'Estado OAuth invalido, expirado ou ja utilizado',
  'callback repetido nao executa nova troca'
);

CREATE TEMP TABLE oauth_complete AS
SELECT instagram.rpc_complete_oauth(
  (SELECT (result->>'stateId')::uuid FROM oauth_claim),
  'ig-account-runtime-a',
  'runtime_a',
  decode(repeat('11', 32), 'hex'),
  decode(repeat('22', 12), 'hex'),
  decode(repeat('33', 16), 'hex'),
  'test-v1',
  now(),
  now() + interval '60 days',
  now() + interval '30 days'
) AS result;

SELECT is((SELECT result->>'igUserId' FROM oauth_complete), 'ig-account-runtime-a', 'OAuth ativa a conta autorizada');
SELECT is(
  (SELECT health_status FROM instagram.channels WHERE ig_user_id = 'ig-account-runtime-a'),
  'healthy',
  'canal concluido fica saudavel'
);
SELECT is(
  (SELECT status FROM crm.instance_channels WHERE instance_name = 'instagram-runtime-a'),
  'active',
  'binding concluido fica ativo'
);
SELECT ok(
  (SELECT access_token_ciphertext <> convert_to('token-em-texto-puro', 'UTF8') FROM instagram.channel_credentials LIMIT 1),
  'banco recebe somente token cifrado'
);

INSERT INTO instagram.webhook_events (
  event_key, channel_id, aces_id, external_account_id, event_type,
  payload_summary, normalized_payload
) VALUES (
  'instagram:ig-account-runtime-a:message-1',
  (SELECT channel_id FROM instagram.channels WHERE ig_user_id = 'ig-account-runtime-a'),
  9891,
  'ig-account-runtime-a',
  'message_text',
  '{"providerMessageId":"message-1"}',
  '{"providerMessageId":"message-1","senderId":"igsid-runtime","text":"Ola"}'
);

SELECT throws_ok(
  $$
    INSERT INTO instagram.webhook_events (event_key, event_type)
    VALUES ('instagram:ig-account-runtime-a:message-1', 'message_text')
  $$,
  '23505',
  NULL,
  'evento repetido e deduplicado pela chave duravel'
);

CREATE TEMP TABLE webhook_claim_1 AS
SELECT * FROM instagram.rpc_claim_webhook_events('worker-a', 10, 60);
CREATE TEMP TABLE webhook_claim_2 AS
SELECT * FROM instagram.rpc_claim_webhook_events('worker-b', 10, 60);

SELECT is((SELECT count(*)::integer FROM webhook_claim_1), 1, 'primeiro worker recebe o evento');
SELECT is((SELECT count(*)::integer FROM webhook_claim_2), 0, 'segundo worker nao recebe o mesmo evento');
SELECT is(
  instagram.rpc_complete_webhook_event((SELECT id FROM webhook_claim_1), 'worker-b', 'processed'),
  false,
  'worker sem lease nao conclui o evento'
);
SELECT is(
  instagram.rpc_complete_webhook_event((SELECT id FROM webhook_claim_1), 'worker-a', 'processed'),
  true,
  'worker dono do lease conclui o evento'
);

INSERT INTO instagram.webhook_events (
  event_key, event_type, status, attempt_count, claimed_by, claimed_at, lease_expires_at
) VALUES (
  'instagram:ig-account-runtime-a:dead-letter',
  'message_text',
  'processing',
  5,
  'worker-dead-letter',
  now(),
  now() + interval '1 minute'
);

SELECT is(
  instagram.rpc_fail_webhook_event(
    (SELECT id FROM instagram.webhook_events WHERE event_key = 'instagram:ig-account-runtime-a:dead-letter'),
    'worker-dead-letter',
    'forced_test_failure',
    5
  ),
  true,
  'quinta falha finaliza o evento'
);
SELECT is(
  (SELECT status FROM instagram.webhook_events WHERE event_key = 'instagram:ig-account-runtime-a:dead-letter'),
  'dead_letter',
  'evento vai para dead letter depois de cinco tentativas'
);

UPDATE instagram.channels
SET next_refresh_at = now() - interval '1 minute'
WHERE ig_user_id = 'ig-account-runtime-a';

CREATE TEMP TABLE refresh_claim_1 AS
SELECT * FROM instagram.rpc_claim_token_refreshes('refresh-a', 5, 120);
CREATE TEMP TABLE refresh_claim_2 AS
SELECT * FROM instagram.rpc_claim_token_refreshes('refresh-b', 5, 120);

SELECT is((SELECT count(*)::integer FROM refresh_claim_1), 1, 'primeiro worker recebe o refresh');
SELECT is((SELECT count(*)::integer FROM refresh_claim_2), 0, 'segundo worker nao recebe o mesmo refresh');
SELECT is(
  instagram.rpc_complete_token_refresh(
    (SELECT channel_id FROM refresh_claim_1), 'refresh-b',
    decode(repeat('44', 32), 'hex'), decode(repeat('55', 12), 'hex'), decode(repeat('66', 16), 'hex'),
    'test-v1', now() + interval '60 days', now() + interval '30 days'
  ),
  false,
  'worker sem lease nao conclui refresh'
);
SELECT is(
  instagram.rpc_complete_token_refresh(
    (SELECT channel_id FROM refresh_claim_1), 'refresh-a',
    decode(repeat('44', 32), 'hex'), decode(repeat('55', 12), 'hex'), decode(repeat('66', 16), 'hex'),
    'test-v1', now() + interval '60 days', now() + interval '30 days'
  ),
  true,
  'worker dono do lease conclui refresh'
);

SELECT * FROM finish();
ROLLBACK;
