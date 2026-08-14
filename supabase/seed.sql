-- Seed inicial do ambiente de desenvolvimento local Its Time / Dr Óculos

BEGIN;

-- 1. Contas principais
INSERT INTO crm.accounts (id, name, status, is_internal)
VALUES
  (5, 'Dr Óculos Matriz', 'active', false),
  (1, 'Conta Principal', 'active', true),
  (6, 'QueroMed', 'active', false)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  is_internal = EXCLUDED.is_internal;

-- 2. Usuários de Auth e CRM
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  phone_change, phone_change_token, email_change_token_current, reauthentication_token,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'admin@local.test',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Local Admin"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'vendedor@demo.com',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Vendedor Demo"}'::jsonb,
    now(),
    now()
  ),
  (
    '00000000-0000-0000-0000-000000009001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'mattsyk1@gmail.com',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(),
    '', '', '', '', '', '', '', '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"name":"Mattsyk Local Staff"}'::jsonb,
    now(),
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  (
    '10000000-0000-0000-0000-000000000005',
    '00000000-0000-0000-0000-000000000005',
    'admin@local.test',
    'Local Admin',
    'ADMIN',
    5
  ),
  (
    '10000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    'vendedor@demo.com',
    'Vendedor Demo',
    'VENDEDOR',
    5
  )
ON CONFLICT (id) DO NOTHING;

-- 3. Empresas de Exemplo (Multi-Empresas)
INSERT INTO crm.empresas (aces_id, cnpj, legal_name, name, address, city, state, is_active, created_by)
VALUES
  (5, '66972304000129', 'Ótica Dr. Óculos Matriz Ltda', 'Ótica Dr. Óculos - Matriz Centro', 'Av. Central, 1000', 'Goiânia', 'GO', true, '10000000-0000-0000-0000-000000000005'),
  (5, '66972192000106', 'Ótica Dr. Óculos Filial Ltda', 'Ótica Dr. Óculos - Filial Shopping', 'Shopping Flamboyant, Loja 102', 'Goiânia', 'GO', true, '10000000-0000-0000-0000-000000000005')
ON CONFLICT (aces_id, cnpj) DO UPDATE
SET legal_name = EXCLUDED.legal_name, name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state;

-- 4. Dados financeiros exclusivos do ambiente local
INSERT INTO costs.plans (
  code, name, mensalidade_brl, implantacao_brl, ai_budget_brl,
  warn_threshold_pct, max_usuarios, max_instancias, is_active
) VALUES (
  'local_test', 'Plano local de teste', 999.00, 1500.00, 100.00,
  80.00, 10, 5, true
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  mensalidade_brl = EXCLUDED.mensalidade_brl,
  implantacao_brl = EXCLUDED.implantacao_brl,
  ai_budget_brl = EXCLUDED.ai_budget_brl,
  warn_threshold_pct = EXCLUDED.warn_threshold_pct,
  max_usuarios = EXCLUDED.max_usuarios,
  max_instancias = EXCLUDED.max_instancias,
  is_active = EXCLUDED.is_active;

INSERT INTO costs.exchange_rates (
  from_currency, to_currency, rate, rate_kind, source, effective_at, metadata
) VALUES
  ('USD', 'BRL', 6.00, 'internal', 'local_seed', '2026-01-01T00:00:00Z', '{"environment":"local"}'::jsonb),
  ('USD', 'BRL', 5.50, 'provider', 'local_seed', '2026-01-01T00:00:00Z', '{"environment":"local"}'::jsonb)
ON CONFLICT (from_currency, to_currency, rate_kind, source, effective_at)
DO UPDATE SET rate = EXCLUDED.rate, metadata = EXCLUDED.metadata;

INSERT INTO costs.admin_staff (auth_user_id, nome)
SELECT id, COALESCE(raw_user_meta_data->>'name', split_part(email, '@', 1))
FROM auth.users
WHERE lower(email) = 'mattsyk1@gmail.com'
ON CONFLICT (auth_user_id) DO UPDATE SET nome = EXCLUDED.nome;

INSERT INTO costs.subscriptions (
  aces_id, plan_id, status, started_at, cycle_anchor_day,
  implantacao_brl, mensalidade_brl_override, ai_budget_brl_override,
  enforcement_enabled
)
SELECT
  6, plan.id, 'active', '2026-08-01T03:00:00Z', 1,
  1500.00, 999.00, 100.00, false
FROM costs.plans AS plan
WHERE plan.code = 'local_test'
ON CONFLICT (aces_id) WHERE status <> 'canceled'
DO UPDATE SET
  plan_id = EXCLUDED.plan_id,
  status = EXCLUDED.status,
  implantacao_brl = EXCLUDED.implantacao_brl,
  mensalidade_brl_override = EXCLUDED.mensalidade_brl_override,
  ai_budget_brl_override = EXCLUDED.ai_budget_brl_override,
  enforcement_enabled = false;

COMMIT;
