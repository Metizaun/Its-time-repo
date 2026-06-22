-- Separa o modelo dos agentes de atendimento do modelo interno dos workers.
-- crm.ai_agents.model representa a resposta ao lead, nao a analise operacional.

ALTER TABLE crm.ai_agents
  ALTER COLUMN model SET DEFAULT 'gemini-2.5-flash';

UPDATE crm.ai_agents
SET model = 'gemini-2.5-flash'
WHERE model = 'gemini-3.1-flash-lite';

COMMENT ON COLUMN crm.ai_agents.model IS
  'Modelo usado pelo agente de atendimento para responder ao lead. Modelos de workers internos devem usar constantes/envs proprias.';
