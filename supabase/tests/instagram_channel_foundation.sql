BEGIN;

SELECT plan(22);

SELECT has_table('crm', 'instance_channels', 'crm.instance_channels existe');
SELECT has_table('crm', 'lead_channel_identities', 'crm.lead_channel_identities existe');
SELECT has_table('instagram', 'channels', 'instagram.channels existe');
SELECT has_table('instagram', 'channel_credentials', 'instagram.channel_credentials existe');
SELECT has_table('instagram', 'oauth_states', 'instagram.oauth_states existe');
SELECT has_table('instagram', 'webhook_events', 'instagram.webhook_events existe');
SELECT has_table('instagram', 'provider_status_events', 'instagram.provider_status_events existe');

SELECT col_is_null('crm', 'leads', 'contact_phone', 'telefone do lead aceita NULL');

SELECT is(
  (SELECT count(*)::integer FROM crm.instance_channels),
  (SELECT count(*)::integer FROM crm.instance),
  'backfill criou um binding por instancia existente'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM crm.instance_channels AS binding
    JOIN meta.instance AS legacy
      ON legacy.aces_id = binding.aces_id
     AND legacy.instance_name = binding.instance_name
    WHERE binding.provider <> legacy.provider
  ),
  0,
  'backfill preservou providers registrados em meta.instance'
);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9871, 'Instagram Backfill Evolution', 'active'),
  (9872, 'Instagram Backfill Meta', 'active'),
  (9873, 'Instagram Backfill Gupshup', 'active');

INSERT INTO crm.instance (instancia, aces_id, status, setup_status)
VALUES
  ('instagram-backfill-evolution', 9871, 'connected', 'connected'),
  ('instagram-backfill-meta', 9872, 'connected', 'connected'),
  ('instagram-backfill-gupshup', 9873, 'connected', 'connected');

INSERT INTO meta.instance (aces_id, instance_name, provider)
VALUES
  (9871, 'instagram-backfill-evolution', 'evolution'),
  (9872, 'instagram-backfill-meta', 'meta'),
  (9873, 'instagram-backfill-gupshup', 'gupshup')
ON CONFLICT (aces_id, instance_name) DO UPDATE
SET provider = EXCLUDED.provider;

INSERT INTO crm.instance_channels (
  aces_id, instance_name, channel_type, provider, capability, status
)
SELECT
  instance.aces_id,
  instance.instancia,
  'whatsapp',
  CASE
    WHEN meta_instance.provider IN ('evolution', 'meta', 'gupshup') THEN meta_instance.provider
    ELSE 'evolution'
  END,
  'full',
  'active'
FROM crm.instance AS instance
LEFT JOIN meta.instance AS meta_instance
  ON meta_instance.aces_id = instance.aces_id
 AND meta_instance.instance_name = instance.instancia
WHERE instance.aces_id IN (9871, 9872, 9873)
ON CONFLICT (aces_id, instance_name) DO NOTHING;

SELECT results_eq(
  $$
    SELECT instance_name, provider
    FROM crm.instance_channels
    WHERE aces_id IN (9871, 9872, 9873)
    ORDER BY aces_id
  $$,
  $$
    SELECT * FROM (VALUES
      ('instagram-backfill-evolution'::text, 'evolution'::text),
      ('instagram-backfill-meta'::text, 'meta'::text),
      ('instagram-backfill-gupshup'::text, 'gupshup'::text)
    ) AS expected(instance_name, provider)
  $$,
  'backfill explicito preserva Evolution, Meta WhatsApp e Gupshup'
);

SELECT ok(
  NOT has_table_privilege('anon', 'instagram.channels', 'SELECT'),
  'anon nao acessa instagram.channels'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'instagram.channels', 'SELECT'),
  'authenticated nao acessa instagram.channels'
);
SELECT ok(
  has_table_privilege('service_role', 'instagram.channels', 'SELECT'),
  'service_role acessa instagram.channels'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'crm.lead_channel_identities', 'SELECT'),
  'authenticated nao acessa identidades externas'
);
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'crm.rpc_find_or_create_channel_lead(uuid,text,text,uuid,uuid,text,text)',
    'EXECUTE'
  ),
  'authenticated nao executa a RPC backend-only'
);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9801, 'Instagram Foundation A', 'active'),
  (9802, 'Instagram Foundation B', 'active');

INSERT INTO crm.instance (instancia, aces_id, status, setup_status)
VALUES
  ('instagram-foundation-a', 9801, 'connected', 'connected'),
  ('instagram-foundation-b', 9802, 'connected', 'connected');

INSERT INTO crm.instance_channels (
  id, aces_id, instance_name, channel_type, provider, capability, status
)
VALUES
  ('98010000-0000-0000-0000-000000000001', 9801, 'instagram-foundation-a', 'instagram', 'instagram', 'manual_only', 'active'),
  ('98020000-0000-0000-0000-000000000001', 9802, 'instagram-foundation-b', 'instagram', 'instagram', 'manual_only', 'active');

CREATE TEMP TABLE first_identity_result AS
SELECT crm.rpc_find_or_create_channel_lead(
  '98010000-0000-0000-0000-000000000001',
  'IGSID-FOUNDATION-1',
  'Lead Instagram Teste',
  NULL,
  NULL,
  'instagram_teste',
  NULL
) AS result;

CREATE TEMP TABLE second_identity_result AS
SELECT crm.rpc_find_or_create_channel_lead(
  '98010000-0000-0000-0000-000000000001',
  'IGSID-FOUNDATION-1',
  'Nome Ignorado',
  NULL,
  NULL,
  'instagram_atualizado',
  NULL
) AS result;

SELECT is(
  (SELECT result->>'lead_id' FROM first_identity_result),
  (SELECT result->>'lead_id' FROM second_identity_result),
  'RPC repetida retorna o mesmo lead'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM crm.lead_channel_identities
    WHERE channel_id = '98010000-0000-0000-0000-000000000001'
      AND provider_user_id = 'IGSID-FOUNDATION-1'
  ),
  1,
  'IGSID cria uma unica identidade no canal'
);

SELECT ok(
  (
    SELECT lead.contact_phone IS NULL
    FROM crm.leads AS lead
    JOIN crm.lead_channel_identities AS identity ON identity.lead_id = lead.id
    WHERE identity.channel_id = '98010000-0000-0000-0000-000000000001'
      AND identity.provider_user_id = 'IGSID-FOUNDATION-1'
  ),
  'lead Instagram foi criado sem telefone sintetico'
);

SELECT is(
  (
    SELECT display_username
    FROM crm.lead_channel_identities
    WHERE channel_id = '98010000-0000-0000-0000-000000000001'
      AND provider_user_id = 'IGSID-FOUNDATION-1'
  ),
  'instagram_atualizado',
  'metadado mutavel da identidade e atualizado'
);

SELECT throws_ok(
  $$
    INSERT INTO crm.lead_channel_identities (
      aces_id, lead_id, channel_id, provider_user_id
    )
    SELECT
      9802,
      lead.id,
      '98020000-0000-0000-0000-000000000001',
      'IGSID-CROSS-TENANT'
    FROM crm.leads AS lead
    WHERE lead.aces_id = 9801
    LIMIT 1
  $$,
  '23503',
  NULL,
  'FK composta bloqueia identidade entre tenants'
);

SELECT throws_ok(
  $$
    INSERT INTO crm.instance_channels (
      aces_id, instance_name, channel_type, provider, capability, status
    ) VALUES (
      9801, 'instagram-foundation-a', 'instagram', 'evolution', 'manual_only', 'active'
    )
  $$,
  '23514',
  NULL,
  'Instagram nao aceita provider WhatsApp'
);

SELECT * FROM finish();
ROLLBACK;
