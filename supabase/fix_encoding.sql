BEGIN;

-- =========================================================================
-- FIX: Corrigir acentos corrompidos (encoding UTF-8 via PowerShell)
-- =========================================================================

-- 1. calendar.professionals
UPDATE calendar.professionals SET name = 'Dr. Abilio Santiago', specialty = 'Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-00000000000c';

UPDATE calendar.professionals SET specialty = 'Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-000000000006';

UPDATE calendar.professionals SET specialty = 'Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-000000000007';

UPDATE calendar.professionals SET name = 'Dr. Pedro Caluete', specialty = 'Glaucoma / Oftalmologia'
WHERE id = 'd4000001-0000-0000-0000-000000000004';

UPDATE calendar.professionals SET name = 'Dr. Tulio Ivo', specialty = 'Especialista / Cirurgiao'
WHERE id = 'd4000001-0000-0000-0000-00000000000b';

UPDATE calendar.professionals SET specialty = 'Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-00000000000d';

UPDATE calendar.professionals SET specialty = 'Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-000000000005';

UPDATE calendar.professionals SET specialty = 'Glaucoma / Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-000000000002';

UPDATE calendar.professionals SET specialty = 'Especialista / Cirurgia'
WHERE id = 'd4000001-0000-0000-0000-00000000000a';

UPDATE calendar.professionals SET specialty = 'Clinica Geral'
WHERE id = 'd4000001-0000-0000-0000-000000000001';

UPDATE calendar.professionals SET name = 'Dra. Vitoria', specialty = 'Especialista / Cirurgia'
WHERE id = 'd4000001-0000-0000-0000-000000000009';

-- 2. calendar.services
UPDATE calendar.services SET name = 'Consulta Oftalmologica - Clinica Geral', description = 'Consulta de rotina com oftalmologista clinico geral.'
WHERE id = 'c3000001-0000-0000-0000-000000000001';

UPDATE calendar.services SET name = 'Consulta Oftalmologica - Glaucoma', description = 'Consulta especializada em glaucoma.'
WHERE id = 'c3000001-0000-0000-0000-000000000002';

UPDATE calendar.services SET name = 'Consulta Oftalmologica - Oftalmopediatria', description = 'Consulta oftalmologica pediatrica.'
WHERE id = 'c3000001-0000-0000-0000-000000000003';

UPDATE calendar.services SET name = 'Consulta Oftalmologica - Cirurgia/Avaliacao', description = 'Avaliacao cirurgica com oftalmologista especialista.'
WHERE id = 'c3000001-0000-0000-0000-000000000004';

-- 3. calendar.professional_locations
UPDATE calendar.professional_locations SET location_name = 'Centro de Olhos - Av. Padre Zuzinha, 262'
WHERE id = 'e5000001-0000-0000-0000-000000000001';

UPDATE calendar.professional_locations SET location_name = 'Consultorio proprio'
WHERE id IN (
  'e5000001-0000-0000-0000-000000000002',
  'e5000001-0000-0000-0000-000000000003',
  'e5000001-0000-0000-0000-000000000004',
  'e5000001-0000-0000-0000-000000000005',
  'e5000001-0000-0000-0000-000000000008'
);

UPDATE calendar.professional_locations SET location_name = 'Clinica Santa Ana - R. Sao Sebastiao, 29 - Centro'
WHERE id = 'e5000001-0000-0000-0000-00000000000c';

UPDATE calendar.professional_locations SET location_name = 'Consultorio na Otica Cardeal'
WHERE id = 'e5000001-0000-0000-0000-00000000000d';

-- 4. agents.forwarding_destinations (corrigir os com IDs fixos aa000001-...)
UPDATE agents.forwarding_destinations
SET display_name = 'Vendas - Santa Cruz',
    context_instruction = 'Encaminhe quando o cliente de Santa Cruz solicitar orcamento detalhado, escolher lente/armacao, enviar receita ou pedir atendimento humano.'
WHERE id = 'aa000001-0000-0000-0000-000000000001';

UPDATE agents.forwarding_destinations
SET display_name = 'Vendas - Jatauba',
    context_instruction = 'Encaminhe quando o cliente de Jatauba demonstrar interesse em agendamento ou compra.'
WHERE id = 'aa000001-0000-0000-0000-000000000002';

UPDATE agents.forwarding_destinations
SET display_name = 'Vendas - Sume',
    context_instruction = 'Encaminhe quando o cliente de Sume demonstrar interesse em agendamento ou compra.'
WHERE id = 'aa000001-0000-0000-0000-000000000003';

UPDATE agents.forwarding_destinations
SET display_name = 'Financeiro - Santa Cruz',
    context_instruction = 'Encaminhe assuntos financeiros: carne, parcelas em atraso, segunda via.'
WHERE id = 'aa000001-0000-0000-0000-000000000004';

UPDATE agents.forwarding_destinations
SET display_name = 'Agendamento Clinico - Santa Cruz',
    context_instruction = 'Encaminhe quando o cliente de Santa Cruz quiser agendar, remarcar ou cancelar consulta.'
WHERE id = 'aa000001-0000-0000-0000-000000000011';

UPDATE agents.forwarding_destinations
SET display_name = 'Agendamento Clinico - Jatauba',
    context_instruction = 'Encaminhe quando o cliente de Jatauba quiser agendar consulta com Dr. Abilio Santiago.'
WHERE id = 'aa000001-0000-0000-0000-000000000012';

UPDATE agents.forwarding_destinations
SET display_name = 'Agendamento Clinico - Sume',
    context_instruction = 'Encaminhe quando o cliente de Sume quiser agendar consulta com Dr. Vinicius.'
WHERE id = 'aa000001-0000-0000-0000-000000000013';

UPDATE agents.forwarding_destinations
SET display_name = 'Sao Jose do Egito',
    context_instruction = 'Redirecione clientes que solicitarem atendimento em Sao Jose do Egito.'
WHERE id = 'aa000001-0000-0000-0000-000000000023';

-- 5. Remover duplicatas com acentos (IDs gerados automaticamente pelo segundo seed run)
DELETE FROM agents.forwarding_destinations
WHERE id NOT LIKE 'aa000001-%'
  AND destination_key IN (
    'clinico_santa_cruz', 'clinico_jatauba', 'clinico_sume'
  );

-- 6. crm.users (vendedores)
UPDATE crm.users SET name = 'Carlos - Vendedor Jatauba'
WHERE id = 'b2000001-0000-0000-0000-000000000002';

UPDATE crm.users SET name = 'Maria - Vendedora Sume'
WHERE id = 'b2000001-0000-0000-0000-000000000003';

COMMIT;
