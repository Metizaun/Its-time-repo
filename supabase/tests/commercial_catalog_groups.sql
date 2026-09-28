BEGIN;
SELECT plan(15);

SELECT has_table('crm', 'commercial_catalog_groups', 'categorias comerciais compartilhadas existem');
SELECT has_column('crm', 'commercial_catalog_products', 'catalog_group_id', 'itens podem pertencer a categoria');
SELECT has_table('agents', 'commercial_catalog_group_visibility', 'acesso a categoria pertence ao agente');
SELECT has_table('agents', 'commercial_catalog_uncategorized_visibility', 'Sem categoria tem acesso proprio');
SELECT ok(NOT has_table_privilege('authenticated', 'crm.commercial_catalog_groups', 'SELECT'),
  'categorias nao sao expostas diretamente ao navegador');

INSERT INTO crm.accounts (id, name, status) VALUES
  (9898, 'Catalog Groups Test', 'active'),
  (9899, 'Catalog Groups Other Account', 'active');
INSERT INTO crm.instance (instancia, aces_id, status, setup_status) VALUES
  ('catalog-groups-test-a', 9898, 'connected', 'connected');
INSERT INTO agents.ai_agents (id, aces_id, instance_name, name, system_prompt) VALUES
  ('98980000-0000-0000-0000-000000000001', 9898, 'catalog-groups-test-a', 'Catalog Agent', 'Test only');
INSERT INTO crm.commercial_catalog_groups (id, aces_id, item_type, name) VALUES
  ('98981000-0000-0000-0000-000000000001', 9898, 'frames', 'Solar'),
  ('98981000-0000-0000-0000-000000000003', 9898, 'frames', 'Grau'),
  ('98981000-0000-0000-0000-000000000002', 9899, 'frames', 'Outra conta');

SELECT is((SELECT count(*)::integer FROM agents.commercial_catalog_group_visibility WHERE aces_id = 9898), 0,
  'categoria nova comeca oculta para o agente');
SELECT is((SELECT count(*)::integer FROM agents.commercial_catalog_uncategorized_visibility WHERE aces_id = 9898), 0,
  'Sem categoria de agente novo comeca oculto');
SELECT throws_ok(
  $$INSERT INTO crm.commercial_catalog_products (aces_id, category, catalog_group_id, display_name, price_cents)
    VALUES (9898, 'lenses', '98981000-0000-0000-0000-000000000001', 'Lente incorreta', 1000)$$,
  '23503', NULL, 'produto nao pode entrar em categoria de outro tipo');
SELECT throws_ok(
  $$INSERT INTO crm.commercial_catalog_products (aces_id, category, catalog_group_id, display_name, price_cents)
    VALUES (9898, 'frames', '98981000-0000-0000-0000-000000000002', 'Outra conta', 1000)$$,
  '23503', NULL, 'produto nao pode usar categoria de outra conta');
INSERT INTO crm.commercial_catalog_products (id, aces_id, category, catalog_group_id, display_name, price_cents)
  VALUES ('98982000-0000-0000-0000-000000000001', 9898, 'frames',
    '98981000-0000-0000-0000-000000000001', 'Armacao Solar', 147600);
UPDATE crm.commercial_catalog_products
  SET catalog_group_id = '98981000-0000-0000-0000-000000000003'
  WHERE id = '98982000-0000-0000-0000-000000000001';
SELECT is((SELECT catalog_group_id FROM crm.commercial_catalog_products
  WHERE id = '98982000-0000-0000-0000-000000000001'), '98981000-0000-0000-0000-000000000003'::uuid,
  'item pode ser movido entre categorias do mesmo tipo');
UPDATE crm.commercial_catalog_products SET catalog_group_id = NULL
  WHERE id = '98982000-0000-0000-0000-000000000001';
SELECT is((SELECT catalog_group_id FROM crm.commercial_catalog_products
  WHERE id = '98982000-0000-0000-0000-000000000001'), NULL::uuid,
  'item pode voltar para Sem categoria');
UPDATE crm.commercial_catalog_products
  SET catalog_group_id = '98981000-0000-0000-0000-000000000001'
  WHERE id = '98982000-0000-0000-0000-000000000001';
SELECT throws_ok(
  $$SELECT crm.delete_commercial_catalog_group(9898, '98981000-0000-0000-0000-000000000001')$$,
  '23503', NULL, 'categoria com item ativo nao pode ser excluida');
UPDATE crm.commercial_catalog_products SET is_active = false
  WHERE id = '98982000-0000-0000-0000-000000000001';
SELECT lives_ok(
  $$SELECT crm.delete_commercial_catalog_group(9898, '98981000-0000-0000-0000-000000000001')$$,
  'categoria com itens apenas inativos pode ser excluida');
SELECT is((SELECT catalog_group_id FROM crm.commercial_catalog_products
  WHERE id = '98982000-0000-0000-0000-000000000001'), NULL::uuid,
  'item inativo volta para Sem categoria');
SELECT is((SELECT is_active FROM crm.commercial_catalog_products
  WHERE id = '98982000-0000-0000-0000-000000000001'), false,
  'item inativo permanece inativo');

SELECT * FROM finish();
ROLLBACK;
