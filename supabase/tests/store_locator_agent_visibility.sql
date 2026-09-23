BEGIN;

SELECT plan(9);

SELECT has_table('locator', 'agent_store_visibility', 'visibilidade por agente existe');
SELECT has_function(
  'locator',
  'find_nearest_stores_for_agent',
  ARRAY['integer', 'uuid', 'double precision', 'double precision', 'integer'],
  'busca de filiais filtra por agente'
);
SELECT has_index(
  'locator',
  'agent_store_visibility',
  'locator_agent_store_visibility_lookup_idx',
  'visibilidade possui indice por conta e agente'
);
SELECT has_index(
  'locator',
  'agent_store_visibility',
  'locator_agent_store_visibility_store_idx',
  'visibilidade possui indice para cascata por filial'
);
SELECT ok(
  NOT has_table_privilege('anon', 'locator.agent_store_visibility', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'locator.agent_store_visibility', 'SELECT'),
  'visibilidade nao e exposta ao navegador'
);
SELECT ok(
  has_table_privilege('service_role', 'locator.agent_store_visibility', 'SELECT')
  AND has_table_privilege('service_role', 'locator.agent_store_visibility', 'UPDATE'),
  'backend service_role gerencia a visibilidade'
);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9894, 'Store Locator Visibility Test', 'active'),
  (9895, 'Store Locator Visibility Other Tenant', 'active');

INSERT INTO crm.instance (instancia, aces_id, status, setup_status)
VALUES
  ('store-locator-visibility-a', 9894, 'connected', 'connected'),
  ('store-locator-visibility-b', 9894, 'connected', 'connected');

INSERT INTO agents.ai_agents (id, aces_id, instance_name, name, system_prompt)
VALUES
  ('98940000-0000-0000-0000-000000000001', 9894, 'store-locator-visibility-a', 'Visibility Agent A', 'Test only'),
  ('98940000-0000-0000-0000-000000000002', 9894, 'store-locator-visibility-b', 'Visibility Agent B', 'Test only');

INSERT INTO locator.stores (
  id, aces_id, display_name, address_line, address_number, neighborhood, city, state,
  postal_code, address_hash, location, geocode_status, geocode_provider, geocode_accuracy,
  geocoded_at, is_active, ai_visible
)
VALUES
  (
    '98941000-0000-0000-0000-000000000001', 9894, 'Filial Oculta', 'Rua A', '10', 'Centro',
    'Curitiba', 'PR', '80000000', repeat('a', 64),
    'SRID=4326;POINT(-49.2733 -25.4284)'::extensions.geography,
    'ready', 'test', 'ROOFTOP', now(), true, true
  ),
  (
    '98941000-0000-0000-0000-000000000002', 9894, 'Filial Visivel', 'Rua B', '20', 'Centro',
    'Curitiba', 'PR', '80000001', repeat('b', 64),
    'SRID=4326;POINT(-49.3733 -25.5284)'::extensions.geography,
    'ready', 'test', 'ROOFTOP', now(), true, true
  );

INSERT INTO locator.agent_store_visibility (aces_id, agent_id, store_id, is_visible)
VALUES (
  9894,
  '98940000-0000-0000-0000-000000000001',
  '98941000-0000-0000-0000-000000000001',
  false
);

SELECT results_eq(
  $$
    SELECT display_name
    FROM locator.find_nearest_stores_for_agent(
      9894,
      '98940000-0000-0000-0000-000000000001',
      -25.4284,
      -49.2733,
      5
    )
  $$,
  $$ VALUES ('Filial Visivel'::text) $$,
  'filial desativada some somente para o agente selecionado'
);

SELECT results_eq(
  $$
    SELECT display_name
    FROM locator.find_nearest_stores_for_agent(
      9894,
      '98940000-0000-0000-0000-000000000002',
      -25.4284,
      -49.2733,
      5
    )
    ORDER BY display_name
  $$,
  $$ VALUES ('Filial Oculta'::text), ('Filial Visivel'::text) $$,
  'outro agente continua vendo a filial'
);

SELECT throws_ok(
  $$
    INSERT INTO locator.agent_store_visibility (aces_id, agent_id, store_id, is_visible)
    VALUES (
      9895,
      '98940000-0000-0000-0000-000000000001',
      '98941000-0000-0000-0000-000000000001',
      false
    )
  $$,
  'Agent does not belong to the requested account',
  'nao permite cruzar agente e conta'
);

SELECT * FROM finish();
ROLLBACK;
