-- Seed SQL para criação completa do cliente QueroMed no banco local
-- Executa a criação da Conta (aces_id = 6), associação do usuário Lucas, 4 Vendedores,
-- 4 Empresas, Redirecionamento por Empresa, 4 Instâncias, 4 Agentes com Agenda (todas as permissões) e Encaminhamento Humano.

BEGIN;

-- 1. Criação da Conta QueroMed
INSERT INTO crm.accounts (id, name, status)
VALUES (6, 'QueroMed Consultas Médicas', 'active')
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status;

-- 2. Atualizar o usuário logado 'mattsyk1@gmail.com' (Lucas) para a conta aces_id = 6 como ADMIN
UPDATE crm.users
SET aces_id = 6, role = 'ADMIN'::crm.user_role
WHERE email = 'mattsyk1@gmail.com';

-- 3. Usuários adicionais no auth.users
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  (
    '60000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'admin@queromed.com.br',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(), '{"provider":"email"}'::jsonb, '{"name":"Admin QueroMed"}'::jsonb, now(), now()
  ),
  (
    '60000000-0000-0000-0000-000000000010',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendedor.centro@queromed.com.br',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(), '{"provider":"email"}'::jsonb, '{"name":"Vendedor Centro"}'::jsonb, now(), now()
  ),
  (
    '60000000-0000-0000-0000-000000000020',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendedor.pinheirinho@queromed.com.br',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(), '{"provider":"email"}'::jsonb, '{"name":"Vendedor Pinheirinho"}'::jsonb, now(), now()
  ),
  (
    '60000000-0000-0000-0000-000000000030',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendedor.pinhais@queromed.com.br',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(), '{"provider":"email"}'::jsonb, '{"name":"Vendedor Pinhais"}'::jsonb, now(), now()
  ),
  (
    '60000000-0000-0000-0000-000000000040',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'vendedor.fazenda@queromed.com.br',
    '$2a$10$wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6Gz1xZ8m9aH6Gz.wT8m9aH6G',
    now(), '{"provider":"email"}'::jsonb, '{"name":"Vendedor Fazenda Rio Grande"}'::jsonb, now(), now()
  )
ON CONFLICT (id) DO NOTHING;

-- 4. Usuários no crm.users
INSERT INTO crm.users (id, auth_user_id, email, name, role, aces_id)
VALUES
  ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000000', 'admin@queromed.com.br', 'Admin QueroMed', 'ADMIN', 6),
  ('60000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000010', 'vendedor.centro@queromed.com.br', 'Vendedor Centro', 'VENDEDOR', 6),
  ('60000000-0000-0000-0000-000000000021', '60000000-0000-0000-0000-000000000020', 'vendedor.pinheirinho@queromed.com.br', 'Vendedor Pinheirinho', 'VENDEDOR', 6),
  ('60000000-0000-0000-0000-000000000031', '60000000-0000-0000-0000-000000000030', 'vendedor.pinhais@queromed.com.br', 'Vendedor Pinhais', 'VENDEDOR', 6),
  ('60000000-0000-0000-0000-000000000041', '60000000-0000-0000-0000-000000000040', 'vendedor.fazenda@queromed.com.br', 'Vendedor Fazenda Rio Grande', 'VENDEDOR', 6)
ON CONFLICT (id) DO NOTHING;

-- 5. Cadastro das 4 Empresas no crm.empresas
INSERT INTO crm.empresas (id, aces_id, cnpj, legal_name, name, address, city, state, is_active, created_by)
VALUES
  (
    '60000000-0000-0000-0000-000000000101', 6, '12341114000184', 'QUEROMED CONSULTAS MEDICAS LTDA',
    'QueroMed - Curitiba Centro', 'Praça Rui Barbosa, 827 — Sala 101 — Centro (Acima da Casa China)',
    'Curitiba', 'PR', true, 'b08e4680-f839-4a3d-90f1-885fdce56789'
  ),
  (
    '60000000-0000-0000-0000-000000000102', 6, '12341114000265', 'QUEROMED CONSULTAS MEDICAS LTDA',
    'QueroMed - Pinheirinho Curitiba', 'Avenida Winston Churchill, 2730 — Sala 16 — Pinheirinho',
    'Curitiba', 'PR', true, 'b08e4680-f839-4a3d-90f1-885fdce56789'
  ),
  (
    '60000000-0000-0000-0000-000000000103', 6, '12341114000346', 'QUEROMED CONSULTAS MEDICAS LTDA',
    'QueroMed - Pinhais', 'Rua Europa, 543 — Lojas 15 e 16 — Terminal de Pinhais',
    'Pinhais', 'PR', true, 'b08e4680-f839-4a3d-90f1-885fdce56789'
  ),
  (
    '60000000-0000-0000-0000-000000000104', 6, '12341114000508', 'QUEROMED CONSULTAS MEDICAS LTDA',
    'QueroMed - Fazenda Rio Grande', 'Rua Francisco Claudino dos Santos, 245 — Sala 02 — Iguaçu (Abaixo do Salão Marly)',
    'Fazenda Rio Grande', 'PR', true, 'b08e4680-f839-4a3d-90f1-885fdce56789'
  )
ON CONFLICT (aces_id, cnpj) DO UPDATE
SET legal_name = EXCLUDED.legal_name, name = EXCLUDED.name, address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state;

-- 6. Redirecionamento por Empresa (crm.empresa_memberships)
INSERT INTO crm.empresa_memberships (aces_id, empresa_id, crm_user_id, granted_by, is_active)
VALUES
  (6, '60000000-0000-0000-0000-000000000101', '60000000-0000-0000-0000-000000000011', 'b08e4680-f839-4a3d-90f1-885fdce56789', true),
  (6, '60000000-0000-0000-0000-000000000102', '60000000-0000-0000-0000-000000000021', 'b08e4680-f839-4a3d-90f1-885fdce56789', true),
  (6, '60000000-0000-0000-0000-000000000103', '60000000-0000-0000-0000-000000000031', 'b08e4680-f839-4a3d-90f1-885fdce56789', true),
  (6, '60000000-0000-0000-0000-000000000104', '60000000-0000-0000-0000-000000000041', 'b08e4680-f839-4a3d-90f1-885fdce56789', true)
ON CONFLICT (empresa_id, crm_user_id) DO UPDATE SET is_active = true;

-- 7. Instâncias no crm.instance
INSERT INTO crm.instance (instancia, aces_id, status)
VALUES
  ('queromed_centro', 6, 'connected'),
  ('queromed_pinheirinho', 6, 'connected'),
  ('queromed_pinhais', 6, 'connected'),
  ('queromed_fazenda', 6, 'connected')
ON CONFLICT (instancia) DO NOTHING;

-- 8. Registro dos 4 Agentes Primários em agents.ai_agents
INSERT INTO agents.ai_agents (
  id, aces_id, name, instance_name, system_prompt, provider, model, temperature, personality_profile, is_active, created_by, agent_type, handoff_enabled, handoff_prompt
)
VALUES
  (
    '60000000-0000-0000-0000-000000000051', 6, 'Henrique - QueroMed Centro', 'queromed_centro',
    'Você é Henrique, atendente da QueroMed Curitiba Centro...', 'gemini', 'gemini-3.1-flash-lite', 0.20, 'consultative', true, 'b08e4680-f839-4a3d-90f1-885fdce56789', 'primary', true,
    'Encaminhe para atendimento humano quando: o paciente solicitar falar com uma pessoa; a duvida envolver informacao medica nao prevista no prompt; o paciente fizer uma reclamacao; ou solicitar suporte, cancelamento ou alteracao que nao possa ser realizada pela ferramenta do sistema.'
  ),
  (
    '60000000-0000-0000-0000-000000000052', 6, 'Henrique - QueroMed Pinheirinho', 'queromed_pinheirinho',
    'Você é Henrique, atendente da QueroMed Pinheirinho...', 'gemini', 'gemini-3.1-flash-lite', 0.20, 'consultative', true, 'b08e4680-f839-4a3d-90f1-885fdce56789', 'primary', true,
    'Encaminhe para atendimento humano quando: o paciente solicitar falar com uma pessoa; a duvida envolver informacao medica nao prevista no prompt; o paciente fizer uma reclamacao; ou solicitar suporte, cancelamento ou alteracao que nao possa ser realizada pela ferramenta do sistema.'
  ),
  (
    '60000000-0000-0000-0000-000000000053', 6, 'Henrique - QueroMed Pinhais', 'queromed_pinhais',
    'Você é Henrique, atendente da QueroMed Pinhais...', 'gemini', 'gemini-3.1-flash-lite', 0.20, 'consultative', true, 'b08e4680-f839-4a3d-90f1-885fdce56789', 'primary', true,
    'Encaminhe para atendimento humano quando: o paciente solicitar falar com uma pessoa; a duvida envolver informacao medica nao prevista no prompt; o paciente fizer uma reclamacao; ou solicitar suporte, cancelamento ou alteracao que nao possa ser realizada pela ferramenta do sistema.'
  ),
  (
    '60000000-0000-0000-0000-000000000054', 6, 'Henrique - QueroMed Fazenda', 'queromed_fazenda',
    'Você é Henrique, atendente da QueroMed Fazenda Rio Grande...', 'gemini', 'gemini-3.1-flash-lite', 0.20, 'consultative', true, 'b08e4680-f839-4a3d-90f1-885fdce56789', 'primary', true,
    'Encaminhe para atendimento humano quando: o paciente solicitar falar com uma pessoa; a duvida envolver informacao medica nao prevista no prompt; o paciente fizer uma reclamacao; ou solicitar suporte, cancelamento ou alteracao que nao possa ser realizada pela ferramenta do sistema.'
  )
ON CONFLICT (aces_id, instance_name) DO UPDATE SET name = EXCLUDED.name, system_prompt = EXCLUDED.system_prompt;

-- 9. Ferramentas (agent_tools): Agenda (com todas permissões) e Forwarding habilitadas para os 4 Agentes
INSERT INTO agents.agent_tools (aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config)
VALUES
  (6, '60000000-0000-0000-0000-000000000051', 'calendar', 1, true, 'ready', '{"queryAvailability": true, "create": true, "reschedule": true, "cancel": true}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000051', 'forwarding', 1, true, 'ready', '{}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000052', 'calendar', 1, true, 'ready', '{"queryAvailability": true, "create": true, "reschedule": true, "cancel": true}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000052', 'forwarding', 1, true, 'ready', '{}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000053', 'calendar', 1, true, 'ready', '{"queryAvailability": true, "create": true, "reschedule": true, "cancel": true}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000053', 'forwarding', 1, true, 'ready', '{}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000054', 'calendar', 1, true, 'ready', '{"queryAvailability": true, "create": true, "reschedule": true, "cancel": true}'::jsonb),
  (6, '60000000-0000-0000-0000-000000000054', 'forwarding', 1, true, 'ready', '{}'::jsonb)
ON CONFLICT (agent_id, tool_key) DO UPDATE SET is_enabled = true, readiness = 'ready', config = EXCLUDED.config;

-- 10. Destinos de Encaminhamento por Empresa (forwarding_destinations)
INSERT INTO agents.forwarding_destinations (aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id, context_instruction, is_active)
SELECT 6, t.id, 'vendedor_centro', 'Vendedor Centro', 'internal_company', '60000000-0000-0000-0000-000000000101', 'Encaminhar ao vendedor responsável da unidade Centro quando o paciente solicitar pessoa humana, houver reclamação ou dúvida médica fora do prompt.', true
FROM agents.agent_tools t WHERE t.agent_id = '60000000-0000-0000-0000-000000000051' AND t.tool_key = 'forwarding'
ON CONFLICT (agent_tool_id, destination_key) DO UPDATE SET is_active = true, empresa_id = EXCLUDED.empresa_id;

INSERT INTO agents.forwarding_destinations (aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id, context_instruction, is_active)
SELECT 6, t.id, 'vendedor_pinheirinho', 'Vendedor Pinheirinho', 'internal_company', '60000000-0000-0000-0000-000000000102', 'Encaminhar ao vendedor responsável da unidade Pinheirinho quando o paciente solicitar pessoa humana, houver reclamação ou dúvida médica fora do prompt.', true
FROM agents.agent_tools t WHERE t.agent_id = '60000000-0000-0000-0000-000000000052' AND t.tool_key = 'forwarding'
ON CONFLICT (agent_tool_id, destination_key) DO UPDATE SET is_active = true, empresa_id = EXCLUDED.empresa_id;

INSERT INTO agents.forwarding_destinations (aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id, context_instruction, is_active)
SELECT 6, t.id, 'vendedor_pinhais', 'Vendedor Pinhais', 'internal_company', '60000000-0000-0000-0000-000000000103', 'Encaminhar ao vendedor responsável da unidade Pinhais quando o paciente solicitar pessoa humana, houver reclamação ou dúvida médica fora do prompt.', true
FROM agents.agent_tools t WHERE t.agent_id = '60000000-0000-0000-0000-000000000053' AND t.tool_key = 'forwarding'
ON CONFLICT (agent_tool_id, destination_key) DO UPDATE SET is_active = true, empresa_id = EXCLUDED.empresa_id;

INSERT INTO agents.forwarding_destinations (aces_id, agent_tool_id, destination_key, display_name, mode, empresa_id, context_instruction, is_active)
SELECT 6, t.id, 'vendedor_fazenda', 'Vendedor Fazenda Rio Grande', 'internal_company', '60000000-0000-0000-0000-000000000104', 'Encaminhar ao vendedor responsável da unidade Fazenda Rio Grande quando o paciente solicitar pessoa humana, houver reclamação ou dúvida médica fora do prompt.', true
FROM agents.agent_tools t WHERE t.agent_id = '60000000-0000-0000-0000-000000000054' AND t.tool_key = 'forwarding'
ON CONFLICT (agent_tool_id, destination_key) DO UPDATE SET is_active = true, empresa_id = EXCLUDED.empresa_id;

-- 11. Configuração da Agenda (calendar.settings)
INSERT INTO calendar.settings (aces_id, timezone, slot_interval_minutes, minimum_notice_minutes, booking_horizon_days, ai_booking_enabled)
VALUES (6, 'America/Sao_Paulo', 20, 60, 90, false)
ON CONFLICT (aces_id) DO UPDATE SET slot_interval_minutes = 20;

-- 12. Cadastro de Profissional Padrão ("Oftalmologista")
INSERT INTO calendar.professionals (id, aces_id, name, specialty, is_active)
VALUES ('60000000-0000-0000-0000-000000000201', 6, 'Oftalmologista QueroMed', 'Oftalmologia Geral', true)
ON CONFLICT (id) DO NOTHING;

-- 13. Locais do Profissional (para cada uma das 4 Empresas)
INSERT INTO calendar.professional_locations (id, aces_id, professional_id, empresa_id, is_active, is_ai_visible)
VALUES
  ('60000000-0000-0000-0000-000000000211', 6, '60000000-0000-0000-0000-000000000201', '60000000-0000-0000-0000-000000000101', true, true),
  ('60000000-0000-0000-0000-000000000212', 6, '60000000-0000-0000-0000-000000000201', '60000000-0000-0000-0000-000000000102', true, true),
  ('60000000-0000-0000-0000-000000000213', 6, '60000000-0000-0000-0000-000000000201', '60000000-0000-0000-0000-000000000103', true, true),
  ('60000000-0000-0000-0000-000000000214', 6, '60000000-0000-0000-0000-000000000201', '60000000-0000-0000-0000-000000000104', true, true)
ON CONFLICT (id) DO NOTHING;

-- 14. Serviço de Exame / Consulta Oftalmológica (R$ 70,00 - Duração 20 minutos)
INSERT INTO calendar.services (id, aces_id, name, description, duration_minutes, price_cents, is_active, is_ai_visible)
VALUES ('60000000-0000-0000-0000-000000000301', 6, 'Consulta / Exame Oftalmológico', 'Exame clínico e consulta com oftalmologista', 20, 7000, true, true)
ON CONFLICT (id) DO NOTHING;

-- 15. Vínculo do Serviço com os Locais do Profissional
INSERT INTO calendar.professional_services (aces_id, professional_location_id, service_id, is_active, is_ai_visible)
VALUES
  (6, '60000000-0000-0000-0000-000000000211', '60000000-0000-0000-0000-000000000301', true, true),
  (6, '60000000-0000-0000-0000-000000000212', '60000000-0000-0000-0000-000000000301', true, true),
  (6, '60000000-0000-0000-0000-000000000213', '60000000-0000-0000-0000-000000000301', true, true),
  (6, '60000000-0000-0000-0000-000000000214', '60000000-0000-0000-0000-000000000301', true, true)
ON CONFLICT (professional_location_id, service_id) DO NOTHING;

-- 16. Regras de Horários (Availability Rules) - 20 em 20 min de Seg a Sex
DO $$
DECLARE
  v_loc_id uuid;
  v_day smallint;
BEGIN
  FOR v_loc_id IN
    SELECT id FROM calendar.professional_locations WHERE aces_id = 6
  LOOP
    FOR v_day IN 1..5 LOOP
      -- Turno Manhã
      INSERT INTO calendar.availability_rules (aces_id, professional_location_id, weekday, start_time, end_time, is_active)
      VALUES (6, v_loc_id, v_day, '08:00:00', '12:00:00', true)
      ON CONFLICT DO NOTHING;

      -- Turno Tarde
      INSERT INTO calendar.availability_rules (aces_id, professional_location_id, weekday, start_time, end_time, is_active)
      VALUES (6, v_loc_id, v_day, '13:00:00', '18:00:00', true)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

COMMIT;
