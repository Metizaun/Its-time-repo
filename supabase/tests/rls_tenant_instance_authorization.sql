BEGIN;

SELECT plan(1);

INSERT INTO crm.accounts (id, name, status)
VALUES
  (9101, 'RLS Conta A', 'active'),
  (9102, 'RLS Conta B', 'active');

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-a@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'seller-a@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'viewer-a@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('91000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'former-owner-a@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('92000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin-b@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('91100000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'admin-a@rls.test', 'Admin A', 'ADMIN', 9101),
  ('91100000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'seller-a@rls.test', 'Seller A', 'VENDEDOR', 9101),
  ('91100000-0000-0000-0000-000000000003', '91000000-0000-0000-0000-000000000003', 'viewer-a@rls.test', 'Viewer A', 'VENDEDOR', 9101),
  ('91100000-0000-0000-0000-000000000004', '91000000-0000-0000-0000-000000000004', 'former-owner-a@rls.test', 'Former Owner A', 'VENDEDOR', 9101),
  ('92200000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000001', 'admin-b@rls.test', 'Admin B', 'ADMIN', 9102);

-- inst-a-1 deliberately has a creator from another account. Authorization must
-- still follow aces_id, proving created_by is audit-only.
INSERT INTO crm.instance (instancia, aces_id, status, setup_status, created_by)
VALUES
  ('rls-inst-a-1', 9101, 'connected', 'connected', '92200000-0000-0000-0000-000000000001'),
  ('rls-inst-a-2', 9101, 'connected', 'connected', '91100000-0000-0000-0000-000000000001'),
  ('rls-inst-b-1', 9102, 'connected', 'connected', '92200000-0000-0000-0000-000000000001');

INSERT INTO crm.instance_access_memberships (
  aces_id, instance_name, crm_user_id, access_level, granted_by
)
VALUES
  (9101, 'rls-inst-a-1', '91100000-0000-0000-0000-000000000002', 'editor', '91100000-0000-0000-0000-000000000001'),
  (9101, 'rls-inst-a-1', '91100000-0000-0000-0000-000000000003', 'viewer', '91100000-0000-0000-0000-000000000001');

INSERT INTO crm.leads (id, aces_id, owner_id, name, contact_phone, status, instancia, view)
VALUES
  ('91a00000-0000-0000-0000-000000000001', 9101, '91100000-0000-0000-0000-000000000001', 'Lead A1', '550000000001', 'Novo', 'rls-inst-a-1', TRUE),
  ('91a00000-0000-0000-0000-000000000002', 9101, '91100000-0000-0000-0000-000000000001', 'Lead A2', '550000000002', 'Novo', 'rls-inst-a-2', TRUE),
  ('91a00000-0000-0000-0000-000000000003', 9101, '91100000-0000-0000-0000-000000000004', 'Lead sem responsavel', '550000000004', 'Novo', 'rls-inst-a-1', TRUE),
  ('92b00000-0000-0000-0000-000000000001', 9102, '92200000-0000-0000-0000-000000000001', 'Lead B1', '550000000003', 'Novo', 'rls-inst-b-1', TRUE);

DO $$
DECLARE
  v_cross_account_rejected boolean := FALSE;
BEGIN
  BEGIN
    UPDATE crm.leads
    SET owner_id = '92200000-0000-0000-0000-000000000001'
    WHERE id = '91a00000-0000-0000-0000-000000000002';
  EXCEPTION
    WHEN OTHERS THEN
      IF position('Responsavel do lead pertence a outra conta' IN SQLERRM) = 0 THEN
        RAISE;
      END IF;
      v_cross_account_rejected := TRUE;
  END;

  IF NOT v_cross_account_rejected THEN
    RAISE EXCEPTION 'Nova atribuicao de responsavel entre contas foi aceita';
  END IF;
END;
$$;

-- Simula um legado anterior ao trigger atual. A atualizacao comum deve funcionar
-- mesmo com owner_id incompatível, sem permitir criar uma nova incompatibilidade.
ALTER TABLE crm.leads DISABLE TRIGGER trg_sync_lead_stage_and_aces;
INSERT INTO crm.leads (id, aces_id, owner_id, name, contact_phone, status, instancia, view)
VALUES (
  '91a00000-0000-0000-0000-000000000005',
  9101,
  '92200000-0000-0000-0000-000000000001',
  'Lead legado com responsavel externo',
  '550000000005',
  'Novo',
  'rls-inst-a-1',
  TRUE
);
ALTER TABLE crm.leads ENABLE TRIGGER trg_sync_lead_stage_and_aces;

UPDATE crm.leads
SET status = 'Em atendimento'
WHERE id = '91a00000-0000-0000-0000-000000000005';

DELETE FROM crm.users
WHERE id = '91100000-0000-0000-0000-000000000004';

DO $$
BEGIN
  IF (SELECT owner_id FROM crm.leads WHERE id = '91a00000-0000-0000-0000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'Excluir responsavel nao definiu owner_id como NULL';
  END IF;

  IF (SELECT status FROM crm.leads WHERE id = '91a00000-0000-0000-0000-000000000005') <> 'Em atendimento' THEN
    RAISE EXCEPTION 'Atualizacao comum de lead legado foi bloqueada pelo responsavel';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon', 'crm.current_user_can_access_lead(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon ainda pode executar helper SECURITY DEFINER';
  END IF;
  IF has_function_privilege('authenticated', 'crm.ensure_default_pipeline(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated ainda pode executar ensure_default_pipeline arbitrario';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-000000000001","role":"authenticated"}',
  TRUE
);

DO $$
BEGIN
  IF public.current_aces_id() <> 9101 OR public.current_crm_role() <> 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Identidade do admin A incorreta';
  END IF;
  IF (SELECT count(*) FROM crm.instance WHERE instancia LIKE 'rls-%') <> 2 THEN
    RAISE EXCEPTION 'Admin A nao enxerga todas as instancias da conta';
  END IF;
  IF (SELECT count(*) FROM crm.leads WHERE id IN (
    '91a00000-0000-0000-0000-000000000001',
    '91a00000-0000-0000-0000-000000000002',
    '91a00000-0000-0000-0000-000000000003',
    '91a00000-0000-0000-0000-000000000005',
    '92b00000-0000-0000-0000-000000000001'
  )) <> 4 THEN
    RAISE EXCEPTION 'Admin A atravessou tenant ou perdeu leads da propria conta';
  END IF;
END;
$$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-000000000002","role":"authenticated"}',
  TRUE
);

DO $$
DECLARE
  v_rows integer;
BEGIN
  IF (SELECT count(*) FROM crm.instance WHERE instancia LIKE 'rls-%') <> 1 THEN
    RAISE EXCEPTION 'Seller editor nao foi limitado a sua membership';
  END IF;
  IF (SELECT count(*) FROM crm.leads WHERE id IN (
    '91a00000-0000-0000-0000-000000000001',
    '91a00000-0000-0000-0000-000000000002',
    '91a00000-0000-0000-0000-000000000003',
    '91a00000-0000-0000-0000-000000000005',
    '92b00000-0000-0000-0000-000000000001'
  )) <> 3 THEN
    RAISE EXCEPTION 'Seller editor atravessou instancia ou tenant';
  END IF;

  IF (SELECT owner_id FROM crm.leads WHERE id = '91a00000-0000-0000-0000-000000000003') IS NOT NULL THEN
    RAISE EXCEPTION 'Lead perdeu acesso ou ganhou novo responsavel apos exclusao';
  END IF;

  UPDATE crm.leads SET notes = 'editor-ok'
  WHERE id = '91a00000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Seller editor nao conseguiu editar lead permitido';
  END IF;

  UPDATE crm.leads SET notes = 'must-not-update'
  WHERE id = '91a00000-0000-0000-0000-000000000002';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Seller editor alterou lead de instancia nao permitida';
  END IF;
END;
$$;

SELECT set_config(
  'request.jwt.claims',
  '{"sub":"91000000-0000-0000-0000-000000000003","role":"authenticated"}',
  TRUE
);

DO $$
DECLARE
  v_rows integer;
BEGIN
  IF (SELECT count(*) FROM crm.leads WHERE id = '91a00000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'Viewer nao consegue ler lead permitido';
  END IF;

  UPDATE crm.leads SET notes = 'viewer-must-not-update'
  WHERE id = '91a00000-0000-0000-0000-000000000001';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Viewer conseguiu editar lead';
  END IF;
END;
$$;

RESET ROLE;
SELECT pass('RLS de tenant e instancia validada sem excecoes');
SELECT * FROM finish();
ROLLBACK;
