BEGIN;

SELECT plan(7);

INSERT INTO crm.accounts (id, name, status)
VALUES (9601, 'Forwarding Integrity Test', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES (
  '96000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'seller9601@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
), (
  '96000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
  'admin9601@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES (
  '96100000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  'seller9601@test.local', 'Seller Integrity', 'VENDEDOR', 9601
), (
  '96100000-0000-0000-0000-000000000002',
  '96000000-0000-0000-0000-000000000002',
  'admin9601@test.local', 'Admin Integrity', 'ADMIN', 9601
);

INSERT INTO crm.empresas (
  id, aces_id, cnpj, legal_name, name, address, city, state, created_by
)
VALUES (
  '96200000-0000-0000-0000-000000000001', 9601, '12345678000195',
  'Forwarding Integrity Ltda', 'Forwarding Integrity', 'Rua A', 'Sao Paulo', 'SP',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO crm.empresa_memberships (aces_id, empresa_id, crm_user_id, granted_by)
VALUES (
  9601,
  '96200000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000001',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES (
  'forwarding-integrity-test', 9601, 'connected', 'connected',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO agents.ai_agents (
  id, aces_id, instance_name, name, system_prompt, model, created_by
)
VALUES (
  '96300000-0000-0000-0000-000000000001', 9601, 'forwarding-integrity-test',
  'Forwarding Integrity Agent', 'Atenda.', 'gemini-2.5-flash',
  '96100000-0000-0000-0000-000000000001'
);

INSERT INTO agents.agent_tools (
  id, aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config
)
VALUES (
  '96400000-0000-0000-0000-000000000001', 9601,
  '96300000-0000-0000-0000-000000000001', 'forwarding', 1, false,
  'needs_config', '{}'::jsonb
);

DO $$
BEGIN
  PERFORM agents.upsert_forwarding_destination_internal(
    9601,
    '96300000-0000-0000-0000-000000000001',
    '96400000-0000-0000-0000-000000000001',
    'admin-destination',
    'Admin Destination',
    '96200000-0000-0000-0000-000000000001',
    ARRAY['96100000-0000-0000-0000-000000000002']::uuid[],
    'Admin test'
  );
  RAISE EXCEPTION 'admin should be rejected';
EXCEPTION WHEN SQLSTATE '22023' THEN
  NULL;
END $$;

SELECT is(
  (SELECT count(*)::integer FROM agents.forwarding_destinations WHERE aces_id = 9601),
  0,
  'admin nao cria destino parcial'
);

SELECT agents.upsert_forwarding_destination_internal(
  9601,
  '96300000-0000-0000-0000-000000000001',
  '96400000-0000-0000-0000-000000000001',
  'seller-destination',
  'Seller Destination',
  '96200000-0000-0000-0000-000000000001',
  ARRAY['96100000-0000-0000-0000-000000000001']::uuid[],
  'Seller test'
) AS saved;

SELECT is(
  (SELECT count(*)::integer FROM agents.forwarding_destination_sellers WHERE aces_id = 9601),
  1,
  'vendedor valido e vinculado atomicamente'
);

SELECT is(
  agents.count_ready_forwarding_destinations(
    9601, '96400000-0000-0000-0000-000000000001'
  ),
  1::bigint,
  'destino com vendedor valido deixa a Tool pronta'
);

UPDATE crm.users
SET role = 'ADMIN'
WHERE id = '96100000-0000-0000-0000-000000000001';

SELECT is(
  agents.reconcile_forwarding_destination_sellers(9601),
  1,
  'reconciliacao remove vinculo que perdeu o papel de vendedor'
);

SELECT is(
  (SELECT count(*)::integer FROM agents.forwarding_destination_sellers WHERE aces_id = 9601),
  0,
  'vinculo invalido nao permanece'
);

SELECT is(
  (SELECT readiness FROM agents.agent_tools WHERE id = '96400000-0000-0000-0000-000000000001'),
  'needs_config',
  'Tool sem vendedor elegivel fica needs_config'
);

SELECT is(
  (SELECT count(*)::integer FROM agents.forwarding_destination_seller_quarantine WHERE aces_id = 9601),
  1,
  'vinculo removido fica registrado na quarentena'
);

SELECT * FROM finish();
ROLLBACK;
