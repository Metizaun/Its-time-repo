BEGIN;

SELECT plan(9);

SELECT has_table('locator', 'store_folders', 'pastas da Busca de filiais existem');
SELECT has_column('locator', 'stores', 'folder_id', 'filial pode pertencer a uma pasta');
SELECT has_index('locator', 'store_folders', 'locator_store_folders_account_name_uidx', 'pastas possuem nome unico por conta');
SELECT has_index('locator', 'stores', 'locator_stores_folder_id_idx', 'filiais possuem indice para cascata da pasta');
SELECT ok(
  NOT has_table_privilege('anon', 'locator.store_folders', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'locator.store_folders', 'SELECT'),
  'pastas nao sao expostas ao navegador'
);
SELECT ok(
  has_table_privilege('service_role', 'locator.store_folders', 'SELECT')
  AND has_table_privilege('service_role', 'locator.store_folders', 'INSERT'),
  'backend service_role gerencia as pastas'
);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9898, 'Store Folder Test', 'active'),
  (9899, 'Store Folder Other Tenant', 'active');

INSERT INTO locator.store_folders (id, aces_id, name)
VALUES
  ('98980000-0000-0000-0000-000000000001', 9898, 'Atacadão dos Óculos'),
  ('98990000-0000-0000-0000-000000000001', 9899, 'Outra conta');

INSERT INTO locator.stores (
  id, aces_id, display_name, address_line, neighborhood, city, state,
  postal_code, address_hash, folder_id
)
VALUES (
  '98981000-0000-0000-0000-000000000001', 9898, 'Filial da pasta', 'Rua A', 'Centro',
  'São Paulo', 'SP', '01000000', repeat('a', 64), '98980000-0000-0000-0000-000000000001'
);

SELECT is(
  (SELECT folder_id FROM locator.stores WHERE id = '98981000-0000-0000-0000-000000000001'),
  '98980000-0000-0000-0000-000000000001'::uuid,
  'filial permanece associada à pasta da mesma conta'
);

SELECT throws_ok(
  $$
    UPDATE locator.stores
    SET folder_id = '98990000-0000-0000-0000-000000000001'
    WHERE id = '98981000-0000-0000-0000-000000000001'
  $$,
  'Folder does not belong to the requested account',
  'nao permite associar filial a pasta de outra conta'
);

DELETE FROM locator.store_folders WHERE id = '98980000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT folder_id FROM locator.stores WHERE id = '98981000-0000-0000-0000-000000000001'),
  NULL::uuid,
  'excluir pasta devolve filial para Sem pasta'
);

SELECT * FROM finish();
ROLLBACK;
