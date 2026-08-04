-- =============================================================================
-- Seed Operacional Cardeal — Dados de teste para Docker local
-- Idempotente: pode ser re-executado sem duplicar registros.
-- =============================================================================

BEGIN;

-- ===================== IDs Fixos das Empresas (já existem) ===================
-- Santa Cruz: 3bea7044-d301-46c4-b84d-3d9bcfaabbe3
-- Jataúba:    dcde43dc-e6ac-4130-bcf7-2e30b94a9f27
-- Sumé:       3af09eba-52d6-4f4a-93d4-eae7a239da56

-- ===================== IDs Fixos dos Agentes (já existem) ====================
-- Silvana (principal):   668645dd-8a8b-4bba-95c2-b3d646be7d29
-- Subagente Clínico:     10fc2fcb-0976-4e13-b693-51fee5549fd0

-- ===================== IDs Fixos dos Agent Tools (já existem) ================
-- Forwarding Silvana:    a0f8a97d-50ed-47ed-b301-14f45c9b0e0f
-- Forwarding Subagente:  c5671a55-eb60-40ed-858f-09b1e9e3ab78

-- =========================================================================
-- FASE 1: Vendedores fake (auth.users + crm.users)
-- =========================================================================

-- 1a. Criar auth.users fake (necessário pela FK crm.users -> auth.users)
INSERT INTO auth.users (id, instance_id, email, encrypted_password, email_confirmed_at, role, aud, created_at, updated_at)
VALUES
  ('a1000001-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'vendedor.santacruz@cardeal.test', crypt('test123456', gen_salt('bf')), now(), 'authenticated', 'authenticated', now(), now()),
  ('a1000001-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'vendedor.jatauba@cardeal.test', crypt('test123456', gen_salt('bf')), now(), 'authenticated', 'authenticated', now(), now()),
  ('a1000001-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'vendedor.sume@cardeal.test', crypt('test123456', gen_salt('bf')), now(), 'authenticated', 'authenticated', now(), now())
ON CONFLICT (id) DO NOTHING;

-- 1b. Criar crm.users vendedores
INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('b2000001-0000-0000-0000-000000000001', 'a1000001-0000-0000-0000-000000000001', 'vendedor.santacruz@cardeal.test', 'Ana - Vendedora Santa Cruz', 'VENDEDOR', 1),
  ('b2000001-0000-0000-0000-000000000002', 'a1000001-0000-0000-0000-000000000002', 'vendedor.jatauba@cardeal.test', 'Carlos - Vendedor Jataúba', 'VENDEDOR', 1),
  ('b2000001-0000-0000-0000-000000000003', 'a1000001-0000-0000-0000-000000000003', 'vendedor.sume@cardeal.test', 'Maria - Vendedora Sumé', 'VENDEDOR', 1)
ON CONFLICT (auth_user_id) DO NOTHING;

-- =========================================================================
-- FASE 2: Empresa Memberships (vendedores + admin vinculados às empresas)
-- =========================================================================

-- NOTA: O ADMIN Lucas já tem acesso global a todas as empresas via
-- crm.current_user_has_empresa_access() / current_user_is_account_admin().
-- Não é necessário (nem permitido pelo trigger) inserir memberships para ADMIN.

-- Vendedores vinculados às suas respectivas empresas
INSERT INTO crm.empresa_memberships (aces_id, empresa_id, crm_user_id)
VALUES
  (1, '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'b2000001-0000-0000-0000-000000000001'),
  (1, 'dcde43dc-e6ac-4130-bcf7-2e30b94a9f27', 'b2000001-0000-0000-0000-000000000002'),
  (1, '3af09eba-52d6-4f4a-93d4-eae7a239da56', 'b2000001-0000-0000-0000-000000000003')
ON CONFLICT (empresa_id, crm_user_id) DO NOTHING;

-- =========================================================================
-- FASE 3: Serviços Médicos
-- =========================================================================

INSERT INTO calendar.services (id, aces_id, name, description, duration_minutes, price_cents)
VALUES
  ('c3000001-0000-0000-0000-000000000001', 1, 'Consulta Oftalmológica - Clínica Geral',   'Consulta de rotina com oftalmologista clínico geral.',        30, 13000),
  ('c3000001-0000-0000-0000-000000000002', 1, 'Consulta Oftalmológica - Glaucoma',          'Consulta especializada em glaucoma.',                         30, 18000),
  ('c3000001-0000-0000-0000-000000000003', 1, 'Consulta Oftalmológica - Oftalmopediatria',   'Consulta oftalmológica pediátrica.',                          40, 23000),
  ('c3000001-0000-0000-0000-000000000004', 1, 'Consulta Oftalmológica - Cirurgia/Avaliação', 'Avaliação cirúrgica com oftalmologista especialista.',         30, 13000)
ON CONFLICT (aces_id, id) DO NOTHING;

-- =========================================================================
-- FASE 4: Profissionais (Médicos)
-- =========================================================================

INSERT INTO calendar.professionals (id, aces_id, name, specialty)
VALUES
  -- Santa Cruz
  ('d4000001-0000-0000-0000-000000000001', 1, 'Dra. Lorena',        'Clínica Geral'),
  ('d4000001-0000-0000-0000-000000000002', 1, 'Dra. Clarissa',      'Glaucoma / Clínica Geral'),
  ('d4000001-0000-0000-0000-000000000003', 1, 'Dr. Rodrigo Reny',   'Oftalmologista'),
  ('d4000001-0000-0000-0000-000000000004', 1, 'Dr. Pedro Caluête',  'Glaucoma / Oftalmologia'),
  ('d4000001-0000-0000-0000-000000000005', 1, 'Dra. Camila Regina', 'Clínica Geral'),
  ('d4000001-0000-0000-0000-000000000006', 1, 'Dr. Eder',           'Clínica Geral'),
  ('d4000001-0000-0000-0000-000000000007', 1, 'Dr. Itamar',         'Clínica Geral'),
  ('d4000001-0000-0000-0000-000000000008', 1, 'Dra. Erika Leite',   'Oftalmopediatria'),
  ('d4000001-0000-0000-0000-000000000009', 1, 'Dra. Vitória',       'Especialista / Cirurgiã'),
  ('d4000001-0000-0000-0000-00000000000a', 1, 'Dra. Leilane',       'Especialista / Cirurgiã'),
  ('d4000001-0000-0000-0000-00000000000b', 1, 'Dr. Túlio Ivo',      'Especialista / Cirurgião'),
  -- Jataúba
  ('d4000001-0000-0000-0000-00000000000c', 1, 'Dr. Abílio Santiago', 'Clínica Geral'),
  -- Sumé
  ('d4000001-0000-0000-0000-00000000000d', 1, 'Dr. Vinicius',       'Clínica Geral')
ON CONFLICT (aces_id, id) DO NOTHING;

-- =========================================================================
-- FASE 5: Locais de Atendimento (professional_locations)
-- =========================================================================

INSERT INTO calendar.professional_locations (id, aces_id, professional_id, empresa_id, location_name)
VALUES
  -- Santa Cruz (empresa_id = Santa Cruz)
  ('e5000001-0000-0000-0000-000000000001', 1, 'd4000001-0000-0000-0000-000000000001', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Centro de Olhos - Av. Padre Zuzinha, 262'),
  ('e5000001-0000-0000-0000-000000000002', 1, 'd4000001-0000-0000-0000-000000000002', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Consultório próprio'),
  ('e5000001-0000-0000-0000-000000000003', 1, 'd4000001-0000-0000-0000-000000000003', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Consultório próprio'),
  ('e5000001-0000-0000-0000-000000000004', 1, 'd4000001-0000-0000-0000-000000000004', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Consultório próprio'),
  ('e5000001-0000-0000-0000-000000000005', 1, 'd4000001-0000-0000-0000-000000000005', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Consultório próprio'),
  ('e5000001-0000-0000-0000-000000000006', 1, 'd4000001-0000-0000-0000-000000000006', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Coocap'),
  ('e5000001-0000-0000-0000-000000000007', 1, 'd4000001-0000-0000-0000-000000000007', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Coocap'),
  ('e5000001-0000-0000-0000-000000000008', 1, 'd4000001-0000-0000-0000-000000000008', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Consultório próprio'),
  ('e5000001-0000-0000-0000-000000000009', 1, 'd4000001-0000-0000-0000-000000000009', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Oftale'),
  ('e5000001-0000-0000-0000-00000000000a', 1, 'd4000001-0000-0000-0000-00000000000a', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Oftale'),
  ('e5000001-0000-0000-0000-00000000000b', 1, 'd4000001-0000-0000-0000-00000000000b', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Oftale'),
  -- Jataúba (empresa_id = Jataúba)
  ('e5000001-0000-0000-0000-00000000000c', 1, 'd4000001-0000-0000-0000-00000000000c', 'dcde43dc-e6ac-4130-bcf7-2e30b94a9f27', 'Clínica Santa Ana - R. São Sebastião, 29 - Centro'),
  -- Sumé (empresa_id = Sumé)
  ('e5000001-0000-0000-0000-00000000000d', 1, 'd4000001-0000-0000-0000-00000000000d', '3af09eba-52d6-4f4a-93d4-eae7a239da56', 'Consultório na Ótica Cardeal')
ON CONFLICT (professional_id, empresa_id) WHERE empresa_id IS NOT NULL DO NOTHING;

-- =========================================================================
-- FASE 6: Vínculo Profissional ↔ Serviço (com preços por médico)
-- =========================================================================

INSERT INTO calendar.professional_services (id, aces_id, professional_location_id, service_id, price_cents_override)
VALUES
  -- Dra. Lorena -> Clínica Geral R$110
  ('f6000001-0000-0000-0000-000000000001', 1, 'e5000001-0000-0000-0000-000000000001', 'c3000001-0000-0000-0000-000000000001', 11000),
  -- Dra. Clarissa -> Clínica Geral R$130
  ('f6000001-0000-0000-0000-000000000002', 1, 'e5000001-0000-0000-0000-000000000002', 'c3000001-0000-0000-0000-000000000001', 13000),
  -- Dra. Clarissa -> Glaucoma R$180
  ('f6000001-0000-0000-0000-000000000003', 1, 'e5000001-0000-0000-0000-000000000002', 'c3000001-0000-0000-0000-000000000002', 18000),
  -- Dr. Rodrigo Reny -> Clínica Geral R$130
  ('f6000001-0000-0000-0000-000000000004', 1, 'e5000001-0000-0000-0000-000000000003', 'c3000001-0000-0000-0000-000000000001', 13000),
  -- Dr. Pedro Caluête -> Clínica Geral R$130
  ('f6000001-0000-0000-0000-000000000005', 1, 'e5000001-0000-0000-0000-000000000004', 'c3000001-0000-0000-0000-000000000001', 13000),
  -- Dr. Pedro Caluête -> Glaucoma R$130
  ('f6000001-0000-0000-0000-000000000006', 1, 'e5000001-0000-0000-0000-000000000004', 'c3000001-0000-0000-0000-000000000002', 13000),
  -- Dra. Camila Regina -> Clínica Geral R$130
  ('f6000001-0000-0000-0000-000000000007', 1, 'e5000001-0000-0000-0000-000000000005', 'c3000001-0000-0000-0000-000000000001', 13000),
  -- Dr. Eder -> Clínica Geral R$150
  ('f6000001-0000-0000-0000-000000000008', 1, 'e5000001-0000-0000-0000-000000000006', 'c3000001-0000-0000-0000-000000000001', 15000),
  -- Dr. Itamar -> Clínica Geral R$150
  ('f6000001-0000-0000-0000-000000000009', 1, 'e5000001-0000-0000-0000-000000000007', 'c3000001-0000-0000-0000-000000000001', 15000),
  -- Dra. Erika Leite -> Oftalmopediatria R$230
  ('f6000001-0000-0000-0000-00000000000a', 1, 'e5000001-0000-0000-0000-000000000008', 'c3000001-0000-0000-0000-000000000003', 23000),
  -- Dra. Vitória -> Cirurgia/Avaliação R$130
  ('f6000001-0000-0000-0000-00000000000b', 1, 'e5000001-0000-0000-0000-000000000009', 'c3000001-0000-0000-0000-000000000004', 13000),
  -- Dra. Leilane -> Cirurgia/Avaliação R$130
  ('f6000001-0000-0000-0000-00000000000c', 1, 'e5000001-0000-0000-0000-00000000000a', 'c3000001-0000-0000-0000-000000000004', 13000),
  -- Dr. Túlio Ivo -> Cirurgia/Avaliação R$130
  ('f6000001-0000-0000-0000-00000000000d', 1, 'e5000001-0000-0000-0000-00000000000b', 'c3000001-0000-0000-0000-000000000004', 13000),
  -- Dr. Abílio Santiago -> Clínica Geral R$150
  ('f6000001-0000-0000-0000-00000000000e', 1, 'e5000001-0000-0000-0000-00000000000c', 'c3000001-0000-0000-0000-000000000001', 15000),
  -- Dr. Vinicius -> Clínica Geral R$110
  ('f6000001-0000-0000-0000-00000000000f', 1, 'e5000001-0000-0000-0000-00000000000d', 'c3000001-0000-0000-0000-000000000001', 11000)
ON CONFLICT (professional_location_id, service_id) DO NOTHING;

-- =========================================================================
-- FASE 7: Regras de Disponibilidade (dias e horários por médico/local)
-- weekday: 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
-- =========================================================================

INSERT INTO calendar.availability_rules (aces_id, professional_location_id, weekday, start_time, end_time)
VALUES
  -- Dra. Lorena: Seg, Ter, Qua, Sex (manhã)
  (1, 'e5000001-0000-0000-0000-000000000001', 1, '08:00', '12:00'),
  (1, 'e5000001-0000-0000-0000-000000000001', 2, '08:00', '12:00'),
  (1, 'e5000001-0000-0000-0000-000000000001', 3, '08:00', '12:00'),
  (1, 'e5000001-0000-0000-0000-000000000001', 5, '08:00', '12:00'),

  -- Dra. Clarissa: Seg a Sáb
  (1, 'e5000001-0000-0000-0000-000000000002', 1, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000002', 2, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000002', 3, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000002', 4, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000002', 5, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000002', 6, '08:00', '12:00'),

  -- Dr. Rodrigo Reny: Seg a Sáb
  (1, 'e5000001-0000-0000-0000-000000000003', 1, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000003', 2, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000003', 3, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000003', 4, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000003', 5, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000003', 6, '08:00', '12:00'),

  -- Dr. Pedro Caluête: Seg a Sáb
  (1, 'e5000001-0000-0000-0000-000000000004', 1, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000004', 2, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000004', 3, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000004', 4, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000004', 5, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000004', 6, '08:00', '12:00'),

  -- Dra. Camila Regina: Seg a Sáb
  (1, 'e5000001-0000-0000-0000-000000000005', 1, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000005', 2, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000005', 3, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000005', 4, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000005', 5, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000005', 6, '08:00', '12:00'),

  -- Dr. Eder (Coocap): Seg, Qua, Qui, Sex
  (1, 'e5000001-0000-0000-0000-000000000006', 1, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000006', 3, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000006', 4, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000006', 5, '08:00', '17:00'),

  -- Dr. Itamar (Coocap): Ter e Sáb
  (1, 'e5000001-0000-0000-0000-000000000007', 2, '08:00', '12:00'),
  (1, 'e5000001-0000-0000-0000-000000000007', 6, '08:00', '12:00'),

  -- Dra. Erika Leite: Qua (placeholder - dia a confirmar)
  (1, 'e5000001-0000-0000-0000-000000000008', 3, '08:00', '17:00'),

  -- Dra. Vitória (Oftale): Seg e Sáb alternados -> seed como ambos por simplicidade
  (1, 'e5000001-0000-0000-0000-000000000009', 1, '08:00', '17:00'),
  (1, 'e5000001-0000-0000-0000-000000000009', 6, '08:00', '12:00'),

  -- Dra. Leilane (Oftale): Terça
  (1, 'e5000001-0000-0000-0000-00000000000a', 2, '08:00', '17:00'),

  -- Dr. Túlio Ivo (Oftale): Sexta
  (1, 'e5000001-0000-0000-0000-00000000000b', 5, '08:00', '17:00'),

  -- Dr. Abílio Santiago (Jataúba): Sexta a partir das 8:30
  (1, 'e5000001-0000-0000-0000-00000000000c', 5, '08:30', '17:00'),

  -- Dr. Vinicius (Sumé): Segunda
  (1, 'e5000001-0000-0000-0000-00000000000d', 1, '08:00', '17:00')
ON CONFLICT DO NOTHING;

-- =========================================================================
-- FASE 8: Destinos de Encaminhamento (forwarding_destinations)
-- =========================================================================

-- 8a. Destinos internos por empresa (para Silvana - agente principal)
INSERT INTO agents.forwarding_destinations (id, aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id, context_instruction)
VALUES
  ('aa000001-0000-0000-0000-000000000001', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'vendas_santa_cruz', 'Vendas - Santa Cruz', 'internal_company', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Encaminhe quando o cliente de Santa Cruz solicitar orçamento detalhado, escolher lente/armação, enviar receita ou pedir atendimento humano.'),
  ('aa000001-0000-0000-0000-000000000002', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'vendas_jatauba',    'Vendas - Jataúba',    'internal_company', 'dcde43dc-e6ac-4130-bcf7-2e30b94a9f27', 'Encaminhe quando o cliente de Jataúba demonstrar interesse em agendamento ou compra.'),
  ('aa000001-0000-0000-0000-000000000003', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'vendas_sume',       'Vendas - Sumé',       'internal_company', '3af09eba-52d6-4f4a-93d4-eae7a239da56', 'Encaminhe quando o cliente de Sumé demonstrar interesse em agendamento ou compra.'),
  ('aa000001-0000-0000-0000-000000000004', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'financeiro_santa_cruz', 'Financeiro - Santa Cruz', 'internal_company', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Encaminhe assuntos financeiros: carnê, parcelas em atraso, segunda via.')
ON CONFLICT (agent_tool_id, destination_key) DO NOTHING;

-- 8b. Destinos internos por empresa (para Subagente Clínico)
INSERT INTO agents.forwarding_destinations (id, aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id, context_instruction)
VALUES
  ('aa000001-0000-0000-0000-000000000011', 1, 'c5671a55-eb60-40ed-858f-09b1e9e3ab78', 'clinico_santa_cruz', 'Agendamento Clínico - Santa Cruz', 'internal_company', '3bea7044-d301-46c4-b84d-3d9bcfaabbe3', 'Encaminhe quando o cliente de Santa Cruz quiser agendar, remarcar ou cancelar consulta.'),
  ('aa000001-0000-0000-0000-000000000012', 1, 'c5671a55-eb60-40ed-858f-09b1e9e3ab78', 'clinico_jatauba',    'Agendamento Clínico - Jataúba',    'internal_company', 'dcde43dc-e6ac-4130-bcf7-2e30b94a9f27', 'Encaminhe quando o cliente de Jataúba quiser agendar consulta com Dr. Abílio Santiago.'),
  ('aa000001-0000-0000-0000-000000000013', 1, 'c5671a55-eb60-40ed-858f-09b1e9e3ab78', 'clinico_sume',       'Agendamento Clínico - Sumé',       'internal_company', '3af09eba-52d6-4f4a-93d4-eae7a239da56', 'Encaminhe quando o cliente de Sumé quiser agendar consulta com Dr. Vinicius.')
ON CONFLICT (agent_tool_id, destination_key) DO NOTHING;

-- 8c. Destinos externos (para Silvana - cidades fora do escopo)
INSERT INTO agents.forwarding_destinations (id, aces_id, agent_tool_id, destination_key, display_name, mode, target_phone, context_instruction)
VALUES
  ('aa000001-0000-0000-0000-000000000021', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'arcoverde_receptivo', 'Arcoverde - Receptivo',     'external_notification', '5587996230075', 'Redirecione clientes que solicitarem atendimento em Arcoverde.'),
  ('aa000001-0000-0000-0000-000000000022', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'arcoverde',           'Arcoverde',                 'external_notification', '558799931078',  'Redirecione clientes que solicitarem atendimento em Arcoverde.'),
  ('aa000001-0000-0000-0000-000000000023', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'sao_jose_egito',      'São José do Egito',         'external_notification', '558799422525',  'Redirecione clientes que solicitarem atendimento em São José do Egito.'),
  ('aa000001-0000-0000-0000-000000000024', 1, 'a0f8a97d-50ed-47ed-b301-14f45c9b0e0f', 'monteiro',            'Monteiro',                  'external_notification', '5583998170941', 'Redirecione clientes que solicitarem atendimento em Monteiro.')
ON CONFLICT (agent_tool_id, destination_key) DO NOTHING;

-- =========================================================================
-- FASE 9: Vincular Vendedores aos Destinos de Empresa
-- =========================================================================

INSERT INTO agents.forwarding_destination_sellers (aces_id, forwarding_destination_id, crm_user_id)
VALUES
  -- Vendedora Santa Cruz nos destinos de Santa Cruz (vendas + financeiro + clínico)
  (1, 'aa000001-0000-0000-0000-000000000001', 'b2000001-0000-0000-0000-000000000001'),
  (1, 'aa000001-0000-0000-0000-000000000004', 'b2000001-0000-0000-0000-000000000001'),
  (1, 'aa000001-0000-0000-0000-000000000011', 'b2000001-0000-0000-0000-000000000001'),
  -- Vendedor Jataúba nos destinos de Jataúba
  (1, 'aa000001-0000-0000-0000-000000000002', 'b2000001-0000-0000-0000-000000000002'),
  (1, 'aa000001-0000-0000-0000-000000000012', 'b2000001-0000-0000-0000-000000000002'),
  -- Vendedora Sumé nos destinos de Sumé
  (1, 'aa000001-0000-0000-0000-000000000003', 'b2000001-0000-0000-0000-000000000003'),
  (1, 'aa000001-0000-0000-0000-000000000013', 'b2000001-0000-0000-0000-000000000003')
ON CONFLICT (forwarding_destination_id, crm_user_id) DO NOTHING;

-- =========================================================================
-- FASE 10: Habilitar Ferramentas de Forwarding nos Agentes
-- =========================================================================

UPDATE agents.agent_tools
SET is_enabled = true, readiness = 'ready', updated_at = now()
WHERE tool_key = 'forwarding'
  AND agent_id IN (
    '668645dd-8a8b-4bba-95c2-b3d646be7d29',  -- Silvana
    '10fc2fcb-0976-4e13-b693-51fee5549fd0'    -- Subagente Clínico
  );

COMMIT;
