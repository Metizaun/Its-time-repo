BEGIN;

SELECT plan(21);

SELECT has_schema('locator', 'schema privado locator existe');
SELECT has_table('locator', 'stores', 'catalogo privado de filiais existe');
SELECT has_table('locator', 'route_cache', 'cache de rotas existe');
SELECT has_table('locator', 'lead_store_preferences', 'preferencias de filial existem');
SELECT has_table('locator', 'lead_location_events', 'eventos de localizacao existem');
SELECT has_function('locator', 'find_nearest_stores', ARRAY['integer', 'double precision', 'double precision', 'integer'], 'busca PostGIS existe');
SELECT has_function('locator', 'set_lead_store_preference', ARRAY['integer', 'uuid', 'uuid', 'text', 'text', 'uuid'], 'gravacao atomica de preferencia existe');
SELECT has_index('locator', 'stores', 'locator_stores_location_gix', 'filiais usam indice GiST');
SELECT has_index('locator', 'lead_store_preferences', 'locator_lead_store_preferences_current_type_uidx', 'preferencia atual possui unicidade parcial');
SELECT is(
  (SELECT count(*)::integer FROM cron.job WHERE jobname = 'locator_purge_expired_location_data_daily'),
  1,
  'retencao possui limpeza diaria agendada'
);

SELECT ok(
  NOT has_table_privilege('anon', 'locator.stores', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'locator.stores', 'SELECT'),
  'catalogo nao e exposto ao navegador'
);
SELECT ok(
  has_table_privilege('service_role', 'locator.stores', 'SELECT')
  AND has_table_privilege('service_role', 'locator.stores', 'INSERT'),
  'backend service_role gerencia o catalogo'
);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9891, 'Store Locator Test', 'active'),
  (9892, 'Store Locator Other Tenant', 'active');

INSERT INTO crm.instance (instancia, aces_id, status, setup_status)
VALUES ('store-locator-test', 9891, 'connected', 'connected');

INSERT INTO crm.leads (id, aces_id, name, contact_phone, instancia)
VALUES ('98910000-0000-0000-0000-000000000001', 9891, 'Lead Locator', '559899999999', 'store-locator-test');

INSERT INTO locator.stores (
  id, aces_id, display_name, address_line, address_number, neighborhood, city, state,
  postal_code, address_hash, location, geocode_status, geocode_provider, geocode_accuracy,
  geocoded_at, is_active, ai_visible
)
VALUES
  (
    '98911000-0000-0000-0000-000000000001', 9891, 'Loja Perto', 'Rua A', '10', 'Centro',
    'Curitiba', 'PR', '80000000', repeat('a', 64),
    'SRID=4326;POINT(-49.2733 -25.4284)'::extensions.geography,
    'ready', 'test', 'ROOFTOP', now(), true, true
  ),
  (
    '98911000-0000-0000-0000-000000000002', 9891, 'Loja Longe', 'Rua B', '20', 'Centro',
    'Curitiba', 'PR', '80000001', repeat('b', 64),
    'SRID=4326;POINT(-49.3733 -25.5284)'::extensions.geography,
    'ready', 'test', 'ROOFTOP', now(), true, true
  ),
  (
    '98921000-0000-0000-0000-000000000001', 9892, 'Outra Conta', 'Rua C', '30', 'Centro',
    'Curitiba', 'PR', '80000002', repeat('c', 64),
    'SRID=4326;POINT(-49.2733 -25.4284)'::extensions.geography,
    'ready', 'test', 'ROOFTOP', now(), true, true
  );

SELECT results_eq(
  $$
    SELECT display_name
    FROM locator.find_nearest_stores(9891, -25.4284, -49.2733, 2)
    ORDER BY straight_line_distance_meters
  $$,
  $$ VALUES ('Loja Perto'::text), ('Loja Longe'::text) $$,
  'busca ordena apenas filiais do tenant por distancia'
);

SELECT is(
  (SELECT count(*)::integer FROM crm.empresas WHERE aces_id = 9891),
  0,
  'filiais da Tool nao aparecem em crm.empresas'
);

SELECT lives_ok(
  $$ SELECT locator.set_lead_store_preference(
    9891,
    '98910000-0000-0000-0000-000000000001',
    '98911000-0000-0000-0000-000000000001',
    'favorite',
    'lead',
    NULL
  ) $$,
  'lead confirma a filial favorita'
);

SELECT lives_ok(
  $$ SELECT locator.set_lead_store_preference(
    9891,
    '98910000-0000-0000-0000-000000000001',
    '98911000-0000-0000-0000-000000000001',
    'favorite',
    'lead',
    NULL
  ) $$,
  'confirmacao repetida da mesma filial e idempotente'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM locator.lead_store_preferences
    WHERE aces_id = 9891
      AND lead_id = '98910000-0000-0000-0000-000000000001'
      AND preference_type = 'favorite'
      AND superseded_at IS NULL
  ),
  1,
  'existe somente uma favorita atual'
);

SELECT lives_ok(
  $$ SELECT locator.set_lead_store_preference(
    9891,
    '98910000-0000-0000-0000-000000000001',
    '98911000-0000-0000-0000-000000000002',
    'secondary',
    'lead',
    NULL
  ) $$,
  'lead pode confirmar uma filial secundaria'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM locator.lead_store_preferences
    WHERE aces_id = 9891
      AND lead_id = '98910000-0000-0000-0000-000000000001'
      AND superseded_at IS NULL
  ),
  2,
  'favorita e secundaria coexistem'
);

SELECT throws_ok(
  $$ SELECT locator.set_lead_store_preference(
    9891,
    '98910000-0000-0000-0000-000000000001',
    '98921000-0000-0000-0000-000000000001',
    'favorite',
    'lead',
    NULL
  ) $$,
  'Store does not belong to the requested account',
  'nao e possivel associar filial de outro tenant'
);

INSERT INTO locator.lead_location_events (
  aces_id, lead_id, raw_location_text, normalized_location_text,
  latitude, longitude, location, candidate_store_ids, recommended_store_id
)
VALUES (
  9891,
  '98910000-0000-0000-0000-000000000001',
  'Boqueirao',
  'boqueirao',
  -25.5000,
  -49.2500,
  'SRID=4326;POINT(-49.2500 -25.5000)'::extensions.geography,
  ARRAY['98911000-0000-0000-0000-000000000001'::uuid, '98911000-0000-0000-0000-000000000002'::uuid],
  '98911000-0000-0000-0000-000000000001'
);

SELECT is(
  (
    SELECT (expires_at - captured_at) >= interval '364 days'
    FROM locator.lead_location_events
    WHERE aces_id = 9891
  ),
  true,
  'localizacao exata recebe retencao de 12 meses'
);

SELECT * FROM finish();
ROLLBACK;
