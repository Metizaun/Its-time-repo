BEGIN;

SELECT plan(32);

SELECT hasnt_table('crm', 'planos', 'tabela crm.planos legada removida');
SELECT hasnt_table('public', 'billing_usage_events', 'ledger publico legado removido');
SELECT hasnt_column('crm', 'accounts', 'caracteres_consumidos', 'contador legado removido da conta');
SELECT hasnt_column('public', 'user_profiles', 'plan_id', 'perfil nao depende mais de plano legado');

SELECT ok(NOT has_table_privilege('authenticated', 'costs.plans', 'SELECT'), 'authenticated nao le costs.plans');
SELECT ok(has_table_privilege('service_role', 'costs.plans', 'SELECT'), 'service_role le costs.plans');
SELECT is((SELECT count(*)::integer FROM pg_policies WHERE schemaname = 'costs'), 0, 'schema costs nao possui policy de navegador');

INSERT INTO crm.accounts (id, name, status) VALUES
  (9701, 'Finance Test', 'active'),
  (9702, 'Observe Test', 'active'),
  (9703, 'No Contract Test', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '97000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'finance-admin@test.local', '', now(), '{}'::jsonb,
  '{"display_name":" Finance Admin "}'::jsonb, now(), now()
);

SELECT ok(EXISTS (
  SELECT 1 FROM public.user_profiles
  WHERE user_id = '97000000-0000-0000-0000-000000000001'
), 'cadastro auth ainda cria perfil');

UPDATE public.user_profiles SET username = '  finance_admin  '
WHERE user_id = '97000000-0000-0000-0000-000000000001';
SELECT is((SELECT username FROM public.user_profiles WHERE user_id = '97000000-0000-0000-0000-000000000001'), 'finance_admin', 'edicao de perfil ainda normaliza campos');

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES ('97100000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'finance-admin@test.local', 'Finance Admin', 'ADMIN', 9701);
INSERT INTO crm.instance (instancia, aces_id) VALUES ('finance-test-instance', 9701);
INSERT INTO crm.leads (id, aces_id, name, contact_phone, instancia, owner_id)
VALUES ('97200000-0000-0000-0000-000000000001', 9701, 'Finance Lead', '559799999999', 'finance-test-instance', '97100000-0000-0000-0000-000000000001');
INSERT INTO crm.message_history (id, aces_id, lead_id, instance, content, direction, source_type, sent_at)
VALUES ('97300000-0000-0000-0000-000000000001', 9701, '97200000-0000-0000-0000-000000000001', 'finance-test-instance', 'Mensagem sem contador legado', 'inbound', 'lead', '2026-02-28T15:00:00Z');
SELECT ok(EXISTS (SELECT 1 FROM crm.message_history WHERE id = '97300000-0000-0000-0000-000000000001'), 'ingestao de mensagem funciona apos remocao do legado');

INSERT INTO costs.plans (id, code, name, mensalidade_brl, implantacao_brl, ai_budget_brl, warn_threshold_pct)
VALUES ('97400000-0000-0000-0000-000000000001', 'finance_test', 'Finance Test', 999, 1500, 10, 80);
INSERT INTO costs.subscriptions (id, aces_id, plan_id, status, started_at, cycle_anchor_day, enforcement_enabled)
VALUES
  ('97500000-0000-0000-0000-000000000001', 9701, '97400000-0000-0000-0000-000000000001', 'active', '2026-01-01T00:00:00Z', 31, true),
  ('97500000-0000-0000-0000-000000000002', 9702, '97400000-0000-0000-0000-000000000001', 'active', '2026-01-01T00:00:00Z', 31, false);

INSERT INTO costs.exchange_rates (from_currency, to_currency, rate, rate_kind, source, effective_at)
VALUES
  ('USD', 'BRL', 6, 'internal', 'finance_test', '2026-01-01T00:00:00Z'),
  ('USD', 'BRL', 5.5, 'provider', 'finance_test', '2026-01-01T00:00:00Z');
SELECT is(
  jsonb_typeof(crm.service_admin_finance_catalog()->'exchangeRates'->0),
  'object',
  'catalogo administrativo retorna linhas completas de cambio'
);
INSERT INTO costs.price_versions (provider, model, operation, metric, unit_price_usd, billing_divisor, valid_from, source_url, verified_at)
VALUES ('test_provider', 'test_model', 'standard', 'input_text_token', 1, 1000000, '2026-01-01T00:00:00Z', 'https://example.test/pricing', '2026-01-01T00:00:00Z');

SELECT costs.ensure_current_cycle(9701, '2026-02-28T15:00:00Z');
SELECT is((SELECT (cycle_start AT TIME ZONE 'America/Sao_Paulo')::date FROM costs.budget_cycles WHERE aces_id = 9701), '2026-02-28'::date, 'ancora 31 usa ultimo dia de fevereiro');
SELECT is((SELECT (cycle_end AT TIME ZONE 'America/Sao_Paulo')::date FROM costs.budget_cycles WHERE aces_id = 9701), '2026-03-31'::date, 'ciclo seguinte volta ao dia 31');

SELECT crm.service_record_ai_usage(
  'finance:event:1', 9701, 'test_feature', 'test_provider', 'test_model',
  '[{"metric":"input_text_token","quantity":1000000}]'::jsonb,
  p_lead_id => '97200000-0000-0000-0000-000000000001',
  p_instance_name => 'finance-test-instance',
  p_occurred_at => '2026-02-28T15:00:00Z'
);

SELECT is((SELECT cost_usd FROM costs.usage_events WHERE idempotency_key = 'finance:event:1'), 1.0000000000::numeric, 'rating calcula custo USD');
SELECT is((SELECT cost_brl FROM costs.usage_events WHERE idempotency_key = 'finance:event:1'), 6.00000000::numeric, 'rating congela dolar interno');
SELECT is((SELECT provider_cost_brl FROM costs.usage_events WHERE idempotency_key = 'finance:event:1'), 5.50000000::numeric, 'rating congela dolar provider');
SELECT is((SELECT consumed_brl FROM costs.budget_cycles WHERE aces_id = 9701), 6.00000000::numeric, 'trigger acumula consumo no ciclo');

SELECT crm.service_record_ai_usage(
  'finance:event:1', 9701, 'test_feature', 'test_provider', 'test_model',
  '[{"metric":"input_text_token","quantity":1000000}]'::jsonb,
  p_occurred_at => '2026-02-28T15:00:00Z'
);
SELECT is((SELECT count(*)::integer FROM costs.usage_events WHERE idempotency_key = 'finance:event:1'), 1, 'idempotency key impede evento duplicado');

UPDATE costs.price_versions SET unit_price_usd = 2
WHERE provider = 'test_provider' AND model = 'test_model';
SELECT costs.rate_usage_event((SELECT id FROM costs.usage_events WHERE idempotency_key = 'finance:event:1'));
SELECT is((SELECT consumed_brl FROM costs.budget_cycles WHERE aces_id = 9701), 12.00000000::numeric, 're-rating aplica somente delta financeiro');
SELECT is((SELECT count(*)::integer FROM crm.notifications WHERE aces_id = 9701 AND event_type IN ('ai_budget_warned', 'ai_budget_exceeded')), 2, 'alertas de 80 e 100 por ciclo sao unicos');
SELECT is((SELECT count(*)::integer FROM crm.notifications WHERE aces_id = 9701 AND event_type IN ('ai_budget_warned', 'ai_budget_exceeded') AND action_path IS NULL), 2, 'alertas de limite nao expõem rota de superadmin');
SELECT costs.rate_usage_event((SELECT id FROM costs.usage_events WHERE idempotency_key = 'finance:event:1'));
SELECT is((SELECT count(*)::integer FROM crm.notifications WHERE aces_id = 9701 AND event_type IN ('ai_budget_warned', 'ai_budget_exceeded')), 2, 're-rating nao duplica alertas');

SELECT is((SELECT allowed FROM costs.check_ai_budget(9703, '2026-02-28T15:00:00Z')), true, 'conta sem contrato e liberada');
SELECT is((SELECT allowed FROM costs.check_ai_budget(9702, '2026-02-28T15:00:00Z')), true, 'enforcement desligado sempre libera');
SELECT is((SELECT allowed FROM costs.check_ai_budget(9701, '2026-02-28T15:00:00Z')), false, 'consumo no teto com enforcement bloqueia');

SELECT costs.reset_ai_budget(9701, 'Cortesia de teste', '97000000-0000-0000-0000-000000000001', '2026-02-28T16:00:00Z');
SELECT is((SELECT allowed FROM costs.check_ai_budget(9701, '2026-02-28T16:00:00Z')), true, 'reset libera a proxima chamada');
SELECT is((SELECT count(*)::integer FROM costs.usage_events WHERE aces_id = 9701), 1, 'reset nao altera o ledger');
SELECT is((SELECT count(*)::integer FROM costs.budget_resets WHERE aces_id = 9701 AND reason = 'Cortesia de teste'), 1, 'reset registra auditoria');

INSERT INTO costs.usage_events (
  id, idempotency_key, event_type, reverses_event_id, aces_id, feature_key,
  provider, model, occurred_at
) SELECT
  '97600000-0000-0000-0000-000000000001', 'finance:event:1:reversal', 'reversal', id,
  aces_id, feature_key, provider, model, occurred_at
FROM costs.usage_events WHERE idempotency_key = 'finance:event:1';
INSERT INTO costs.usage_line_items (usage_event_id, line_no, metric, quantity)
VALUES ('97600000-0000-0000-0000-000000000001', 1, 'input_text_token', 1000000);
SELECT costs.rate_usage_event('97600000-0000-0000-0000-000000000001');
SELECT is((SELECT consumed_brl FROM costs.budget_cycles WHERE aces_id = 9701), 0.00000000::numeric, 'reversal reduz consumo com delta negativo');

SELECT is((SELECT unit_price_usd FROM costs.price_versions WHERE provider = 'openai' AND model = 'gpt-5.6-luna' AND metric = 'input_text_token' AND valid_until IS NULL ORDER BY valid_from DESC LIMIT 1), 1.0000000000::numeric, 'preco Luna input correto');
SELECT is((SELECT unit_price_usd FROM costs.price_versions WHERE provider = 'openai' AND model = 'gpt-5.6-luna' AND metric = 'cached_input_text_token' AND valid_until IS NULL ORDER BY valid_from DESC LIMIT 1), 0.1000000000::numeric, 'preco Luna cache correto');
SELECT is((SELECT unit_price_usd FROM costs.price_versions WHERE provider = 'openai' AND model = 'gpt-5.6-luna' AND metric = 'output_token' AND valid_until IS NULL ORDER BY valid_from DESC LIMIT 1), 6.0000000000::numeric, 'preco Luna output correto');

SELECT * FROM finish();
ROLLBACK;
