-- Massa local para validar a exibicao e a separacao de conversas por instancia.
-- Idempotente: pode ser executada novamente sem duplicar os registros de teste.

BEGIN;

SET LOCAL statement_timeout = '2min';

-- Duas instancias de WhatsApp locais, marcadas como conectadas para aparecerem
-- imediatamente no painel durante o teste.
INSERT INTO crm.instance (
  instancia, aces_id, color, status, setup_status, setup_started_at,
  setup_expires_at, created_by, connection_mode
)
VALUES
  ('TESTE_OTICA_A', 1, '#2563EB', 'connected', 'connected', now(), now() + interval '30 days', '1231e918-4526-415a-9972-36ac4854a2af', 'local'),
  ('TESTE_OTICA_B', 1, '#16A34A', 'connected', 'connected', now(), now() + interval '30 days', '1231e918-4526-415a-9972-36ac4854a2af', 'local')
ON CONFLICT (instancia) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    color = EXCLUDED.color,
    status = EXCLUDED.status,
    setup_status = EXCLUDED.setup_status,
    setup_started_at = EXCLUDED.setup_started_at,
    setup_expires_at = EXCLUDED.setup_expires_at,
    created_by = EXCLUDED.created_by,
    connection_mode = EXCLUDED.connection_mode,
    last_error = NULL;

-- O trigger da tabela cria/sincroniza as duas messaging_connections canonicas.
INSERT INTO crm.instance_channels (
  id, aces_id, instance_name, channel_type, provider, capability, status,
  messaging_connection_id
)
VALUES
  ('61000000-0000-0000-0000-000000000001', 1, 'TESTE_OTICA_A', 'whatsapp', 'evolution', 'full', 'active', '61000000-0000-0000-0000-000000000001'),
  ('61000000-0000-0000-0000-000000000002', 1, 'TESTE_OTICA_B', 'whatsapp', 'evolution', 'full', 'active', '61000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    instance_name = EXCLUDED.instance_name,
    channel_type = EXCLUDED.channel_type,
    provider = EXCLUDED.provider,
    capability = EXCLUDED.capability,
    status = EXCLUDED.status,
    messaging_connection_id = EXCLUDED.messaging_connection_id;

-- Dois agentes primarios, um por instancia, com prompt deliberadamente simples.
INSERT INTO agents.ai_agents (
  id, aces_id, instance_name, name, system_prompt, provider, model,
  is_active, created_by, temperature, handoff_enabled, unanswered_followup_enabled,
  personality_profile, rag_enabled, agent_type
)
VALUES
  ('62000000-0000-0000-0000-000000000001', 1, 'TESTE_OTICA_A', 'Agente Teste Otica A', 'TESTE: responda de forma curta e cordial como atendente da Otica A.', 'gemini', 'gemini-3.1-flash-lite', true, '1231e918-4526-415a-9972-36ac4854a2af', 0.30, false, false, 'balanced', false, 'primary'),
  ('62000000-0000-0000-0000-000000000002', 1, 'TESTE_OTICA_B', 'Agente Teste Otica B', 'TESTE: responda de forma curta e cordial como atendente da Otica B.', 'gemini', 'gemini-3.1-flash-lite', true, '1231e918-4526-415a-9972-36ac4854a2af', 0.30, false, false, 'balanced', false, 'primary')
ON CONFLICT (id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    instance_name = EXCLUDED.instance_name,
    name = EXCLUDED.name,
    system_prompt = EXCLUDED.system_prompt,
    provider = EXCLUDED.provider,
    model = EXCLUDED.model,
    is_active = EXCLUDED.is_active,
    created_by = EXCLUDED.created_by,
    temperature = EXCLUDED.temperature,
    handoff_enabled = EXCLUDED.handoff_enabled,
    unanswered_followup_enabled = EXCLUDED.unanswered_followup_enabled,
    personality_profile = EXCLUDED.personality_profile,
    rag_enabled = EXCLUDED.rag_enabled,
    agent_type = EXCLUDED.agent_type;

INSERT INTO agents.agent_messaging_connections (
  agent_id, connection_id, aces_id, is_active, created_by
)
VALUES
  ('62000000-0000-0000-0000-000000000001', '61000000-0000-0000-0000-000000000001', 1, true, '1231e918-4526-415a-9972-36ac4854a2af'),
  ('62000000-0000-0000-0000-000000000002', '61000000-0000-0000-0000-000000000002', 1, true, '1231e918-4526-415a-9972-36ac4854a2af')
ON CONFLICT (agent_id, connection_id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    is_active = true,
    created_by = EXCLUDED.created_by,
    updated_at = now();

-- Seis leads compartilhados entre as duas instancias e tres leads exclusivos.
INSERT INTO crm.leads (
  id, aces_id, name, contact_phone, email, status, instancia, owner_id,
  "Fonte", "Plataform", "Sistema", view, interaction_mode, notes
)
VALUES
  ('73000000-0000-4000-8000-000000000001', 1, 'Lead Compartilhado 01', '+55 11 99800-0001', 'lead01@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Mesmo lead em A e B'),
  ('73000000-0000-4000-8000-000000000002', 1, 'Lead Compartilhado 02', '+55 11 99800-0002', 'lead02@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Mesmo lead em A e B'),
  ('73000000-0000-4000-8000-000000000003', 1, 'Lead Compartilhado 03', '+55 11 99800-0003', 'lead03@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Mesmo lead em A e B'),
  ('73000000-0000-4000-8000-000000000004', 1, 'Lead Compartilhado 04', '+55 11 99800-0004', 'lead04@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Mesmo lead em A e B'),
  ('73000000-0000-4000-8000-000000000005', 1, 'Lead Compartilhado 05', '+55 11 99800-0005', 'lead05@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Mesmo lead em A e B'),
  ('73000000-0000-4000-8000-000000000006', 1, 'Lead Compartilhado 06', '+55 11 99800-0006', 'lead06@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Mesmo lead em A e B'),
  ('73000000-0000-4000-8000-000000000101', 1, 'Lead Exclusivo A', '+55 21 99700-0101', 'lead101@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Lead exclusivo da instancia A'),
  ('73000000-0000-4000-8000-000000000102', 1, 'Lead Exclusivo B', '+55 21 99700-0102', 'lead102@teste.local', 'Novo', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Lead exclusivo da instancia B'),
  ('73000000-0000-4000-8000-000000000103', 1, 'Lead Exclusivo A 2', '+55 31 99600-0103', 'lead103@teste.local', 'Novo', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af', 'seed-chat-demo', 'whatsapp', 'local-demo', true, 'ai', 'Lead exclusivo da instancia A')
ON CONFLICT (id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    name = EXCLUDED.name,
    contact_phone = EXCLUDED.contact_phone,
    email = EXCLUDED.email,
    status = EXCLUDED.status,
    instancia = EXCLUDED.instancia,
    owner_id = EXCLUDED.owner_id,
    "Fonte" = EXCLUDED."Fonte",
    "Plataform" = EXCLUDED."Plataform",
    "Sistema" = EXCLUDED."Sistema",
    view = true,
    interaction_mode = 'ai',
    notes = EXCLUDED.notes;

INSERT INTO crm.lead_instance_memberships (
  aces_id, lead_id, instance_name, source_agent_id, reason, is_active, revoked_at
)
SELECT 1,
  replace(item.lead_id::text, '63000000-0000-0000-0000-', '73000000-0000-4000-8000-')::uuid,
  item.instance_name, item.agent_id, 'seed-chat-demo', true, NULL
FROM (VALUES
  ('63000000-0000-0000-0000-000000000001'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000001'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000002'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000002'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000003'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000003'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000004'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000004'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000005'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000005'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000006'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000006'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000101'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid),
  ('63000000-0000-0000-0000-000000000102'::uuid, 'TESTE_OTICA_B', '62000000-0000-0000-0000-000000000002'::uuid),
  ('63000000-0000-0000-0000-000000000103'::uuid, 'TESTE_OTICA_A', '62000000-0000-0000-0000-000000000001'::uuid)
) AS item(lead_id, instance_name, agent_id)
ON CONFLICT (lead_id, instance_name) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    source_agent_id = EXCLUDED.source_agent_id,
    reason = EXCLUDED.reason,
    is_active = true,
    revoked_at = NULL,
    updated_at = now();

-- 12 conversas dos seis leads compartilhados + 3 conversas exclusivas.
INSERT INTO crm.customer_conversations (
  id, aces_id, lead_id, connection_id, interaction_mode, status,
  last_message_at, last_inbound_at, last_message_preview
)
VALUES
  ('74000000-0000-4000-8000-000000000001', 1, '73000000-0000-4000-8000-000000000001', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:01:00-03', '2026-09-18 10:00:00-03', 'Claro! Sou o agente de teste da Otica A.'),
  ('74000000-0000-4000-8000-000000000002', 1, '73000000-0000-4000-8000-000000000001', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:03:00-03', '2026-09-18 10:02:00-03', 'Perfeito! Este e o atendimento de teste da Otica B.'),
  ('74000000-0000-4000-8000-000000000003', 1, '73000000-0000-4000-8000-000000000002', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:05:00-03', '2026-09-18 10:04:00-03', 'Claro! Sou o agente de teste da Otica A.'),
  ('74000000-0000-4000-8000-000000000004', 1, '73000000-0000-4000-8000-000000000002', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:07:00-03', '2026-09-18 10:06:00-03', 'Perfeito! Este e o atendimento de teste da Otica B.'),
  ('74000000-0000-4000-8000-000000000005', 1, '73000000-0000-4000-8000-000000000003', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:09:00-03', '2026-09-18 10:08:00-03', 'Claro! Sou o agente de teste da Otica A.'),
  ('74000000-0000-4000-8000-000000000006', 1, '73000000-0000-4000-8000-000000000003', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:11:00-03', '2026-09-18 10:10:00-03', 'Perfeito! Este e o atendimento de teste da Otica B.'),
  ('74000000-0000-4000-8000-000000000007', 1, '73000000-0000-4000-8000-000000000004', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:13:00-03', '2026-09-18 10:12:00-03', 'Claro! Sou o agente de teste da Otica A.'),
  ('74000000-0000-4000-8000-000000000008', 1, '73000000-0000-4000-8000-000000000004', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:15:00-03', '2026-09-18 10:14:00-03', 'Perfeito! Este e o atendimento de teste da Otica B.'),
  ('74000000-0000-4000-8000-000000000009', 1, '73000000-0000-4000-8000-000000000005', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:17:00-03', '2026-09-18 10:16:00-03', 'Claro! Sou o agente de teste da Otica A.'),
  ('74000000-0000-4000-8000-000000000010', 1, '73000000-0000-4000-8000-000000000005', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:19:00-03', '2026-09-18 10:18:00-03', 'Perfeito! Este e o atendimento de teste da Otica B.'),
  ('74000000-0000-4000-8000-000000000011', 1, '73000000-0000-4000-8000-000000000006', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:21:00-03', '2026-09-18 10:20:00-03', 'Claro! Sou o agente de teste da Otica A.'),
  ('74000000-0000-4000-8000-000000000012', 1, '73000000-0000-4000-8000-000000000006', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:23:00-03', '2026-09-18 10:22:00-03', 'Perfeito! Este e o atendimento de teste da Otica B.'),
  ('74000000-0000-4000-8000-000000000101', 1, '73000000-0000-4000-8000-000000000101', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:25:00-03', '2026-09-18 10:24:00-03', 'Atendimento de teste exclusivo da Otica A.'),
  ('74000000-0000-4000-8000-000000000102', 1, '73000000-0000-4000-8000-000000000102', '61000000-0000-0000-0000-000000000002', 'ai', 'active', '2026-09-18 10:27:00-03', '2026-09-18 10:26:00-03', 'Atendimento de teste exclusivo da Otica B.'),
  ('74000000-0000-4000-8000-000000000103', 1, '73000000-0000-4000-8000-000000000103', '61000000-0000-0000-0000-000000000001', 'ai', 'active', '2026-09-18 10:29:00-03', '2026-09-18 10:28:00-03', 'Segundo atendimento exclusivo da Otica A.')
ON CONFLICT (id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    lead_id = EXCLUDED.lead_id,
    connection_id = EXCLUDED.connection_id,
    interaction_mode = EXCLUDED.interaction_mode,
    status = EXCLUDED.status,
    last_message_at = EXCLUDED.last_message_at,
    last_inbound_at = EXCLUDED.last_inbound_at,
    last_message_preview = EXCLUDED.last_message_preview;

-- Duas mensagens por conversa para a tela já abrir com histórico visível.
WITH demo_messages (
  id, lead_id, content, direction, conversation_id, instance, created_by,
  sent_at, source_type, provider, provider_message_id, provider_status,
  provider_payload_summary, sender_agent_id, customer_conversation_id
) AS (VALUES
  ('65000000-0000-0000-0000-000000000001'::uuid, '63000000-0000-0000-0000-000000000001'::uuid, 'Oi, preciso de ajuda para escolher um oculos.', 'inbound', 'demo-a-001', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:00:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-001-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000001'::uuid),
  ('65000000-0000-0000-0000-000000000002'::uuid, '63000000-0000-0000-0000-000000000001'::uuid, 'Claro! Sou o agente de teste da Otica A. Como posso ajudar?', 'outbound', 'demo-a-001', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:01:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-001-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000001'::uuid),
  ('65000000-0000-0000-0000-000000000003'::uuid, '63000000-0000-0000-0000-000000000001'::uuid, 'Oi, vim pela outra loja e quero comparar modelos.', 'inbound', 'demo-b-001', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:02:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-001-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000002'::uuid),
  ('65000000-0000-0000-0000-000000000004'::uuid, '63000000-0000-0000-0000-000000000001'::uuid, 'Perfeito! Este e o atendimento de teste da Otica B.', 'outbound', 'demo-b-001', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:03:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-001-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000002'::uuid),
  ('65000000-0000-0000-0000-000000000005'::uuid, '63000000-0000-0000-0000-000000000002'::uuid, 'Oi, quero conhecer as opcoes de armação.', 'inbound', 'demo-a-002', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:04:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-002-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000003'::uuid),
  ('65000000-0000-0000-0000-000000000006'::uuid, '63000000-0000-0000-0000-000000000002'::uuid, 'Claro! Sou o agente de teste da Otica A. Como posso ajudar?', 'outbound', 'demo-a-002', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:05:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-002-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000003'::uuid),
  ('65000000-0000-0000-0000-000000000007'::uuid, '63000000-0000-0000-0000-000000000002'::uuid, 'Vocês tem modelos para uso diario?', 'inbound', 'demo-b-002', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:06:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-002-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000004'::uuid),
  ('65000000-0000-0000-0000-000000000008'::uuid, '63000000-0000-0000-0000-000000000002'::uuid, 'Perfeito! Este e o atendimento de teste da Otica B.', 'outbound', 'demo-b-002', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:07:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-002-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000004'::uuid),
  ('65000000-0000-0000-0000-000000000009'::uuid, '63000000-0000-0000-0000-000000000003'::uuid, 'Oi, tenho uma duvida sobre lentes.', 'inbound', 'demo-a-003', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:08:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-003-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000005'::uuid),
  ('65000000-0000-0000-0000-000000000010'::uuid, '63000000-0000-0000-0000-000000000003'::uuid, 'Claro! Sou o agente de teste da Otica A. Posso explicar.', 'outbound', 'demo-a-003', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:09:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-003-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000005'::uuid),
  ('65000000-0000-0000-0000-000000000011'::uuid, '63000000-0000-0000-0000-000000000003'::uuid, 'Tambem quero ver opcoes da outra instancia.', 'inbound', 'demo-b-003', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:10:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-003-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000006'::uuid),
  ('65000000-0000-0000-0000-000000000012'::uuid, '63000000-0000-0000-0000-000000000003'::uuid, 'Perfeito! Este e o atendimento de teste da Otica B.', 'outbound', 'demo-b-003', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:11:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-003-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000006'::uuid),
  ('65000000-0000-0000-0000-000000000013'::uuid, '63000000-0000-0000-0000-000000000004'::uuid, 'Boa tarde, quero testar o atendimento.', 'inbound', 'demo-a-004', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:12:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-004-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000007'::uuid),
  ('65000000-0000-0000-0000-000000000014'::uuid, '63000000-0000-0000-0000-000000000004'::uuid, 'Ola! Sou o agente de teste da Otica A.', 'outbound', 'demo-a-004', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:13:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-004-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000007'::uuid),
  ('65000000-0000-0000-0000-000000000015'::uuid, '63000000-0000-0000-0000-000000000004'::uuid, 'Vim ver como funciona na Otica B.', 'inbound', 'demo-b-004', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:14:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-004-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000008'::uuid),
  ('65000000-0000-0000-0000-000000000016'::uuid, '63000000-0000-0000-0000-000000000004'::uuid, 'Perfeito! Este e o atendimento de teste da Otica B.', 'outbound', 'demo-b-004', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:15:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-004-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000008'::uuid),
  ('65000000-0000-0000-0000-000000000017'::uuid, '63000000-0000-0000-0000-000000000005'::uuid, 'Quero comparar os precos de teste.', 'inbound', 'demo-a-005', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:16:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-005-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000009'::uuid),
  ('65000000-0000-0000-0000-000000000018'::uuid, '63000000-0000-0000-0000-000000000005'::uuid, 'Claro! Sou o agente de teste da Otica A.', 'outbound', 'demo-a-005', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:17:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-005-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000009'::uuid),
  ('65000000-0000-0000-0000-000000000019'::uuid, '63000000-0000-0000-0000-000000000005'::uuid, 'Tambem vou olhar a outra loja.', 'inbound', 'demo-b-005', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:18:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-005-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000010'::uuid),
  ('65000000-0000-0000-0000-000000000020'::uuid, '63000000-0000-0000-0000-000000000005'::uuid, 'Perfeito! Este e o atendimento de teste da Otica B.', 'outbound', 'demo-b-005', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:19:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-005-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000010'::uuid),
  ('65000000-0000-0000-0000-000000000021'::uuid, '63000000-0000-0000-0000-000000000006'::uuid, 'Oi, este e o meu sexto teste de conversa.', 'inbound', 'demo-a-006', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:20:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-006-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000011'::uuid),
  ('65000000-0000-0000-0000-000000000022'::uuid, '63000000-0000-0000-0000-000000000006'::uuid, 'Ola! Sou o agente de teste da Otica A.', 'outbound', 'demo-a-006', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:21:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-006-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000011'::uuid),
  ('65000000-0000-0000-0000-000000000023'::uuid, '63000000-0000-0000-0000-000000000006'::uuid, 'Agora quero conferir a Otica B.', 'inbound', 'demo-b-006', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:22:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-006-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000012'::uuid),
  ('65000000-0000-0000-0000-000000000024'::uuid, '63000000-0000-0000-0000-000000000006'::uuid, 'Perfeito! Este e o atendimento de teste da Otica B.', 'outbound', 'demo-b-006', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:23:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-006-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000012'::uuid),
  ('65000000-0000-0000-0000-000000000025'::uuid, '63000000-0000-0000-0000-000000000101'::uuid, 'Oi, quero fazer um teste na instancia A.', 'inbound', 'demo-a-101', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:24:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-101-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000101'::uuid),
  ('65000000-0000-0000-0000-000000000026'::uuid, '63000000-0000-0000-0000-000000000101'::uuid, 'Atendimento de teste exclusivo da Otica A.', 'outbound', 'demo-a-101', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:25:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-101-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000101'::uuid),
  ('65000000-0000-0000-0000-000000000027'::uuid, '63000000-0000-0000-0000-000000000102'::uuid, 'Ola, quero conversar com a instancia B.', 'inbound', 'demo-b-102', 'TESTE_OTICA_B', NULL::uuid, '2026-09-18 10:26:00-03'::timestamptz, 'lead', 'evolution', 'demo-b-102-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000102'::uuid),
  ('65000000-0000-0000-0000-000000000028'::uuid, '63000000-0000-0000-0000-000000000102'::uuid, 'Atendimento de teste exclusivo da Otica B.', 'outbound', 'demo-b-102', 'TESTE_OTICA_B', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:27:00-03'::timestamptz, 'ai', 'evolution', 'demo-b-102-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000002'::uuid, '64000000-0000-0000-0000-000000000102'::uuid),
  ('65000000-0000-0000-0000-000000000029'::uuid, '63000000-0000-0000-0000-000000000103'::uuid, 'Mais um atendimento de teste para a Otica A.', 'inbound', 'demo-a-103', 'TESTE_OTICA_A', NULL::uuid, '2026-09-18 10:28:00-03'::timestamptz, 'lead', 'evolution', 'demo-a-103-in', 'received', '{"seed":"chat-demo","direction":"inbound"}'::jsonb, NULL::uuid, '64000000-0000-0000-0000-000000000103'::uuid),
  ('65000000-0000-0000-0000-000000000030'::uuid, '63000000-0000-0000-0000-000000000103'::uuid, 'Segundo atendimento exclusivo da Otica A.', 'outbound', 'demo-a-103', 'TESTE_OTICA_A', '1231e918-4526-415a-9972-36ac4854a2af'::uuid, '2026-09-18 10:29:00-03'::timestamptz, 'ai', 'evolution', 'demo-a-103-out', 'sent', '{"seed":"chat-demo","direction":"outbound"}'::jsonb, '62000000-0000-0000-0000-000000000001'::uuid, '64000000-0000-0000-0000-000000000103'::uuid)
)
INSERT INTO crm.message_history (
  id, lead_id, aces_id, content, direction, conversation_id, instance,
  created_by, sent_at, source_type, provider, provider_message_id,
  provider_status, provider_payload_summary, sender_agent_id,
  customer_conversation_id
)
SELECT
  id,
  replace(lead_id::text, '63000000-0000-0000-0000-', '73000000-0000-4000-8000-')::uuid,
  1, content, direction, conversation_id, instance, created_by,
  sent_at, source_type, provider, provider_message_id, provider_status,
  provider_payload_summary, sender_agent_id,
  replace(customer_conversation_id::text, '64000000-0000-0000-0000-', '74000000-0000-4000-8000-')::uuid
FROM demo_messages
ON CONFLICT (id) DO UPDATE
SET content = EXCLUDED.content,
    direction = EXCLUDED.direction,
    conversation_id = EXCLUDED.conversation_id,
    instance = EXCLUDED.instance,
    created_by = EXCLUDED.created_by,
    sent_at = EXCLUDED.sent_at,
    source_type = EXCLUDED.source_type,
    provider = EXCLUDED.provider,
    provider_message_id = EXCLUDED.provider_message_id,
    provider_status = EXCLUDED.provider_status,
    provider_payload_summary = EXCLUDED.provider_payload_summary,
    sender_agent_id = EXCLUDED.sender_agent_id,
    customer_conversation_id = EXCLUDED.customer_conversation_id;

-- O endpoint HTTP valida UUIDs no formato RFC 4122. Os IDs legados acima sao
-- mantidos apenas como chaves internas do fixture e sao trocados por IDs v4
-- antes do commit, sem perder as mensagens.
CREATE TEMP TABLE demo_conversation_id_map (
  old_id uuid PRIMARY KEY,
  new_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO demo_conversation_id_map (old_id, new_id)
SELECT old_id, new_id
FROM (VALUES
  ('64000000-0000-0000-0000-000000000001'::uuid, '74000000-0000-4000-8000-000000000001'::uuid),
  ('64000000-0000-0000-0000-000000000002'::uuid, '74000000-0000-4000-8000-000000000002'::uuid),
  ('64000000-0000-0000-0000-000000000003'::uuid, '74000000-0000-4000-8000-000000000003'::uuid),
  ('64000000-0000-0000-0000-000000000004'::uuid, '74000000-0000-4000-8000-000000000004'::uuid),
  ('64000000-0000-0000-0000-000000000005'::uuid, '74000000-0000-4000-8000-000000000005'::uuid),
  ('64000000-0000-0000-0000-000000000006'::uuid, '74000000-0000-4000-8000-000000000006'::uuid),
  ('64000000-0000-0000-0000-000000000007'::uuid, '74000000-0000-4000-8000-000000000007'::uuid),
  ('64000000-0000-0000-0000-000000000008'::uuid, '74000000-0000-4000-8000-000000000008'::uuid),
  ('64000000-0000-0000-0000-000000000009'::uuid, '74000000-0000-4000-8000-000000000009'::uuid),
  ('64000000-0000-0000-0000-000000000010'::uuid, '74000000-0000-4000-8000-000000000010'::uuid),
  ('64000000-0000-0000-0000-000000000011'::uuid, '74000000-0000-4000-8000-000000000011'::uuid),
  ('64000000-0000-0000-0000-000000000012'::uuid, '74000000-0000-4000-8000-000000000012'::uuid),
  ('64000000-0000-0000-0000-000000000101'::uuid, '74000000-0000-4000-8000-000000000101'::uuid),
  ('64000000-0000-0000-0000-000000000102'::uuid, '74000000-0000-4000-8000-000000000102'::uuid),
  ('64000000-0000-0000-0000-000000000103'::uuid, '74000000-0000-4000-8000-000000000103'::uuid)
) AS ids(old_id, new_id);

INSERT INTO crm.customer_conversations (
  id, aces_id, lead_id, connection_id, interaction_mode, status,
  last_message_at, last_inbound_at, last_message_preview
)
SELECT map.new_id, conversation.aces_id, conversation.lead_id,
  conversation.connection_id, conversation.interaction_mode, conversation.status,
  conversation.last_message_at, conversation.last_inbound_at,
  conversation.last_message_preview
FROM demo_conversation_id_map map
JOIN crm.customer_conversations conversation ON conversation.id = map.old_id
ON CONFLICT (id) DO UPDATE
SET aces_id = EXCLUDED.aces_id,
    lead_id = EXCLUDED.lead_id,
    connection_id = EXCLUDED.connection_id,
    interaction_mode = EXCLUDED.interaction_mode,
    status = EXCLUDED.status,
    last_message_at = EXCLUDED.last_message_at,
    last_inbound_at = EXCLUDED.last_inbound_at,
    last_message_preview = EXCLUDED.last_message_preview;

UPDATE crm.message_history message
SET customer_conversation_id = map.new_id
FROM demo_conversation_id_map map
WHERE message.customer_conversation_id = map.old_id;

DELETE FROM crm.customer_conversations conversation
USING demo_conversation_id_map map
WHERE conversation.id = map.old_id;

-- Garante que os resumos e a ordenacao da lista estejam coerentes mesmo apos
-- uma segunda execucao do fixture.
WITH summary AS (
  SELECT
    customer_conversation_id,
    max(sent_at) AS last_message_at,
    max(sent_at) FILTER (WHERE lower(direction) IN ('inbound', 'in')) AS last_inbound_at,
    (array_agg(left(content, 240) ORDER BY sent_at DESC, id DESC))[1] AS last_message_preview
  FROM crm.message_history
  WHERE id >= '65000000-0000-0000-0000-000000000001'::uuid
    AND id <= '65000000-0000-0000-0000-000000000030'::uuid
  GROUP BY customer_conversation_id
)
UPDATE crm.customer_conversations conversation
SET last_message_at = summary.last_message_at,
    last_inbound_at = summary.last_inbound_at,
    last_message_preview = summary.last_message_preview,
    updated_at = now()
FROM summary
WHERE conversation.id = summary.customer_conversation_id;

WITH summary AS (
  SELECT
    lead_id,
    max(sent_at) AS last_message_at,
    max(sent_at) FILTER (WHERE lower(direction) IN ('inbound', 'in')) AS last_lead_inbound_at
  FROM crm.message_history
  WHERE id >= '65000000-0000-0000-0000-000000000001'::uuid
    AND id <= '65000000-0000-0000-0000-000000000030'::uuid
  GROUP BY lead_id
)
UPDATE crm.leads lead
SET last_message_at = summary.last_message_at,
    last_lead_inbound_at = summary.last_lead_inbound_at,
    updated_at = now()
FROM summary
WHERE lead.id = summary.lead_id;

COMMIT;
