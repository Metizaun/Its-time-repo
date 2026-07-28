-- Seed inicial do ambiente de desenvolvimento local Its Time / Dr Óculos

BEGIN;

-- 1. Contas principais
INSERT INTO crm.accounts (id, name, status)
VALUES
  (5, 'Dr Óculos Matriz', 'active'),
  (1, 'Conta Principal', 'active')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

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

COMMIT;
