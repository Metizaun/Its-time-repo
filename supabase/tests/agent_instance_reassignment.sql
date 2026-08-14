BEGIN;

SELECT plan(31);

SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'crm.instance'::regclass AND conname = 'instance_account_name_unique'), 'instancia possui chave composta por conta');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'agents.ai_agents'::regclass AND conname = 'ai_agents_account_instance_fkey'), 'agente possui FK composta para instancia da conta');
SELECT ok(NOT has_function_privilege('anon', 'crm.service_reassign_agent_instance(uuid,integer,text,text,boolean)', 'EXECUTE'), 'anon nao executa troca de instancia');
SELECT ok(NOT has_function_privilege('authenticated', 'crm.service_reassign_agent_instance(uuid,integer,text,text,boolean)', 'EXECUTE'), 'authenticated nao executa troca de instancia');
SELECT ok(has_function_privilege('service_role', 'crm.service_reassign_agent_instance(uuid,integer,text,text,boolean)', 'EXECUTE'), 'service_role executa troca de instancia');

INSERT INTO crm.accounts (id, name, status) VALUES
  (9801, 'Agent Move Test', 'active'),
  (9802, 'Foreign Agent Move Test', 'active');

INSERT INTO crm.instance (aces_id, instancia) VALUES
  (9801, 'move-a-origin'), (9801, 'move-a-target'),
  (9801, 'move-b-origin'), (9801, 'move-b-target'),
  (9801, 'move-c-origin'), (9801, 'move-c-target'),
  (9801, 'move-d-origin'), (9801, 'move-d-target'),
  (9801, 'move-e-origin'), (9801, 'move-e-target'),
  (9801, 'move-f-origin'),
  (9802, 'move-foreign-target');

INSERT INTO agents.ai_agents (
  id, aces_id, instance_name, name, system_prompt, model, is_active, agent_type
) VALUES
  ('98100000-0000-0000-0000-000000000001', 9801, 'move-a-origin', 'Move A', 'Prompt', 'gemini-2.5-flash', true, 'primary'),
  ('98100000-0000-0000-0000-000000000002', 9801, 'move-b-origin', 'Move B', 'Prompt', 'gemini-2.5-flash', true, 'primary'),
  ('98100000-0000-0000-0000-000000000003', 9801, 'move-c-origin', 'Move C', 'Prompt', 'gemini-2.5-flash', false, 'primary'),
  ('98100000-0000-0000-0000-000000000004', 9801, 'move-d-origin', 'Move D', 'Prompt', 'gemini-2.5-flash', true, 'primary'),
  ('98100000-0000-0000-0000-000000000005', 9801, 'move-e-origin', 'Move E', 'Prompt', 'gemini-2.5-flash', true, 'primary'),
  ('98100000-0000-0000-0000-000000000006', 9801, 'move-e-target', 'Occupied', 'Prompt', 'gemini-2.5-flash', true, 'primary'),
  ('98100000-0000-0000-0000-000000000007', 9801, 'move-f-origin', 'Move F', 'Prompt', 'gemini-2.5-flash', true, 'primary');

INSERT INTO crm.leads (id, aces_id, name, contact_phone, instancia, interaction_mode) VALUES
  ('98200000-0000-0000-0000-000000000001', 9801, 'Lead A', '559800000001', 'move-a-origin', 'ai'),
  ('98200000-0000-0000-0000-000000000002', 9801, 'Lead B', '559800000002', 'move-b-origin', 'ai'),
  ('98200000-0000-0000-0000-000000000003', 9801, 'Lead C', '559800000003', 'move-c-origin', 'ai');

CREATE TEMP TABLE move_results (key text PRIMARY KEY, result jsonb);

INSERT INTO move_results VALUES (
  'decision',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000001', 9801, 'move-a-target')
);
SELECT is((SELECT result->>'code' FROM move_results WHERE key = 'decision'), 'AGENT_INSTANCE_CHANGE_REQUIRES_DECISION', 'agente ativo com lead exige decisao');
SELECT is((SELECT (result->>'affectedLeadCount')::integer FROM move_results WHERE key = 'decision'), 1, 'conflito informa quantidade afetada');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000001'), 'move-a-origin', 'conflito nao move o agente');

INSERT INTO move_results VALUES (
  'humanize',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000001', 9801, 'move-a-target', 'humanize')
);
SELECT is((SELECT result->>'success' FROM move_results WHERE key = 'humanize'), 'true', 'politica humanize conclui');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000001'), 'move-a-target', 'humanize move o agente');
SELECT is((SELECT interaction_mode FROM crm.leads WHERE id = '98200000-0000-0000-0000-000000000001'), 'human', 'humanize transfere lead para humano');
SELECT is((SELECT is_active FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000001'), true, 'humanize mantem agente ativo');

INSERT INTO move_results VALUES (
  'deactivate',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000002', 9801, 'move-b-target', 'deactivate')
);
SELECT is((SELECT result->>'success' FROM move_results WHERE key = 'deactivate'), 'true', 'politica deactivate conclui');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000002'), 'move-b-target', 'deactivate move o agente');
SELECT is((SELECT is_active FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000002'), false, 'deactivate deixa agente inativo');
SELECT is((SELECT interaction_mode FROM crm.leads WHERE id = '98200000-0000-0000-0000-000000000002'), 'ai', 'deactivate mantem lead antigo em IA');

INSERT INTO move_results VALUES (
  'inactive',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000003', 9801, 'move-c-target')
);
SELECT is((SELECT result->>'success' FROM move_results WHERE key = 'inactive'), 'true', 'agente inativo move sem decisao');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000003'), 'move-c-target', 'agente inativo persiste no destino');
SELECT is((SELECT is_active FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000003'), false, 'troca preserva agente inativo');
SELECT is((SELECT interaction_mode FROM crm.leads WHERE id = '98200000-0000-0000-0000-000000000003'), 'ai', 'troca inativa preserva lead em IA');

INSERT INTO move_results VALUES (
  'no-leads',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000004', 9801, 'move-d-target')
);
SELECT is((SELECT result->>'success' FROM move_results WHERE key = 'no-leads'), 'true', 'agente ativo sem leads move diretamente');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000004'), 'move-d-target', 'troca sem leads persiste no destino');
SELECT is((SELECT is_active FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000004'), true, 'troca sem leads preserva agente ativo');

INSERT INTO move_results VALUES (
  'occupied',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000005', 9801, 'move-e-target')
);
SELECT is((SELECT result->>'code' FROM move_results WHERE key = 'occupied'), 'AGENT_INSTANCE_OCCUPIED', 'destino ocupado retorna codigo estavel');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000005'), 'move-e-origin', 'destino ocupado nao move agente');

INSERT INTO move_results VALUES (
  'foreign',
  crm.service_reassign_agent_instance('98100000-0000-0000-0000-000000000007', 9801, 'move-foreign-target')
);
SELECT is((SELECT result->>'code' FROM move_results WHERE key = 'foreign'), 'AGENT_INSTANCE_OUTSIDE_ACCOUNT', 'destino de outra conta retorna codigo estavel');
SELECT is((SELECT instance_name FROM agents.ai_agents WHERE id = '98100000-0000-0000-0000-000000000007'), 'move-f-origin', 'tentativa entre contas nao move agente');

SELECT ok(NOT has_function_privilege('authenticated', 'crm.start_or_refresh_enrollment(uuid,uuid,jsonb)', 'EXECUTE'), 'authenticated nao chama enrollment interno');
SELECT ok(has_function_privilege('service_role', 'crm.start_or_refresh_enrollment(uuid,uuid,jsonb)', 'EXECUTE'), 'service_role chama enrollment interno');
SELECT ok(pg_get_functiondef('crm.match_knowledge_embeddings(integer,uuid,extensions.vector,double precision,integer)'::regprocedure) LIKE '%OPERATOR(extensions.<=>)%', 'RAG usa operador vetorial qualificado');
SELECT is((SELECT count(*)::integer FROM costs.admin_staff AS s JOIN auth.users AS u ON u.id = s.auth_user_id WHERE lower(u.email) = 'mattsyk1@gmail.com'), 1, 'staff local resolve somente o UUID do email autorizado');

SELECT * FROM finish();
ROLLBACK;
