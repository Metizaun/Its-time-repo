BEGIN;

SELECT plan(12);

INSERT INTO crm.accounts (id, name, status)
VALUES (9501, 'Company Routing Closure', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('95000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'routing-admin@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('95000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'routing-seller-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('95000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'routing-seller-b@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('95000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'routing-seller-c@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('95100000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', 'routing-admin@test.local', 'Routing Admin', 'ADMIN', 9501),
  ('95100000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000002', 'routing-seller-a@test.local', 'Routing Seller A', 'VENDEDOR', 9501),
  ('95100000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000003', 'routing-seller-b@test.local', 'Routing Seller B', 'VENDEDOR', 9501),
  ('95100000-0000-0000-0000-000000000004', '95000000-0000-0000-0000-000000000004', 'routing-seller-c@test.local', 'Routing Seller C', 'VENDEDOR', 9501);

INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES ('routing-closure-test', 9501, 'connected', 'connected', '95100000-0000-0000-0000-000000000001');

INSERT INTO crm.empresas (id, aces_id, cnpj, legal_name, name, address, city, state, created_by)
VALUES
  ('95200000-0000-0000-0000-000000000001', 9501, '12345678000195', 'Batatinha Centro Ltda', 'Batatinha Centro', 'Rua A, 1', 'Sume', 'PB', '95100000-0000-0000-0000-000000000001'),
  ('95200000-0000-0000-0000-000000000002', 9501, '12ABC34501DE35', 'Batatinha Norte Ltda', 'Batatinha Norte', 'Rua B, 2', 'Jatauba', 'PE', '95100000-0000-0000-0000-000000000001');

INSERT INTO crm.empresa_memberships (aces_id, empresa_id, crm_user_id, granted_by)
SELECT 9501, '95200000-0000-0000-0000-000000000001', crm_user_id,
       '95100000-0000-0000-0000-000000000001'
FROM unnest(ARRAY[
  '95100000-0000-0000-0000-000000000002'::uuid,
  '95100000-0000-0000-0000-000000000003'::uuid,
  '95100000-0000-0000-0000-000000000004'::uuid
]) AS crm_user_id;

INSERT INTO crm.instance_access_memberships (aces_id, instance_name, crm_user_id, access_level, granted_by)
SELECT 9501, 'routing-closure-test', crm_user_id, 'editor',
       '95100000-0000-0000-0000-000000000001'
FROM unnest(ARRAY[
  '95100000-0000-0000-0000-000000000002'::uuid,
  '95100000-0000-0000-0000-000000000003'::uuid,
  '95100000-0000-0000-0000-000000000004'::uuid
]) AS crm_user_id;

INSERT INTO crm.leads (id, aces_id, name, contact_phone, instancia)
VALUES
  ('95300000-0000-0000-0000-000000000001', 9501, 'Lead Routing', '559500000001', 'routing-closure-test'),
  ('95300000-0000-0000-0000-000000000002', 9501, 'Lead Fallback', '559500000002', 'routing-closure-test');

INSERT INTO agents.ai_agents (
  id, aces_id, instance_name, name, system_prompt, model, created_by
)
VALUES (
  '95400000-0000-0000-0000-000000000001', 9501, 'routing-closure-test',
  'Routing Agent', 'Atenda com objetividade.', 'gemini-2.5-flash',
  '95100000-0000-0000-0000-000000000001'
);

INSERT INTO agents.agent_tools (
  id, aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config
)
VALUES (
  '95500000-0000-0000-0000-000000000001', 9501,
  '95400000-0000-0000-0000-000000000001', 'forwarding', 1, true, 'ready', '{}'::jsonb
);

INSERT INTO agents.forwarding_destinations (
  id, aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id
)
VALUES
  ('95600000-0000-0000-0000-000000000001', 9501, '95500000-0000-0000-0000-000000000001', 'batatinha', 'Batatinha Centro', 'internal_company', '95200000-0000-0000-0000-000000000001'),
  ('95600000-0000-0000-0000-000000000002', 9501, '95500000-0000-0000-0000-000000000001', 'fallback', 'Batatinha sem vendedor', 'internal_company', '95200000-0000-0000-0000-000000000001');

INSERT INTO agents.forwarding_destination_sellers (aces_id, forwarding_destination_id, crm_user_id)
VALUES
  (9501, '95600000-0000-0000-0000-000000000001', '95100000-0000-0000-0000-000000000002'),
  (9501, '95600000-0000-0000-0000-000000000001', '95100000-0000-0000-0000-000000000003');

SET LOCAL ROLE service_role;

CREATE TEMP TABLE routed AS
SELECT crm.service_route_company_lead(
  9501,
  '95300000-0000-0000-0000-000000000001',
  '95400000-0000-0000-0000-000000000001',
  '95600000-0000-0000-0000-000000000001',
  'Cliente pediu atendimento',
  '{}'::jsonb,
  'routing-closure-success'
) AS result;
GRANT SELECT ON routed TO authenticated;

SELECT is((SELECT result ->> 'success' FROM routed), 'true', 'encaminhamento cria fila com sucesso');
SELECT is((SELECT count(*)::integer FROM crm.routing_event_recipients), 2, 'somente vendedores selecionados viram destinatarios');
SELECT is((SELECT count(*)::integer FROM crm.notifications WHERE routing_event_id IS NOT NULL), 1, 'fila gera uma notificacao normalizada');
SELECT is(
  (SELECT count(*)::integer FROM crm.lookup_company_directory('Batatinha', NULL, NULL, 4, 9501)),
  2,
  'busca retorna no maximo as empresas compativeis do tenant'
);
SELECT ok(
  (SELECT bool_and(is_ambiguous) FROM crm.lookup_company_directory('Batatinha', NULL, NULL, 4, 9501)),
  'busca explicita a ambiguidade'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"95000000-0000-0000-0000-000000000004","role":"authenticated"}', TRUE);
SELECT is((SELECT count(*)::integer FROM crm.rpc_list_routing_queue(NULL, 50, NULL)), 0, 'vendedor nao selecionado nao enxerga a fila');

SELECT set_config('request.jwt.claims', '{"sub":"95000000-0000-0000-0000-000000000002","role":"authenticated"}', TRUE);
SELECT is(
  crm.rpc_claim_routing_event((SELECT (result ->> 'routing_event_id')::uuid FROM routed)) ->> 'claimed',
  'true',
  'primeiro vendedor assume atomicamente'
);

SELECT set_config('request.jwt.claims', '{"sub":"95000000-0000-0000-0000-000000000003","role":"authenticated"}', TRUE);
SELECT is(
  crm.rpc_claim_routing_event((SELECT (result ->> 'routing_event_id')::uuid FROM routed)) ->> 'claimed',
  'false',
  'segundo vendedor nao captura o mesmo atendimento'
);

RESET ROLE;
SELECT is(
  (SELECT owner_id FROM crm.leads WHERE id = '95300000-0000-0000-0000-000000000001'),
  '95100000-0000-0000-0000-000000000002'::uuid,
  'lead fica sob responsabilidade do primeiro vendedor'
);

SET LOCAL ROLE service_role;
CREATE TEMP TABLE fallback AS
SELECT crm.service_route_company_lead(
  9501,
  '95300000-0000-0000-0000-000000000002',
  '95400000-0000-0000-0000-000000000001',
  '95600000-0000-0000-0000-000000000002',
  'Destino sem vendedor',
  '{}'::jsonb,
  'routing-closure-fallback'
) AS result;
SELECT is((SELECT result ->> 'fallback_required' FROM fallback), 'true', 'destino sem vendedor solicita handoff geral');
RESET ROLE;
SELECT is(
  (SELECT interaction_mode FROM crm.leads WHERE id = '95300000-0000-0000-0000-000000000002'),
  'ai',
  'fallback nao restringe nem oculta o lead'
);
SELECT is(
  (SELECT empresa_id FROM crm.leads WHERE id = '95300000-0000-0000-0000-000000000002'),
  NULL::uuid,
  'fallback preserva empresa nula para o handoff geral'
);

SELECT * FROM finish();
ROLLBACK;
