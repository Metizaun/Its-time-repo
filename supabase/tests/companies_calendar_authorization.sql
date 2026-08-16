BEGIN;

SELECT plan(17);

SELECT is(
  crm.normalize_cnpj('12.ABC.345/01DE-35'),
  '12ABC34501DE35',
  'CNPJ alfanumerico e normalizado sem pontuacao'
);
SELECT ok(crm.is_valid_cnpj('12ABC34501DE35'), 'CNPJ alfanumerico valido');
SELECT ok(crm.is_valid_cnpj('12345678000195'), 'CNPJ numerico existente continua valido');
SELECT ok(NOT crm.is_valid_cnpj('00000000000000'), 'CNPJ numerico repetido e rejeitado');

INSERT INTO crm.accounts (id, name, status)
VALUES (9401, 'Empresas e Agenda Test', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('94000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'company-admin@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('94000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'company-seller-a@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('94000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'company-seller-b@test.local', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('94100000-0000-0000-0000-000000000001', '94000000-0000-0000-0000-000000000001', 'company-admin@test.local', 'Company Admin', 'ADMIN', 9401),
  ('94100000-0000-0000-0000-000000000002', '94000000-0000-0000-0000-000000000002', 'company-seller-a@test.local', 'Company Seller A', 'VENDEDOR', 9401),
  ('94100000-0000-0000-0000-000000000003', '94000000-0000-0000-0000-000000000003', 'company-seller-b@test.local', 'Company Seller B', 'VENDEDOR', 9401);

INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES ('company-calendar-test', 9401, 'connected', 'connected', '94100000-0000-0000-0000-000000000001');

INSERT INTO crm.empresas (id, aces_id, cnpj, legal_name, name, address, city, state, created_by)
VALUES
  ('94200000-0000-0000-0000-000000000001', 9401, '12ABC34501DE35', 'Empresa A Ltda', 'Empresa A', 'Rua A, 1', 'Sume', 'PB', '94100000-0000-0000-0000-000000000001'),
  ('94200000-0000-0000-0000-000000000002', 9401, '12345678000195', 'Empresa B Ltda', 'Empresa B', 'Rua B, 2', 'Jatauba', 'PE', '94100000-0000-0000-0000-000000000001');

INSERT INTO crm.instance_access_memberships (
  aces_id, instance_name, crm_user_id, access_level, granted_by
)
VALUES
  (9401, 'company-calendar-test', '94100000-0000-0000-0000-000000000002', 'editor', '94100000-0000-0000-0000-000000000001'),
  (9401, 'company-calendar-test', '94100000-0000-0000-0000-000000000003', 'editor', '94100000-0000-0000-0000-000000000001');

INSERT INTO crm.empresa_memberships (aces_id, empresa_id, crm_user_id, granted_by)
VALUES
  (9401, '94200000-0000-0000-0000-000000000001', '94100000-0000-0000-0000-000000000002', '94100000-0000-0000-0000-000000000001'),
  (9401, '94200000-0000-0000-0000-000000000002', '94100000-0000-0000-0000-000000000003', '94100000-0000-0000-0000-000000000001');

INSERT INTO crm.leads (id, aces_id, name, contact_phone, instancia, empresa_id)
VALUES
  ('94300000-0000-0000-0000-000000000001', 9401, 'Lead sem empresa', '559400000001', 'company-calendar-test', NULL),
  ('94300000-0000-0000-0000-000000000002', 9401, 'Lead Empresa A', '559400000002', 'company-calendar-test', '94200000-0000-0000-0000-000000000001'),
  ('94300000-0000-0000-0000-000000000003', 9401, 'Lead Empresa B', '559400000003', 'company-calendar-test', '94200000-0000-0000-0000-000000000002');

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-000000000002","role":"authenticated"}',
  TRUE
);
SELECT is(
  (SELECT count(*)::integer FROM crm.leads WHERE id::text LIKE '94300000-%'),
  2,
  'vendedor A ve fila sem empresa e apenas a Empresa A'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-000000000003","role":"authenticated"}',
  TRUE
);
SELECT is(
  (SELECT count(*)::integer FROM crm.leads WHERE id::text LIKE '94300000-%'),
  2,
  'vendedor B ve fila sem empresa e apenas a Empresa B'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);
SELECT is(
  (SELECT count(*)::integer FROM crm.leads WHERE id::text LIKE '94300000-%'),
  3,
  'admin ve todos os leads da conta'
);

RESET ROLE;

INSERT INTO calendar.settings (
  aces_id, timezone, minimum_notice_minutes, booking_horizon_days, slot_interval_minutes
)
VALUES (9401, 'America/Sao_Paulo', 0, 30, 30);

INSERT INTO calendar.professionals (id, aces_id, name)
VALUES ('94400000-0000-0000-0000-000000000001', 9401, 'Profissional Teste');

INSERT INTO calendar.professional_locations (
  id, aces_id, professional_id, empresa_id
)
VALUES (
  '94400000-0000-0000-0000-000000000002', 9401,
  '94400000-0000-0000-0000-000000000001',
  '94200000-0000-0000-0000-000000000001'
);

INSERT INTO calendar.services (
  id, aces_id, name, duration_minutes, buffer_after_minutes
)
VALUES ('94400000-0000-0000-0000-000000000003', 9401, 'Consulta Teste', 30, 10);

INSERT INTO calendar.professional_services (
  aces_id, professional_location_id, service_id
)
VALUES (
  9401,
  '94400000-0000-0000-0000-000000000002',
  '94400000-0000-0000-0000-000000000003'
);

INSERT INTO calendar.availability_rules (
  aces_id, professional_location_id, weekday, start_time, end_time
)
VALUES (
  9401,
  '94400000-0000-0000-0000-000000000002',
  extract(dow FROM current_date + 1)::smallint,
  '10:00',
  '12:00'
);

SET LOCAL ROLE service_role;

SELECT is(
  (
    SELECT count(*)::integer
    FROM calendar.list_available_slots(
      '94400000-0000-0000-0000-000000000002',
      '94400000-0000-0000-0000-000000000003',
      current_date + 1,
      current_date + 1,
      NULL,
      50,
      NULL,
      9401
    )
  ),
  4,
  'motor gera apenas os quatro slots validos do expediente'
);

SELECT ok(
  (
    calendar.create_professional_appointment(
      p_lead_id => '94300000-0000-0000-0000-000000000002',
      p_professional_location_id => '94400000-0000-0000-0000-000000000002',
      p_service_id => '94400000-0000-0000-0000-000000000003',
      p_start_time => ((current_date + 1 + time '10:00') AT TIME ZONE 'America/Sao_Paulo'),
      p_title => 'Consulta Teste',
      p_aces_id => 9401
    )
  ).id IS NOT NULL,
  'consulta profissional e criada pelo motor transacional'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM calendar.list_available_slots(
      '94400000-0000-0000-0000-000000000002',
      '94400000-0000-0000-0000-000000000003',
      current_date + 1,
      current_date + 1,
      NULL,
      50,
      NULL,
      9401
    )
  ),
  2,
  'reserva e buffer removem os slots conflitantes'
);

SELECT throws_ok(
  $sql$
    SELECT calendar.create_professional_appointment(
      p_lead_id => '94300000-0000-0000-0000-000000000002',
      p_professional_location_id => '94400000-0000-0000-0000-000000000002',
      p_service_id => '94400000-0000-0000-0000-000000000003',
      p_start_time => ((current_date + 1 + time '10:00') AT TIME ZONE 'America/Sao_Paulo'),
      p_title => 'Conflito Teste',
      p_aces_id => 9401
    )
  $sql$,
  'P0001',
  'SLOT_UNAVAILABLE',
  'segunda reserva no mesmo horario e bloqueada'
);

SELECT is(
  (
    calendar.cancel_professional_appointment(
      (
        SELECT id FROM calendar.events
        WHERE lead_id = '94300000-0000-0000-0000-000000000002'
          AND professional_id = '94400000-0000-0000-0000-000000000001'
        ORDER BY created_at DESC
        LIMIT 1
      ),
      'Cliente solicitou cancelamento'
    )
  ).status,
  'cancelled',
  'cancelamento profissional e transacional'
);

SELECT ok(
  (
    SELECT cancel_reason = 'Cliente solicitou cancelamento'
      AND metadata ? 'cancelled_at'
    FROM calendar.events
    WHERE lead_id = '94300000-0000-0000-0000-000000000002'
      AND professional_id = '94400000-0000-0000-0000-000000000001'
    ORDER BY created_at DESC
    LIMIT 1
  ),
  'cancelamento preserva motivo e auditoria'
);

RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-000000000002","role":"authenticated"}',
  TRUE
);

INSERT INTO calendar.events (
  id,
  title,
  start_time,
  end_time,
  lead_id
)
VALUES (
  '94500000-0000-0000-0000-000000000001',
  'Evento para exclusao logica',
  now() + interval '2 days',
  now() + interval '2 days 1 hour',
  '94300000-0000-0000-0000-000000000002'
);

SELECT is(
  (
    SELECT owner_user_id
    FROM calendar.events
    WHERE id = '94500000-0000-0000-0000-000000000001'
  ),
  '94100000-0000-0000-0000-000000000002'::uuid,
  'evento manual pertence ao vendedor que o criou'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);

SELECT lives_ok(
  $sql$
    UPDATE calendar.events
    SET deleted_at = now()
    WHERE id = '94500000-0000-0000-0000-000000000001'
  $sql$,
  'admin pode excluir logicamente evento autorizado sem violar RLS'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM calendar.events
    WHERE id = '94500000-0000-0000-0000-000000000001'
      AND deleted_at IS NOT NULL
  ),
  1,
  'admin mantem acesso de auditoria ao evento excluido'
);

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"94000000-0000-0000-0000-000000000003","role":"authenticated"}',
  TRUE
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM calendar.events
    WHERE id = '94500000-0000-0000-0000-000000000001'
  ),
  0,
  'outro vendedor nao ve evento excluido de outro responsavel'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
