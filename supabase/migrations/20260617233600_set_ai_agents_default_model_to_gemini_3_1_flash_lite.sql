-- Mantem o subsistema crm.ai_agents alinhado ao Gemini 3.1 Flash Lite.
-- Nao altera o fluxo genérico de agents do restante do app.

ALTER TABLE crm.ai_agents
  ALTER COLUMN model SET DEFAULT 'gemini-3.1-flash-lite';

UPDATE crm.ai_agents
SET model = 'gemini-3.1-flash-lite'
WHERE model = 'gemini-2.5-flash';
