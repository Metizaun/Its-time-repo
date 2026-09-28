BEGIN;

SELECT plan(11);

SELECT has_table('crm', 'commercial_catalog_products', 'catalogo comercial compartilhado existe');
SELECT has_table('crm', 'commercial_catalog_images', 'imagens comerciais existem');
SELECT has_table('crm', 'inbound_media_analyses', 'analises de anexos existem');
SELECT has_table('agents', 'commercial_catalog_categories', 'categorias por agente existem');
SELECT has_table('agents', 'commercial_catalog_image_visibility', 'imagens por agente existem');
SELECT ok(
  NOT has_table_privilege('anon', 'crm.commercial_catalog_products', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'crm.commercial_catalog_products', 'SELECT'),
  'catalogo nao e exposto diretamente ao navegador'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM crm.optical_catalog_products old_product
    WHERE NOT EXISTS (
      SELECT 1 FROM crm.commercial_catalog_products product
      WHERE product.legacy_optical_product_id = old_product.id
        AND product.aces_id = old_product.aces_id
        AND product.price_cents = old_product.price_cents
    )
  ),
  'lentes anteriores foram migradas com o mesmo preco'
);

INSERT INTO crm.accounts (id, name, status) VALUES
  (9896, 'Commercial Catalog Test', 'active'),
  (9897, 'Commercial Catalog Other Account', 'active');
INSERT INTO crm.instance (instancia, aces_id, status, setup_status) VALUES
  ('commercial-catalog-test-a', 9896, 'connected', 'connected'),
  ('commercial-catalog-test-b', 9896, 'connected', 'connected');
INSERT INTO agents.ai_agents (id, aces_id, instance_name, name, system_prompt) VALUES
  ('98960000-0000-0000-0000-000000000001', 9896, 'commercial-catalog-test-a', 'Catalog Agent X', 'Test only'),
  ('98960000-0000-0000-0000-000000000002', 9896, 'commercial-catalog-test-b', 'Catalog Agent Y', 'Test only');
INSERT INTO crm.commercial_catalog_products (id, aces_id, category, display_name, brand, price_cents) VALUES
  ('98961000-0000-0000-0000-000000000001', 9896, 'frames', 'Armacao Marca X', 'Marca X', 147600),
  ('98961000-0000-0000-0000-000000000002', 9896, 'lenses', 'Lente A', null, 150000);
INSERT INTO crm.commercial_catalog_images
  (id, aces_id, product_id, storage_path, mime_type, file_name, file_size)
VALUES
  ('98962000-0000-0000-0000-000000000001', 9896,
   '98961000-0000-0000-0000-000000000001', '9896/test/frame.jpg', 'image/jpeg', 'frame.jpg', 100);

SELECT is(
  (SELECT count(*)::integer FROM agents.commercial_catalog_categories WHERE aces_id = 9896),
  0, 'categorias novas comecam ocultas'
);
INSERT INTO agents.commercial_catalog_categories (aces_id, agent_id, category, is_enabled) VALUES
  (9896, '98960000-0000-0000-0000-000000000001', 'frames', true),
  (9896, '98960000-0000-0000-0000-000000000002', 'lenses', true);
INSERT INTO agents.commercial_catalog_image_visibility (aces_id, agent_id, image_id, is_enabled) VALUES
  (9896, '98960000-0000-0000-0000-000000000001', '98962000-0000-0000-0000-000000000001', true);

SELECT results_eq(
  $$SELECT category FROM agents.commercial_catalog_categories
    WHERE aces_id = 9896 AND agent_id = '98960000-0000-0000-0000-000000000001' AND is_enabled$$,
  $$VALUES ('frames'::text)$$,
  'liberar armacoes em X nao libera lentes'
);
SELECT is(
  (SELECT count(*)::integer FROM agents.commercial_catalog_image_visibility
   WHERE aces_id = 9896 AND agent_id = '98960000-0000-0000-0000-000000000002' AND is_enabled),
  0, 'imagem de X fica oculta em Y'
);
SELECT throws_ok(
  $$INSERT INTO agents.commercial_catalog_image_visibility (aces_id, agent_id, image_id, is_enabled)
    VALUES (9897, '98960000-0000-0000-0000-000000000001',
      '98962000-0000-0000-0000-000000000001', true)$$,
  'Agente pertence a outra conta',
  'visibilidade nao atravessa contas'
);

SELECT * FROM finish();
ROLLBACK;
