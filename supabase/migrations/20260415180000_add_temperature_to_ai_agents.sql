-- Adiciona a coluna temperature à tabela crm.ai_agents
-- Controlada pelo Slider de "Estilo de Abordagem" do frontend.
-- Faixa segura: 0.10 (Cirúrgico/Frio) até 0.80 (Entusiasta/Extrovertido).

ALTER TABLE crm.ai_agents
  ADD COLUMN IF NOT EXISTS temperature numeric(3,2) NOT NULL DEFAULT 0.30
  CONSTRAINT ai_agents_temperature_range CHECK (temperature >= 0.10 AND temperature <= 0.80);
