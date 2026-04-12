-- ============================================================
-- Schema SQL para SDR Agent (Multi-tenant)
-- Execute este script no Supabase SQL Editor
-- ============================================================

-- Extensões necessárias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schema CRM
CREATE SCHEMA IF NOT EXISTS crm;

-- ============================================================
-- TABELA: agents
-- Armazena configurações de cada agente criado
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.agents (
  -- Identificação
  agent_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  
  -- Configurações de integração
  instance_name TEXT NOT NULL UNIQUE, -- Nome da instância Evolution (único)
  aces_id INTEGER NOT NULL,
  
  -- Configurações do agente (editáveis)
  system_message TEXT NOT NULL,
  user_message_template TEXT NOT NULL,
  buffer_wait_ms INTEGER DEFAULT 15000,
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_agents_user_id ON crm.agents(user_id);
CREATE INDEX idx_agents_instance_name ON crm.agents(instance_name);
CREATE INDEX idx_agents_is_active ON crm.agents(is_active);

-- ============================================================
-- TABELA: leads
-- Armazena informações dos leads/contatos
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.leads (
  -- Identificação
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL REFERENCES crm.agents(agent_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  
  -- Informações do lead
  name TEXT,
  contact_phone TEXT NOT NULL,
  aces_id INTEGER NOT NULL,
  
  -- Campos customizáveis
  Voucher TEXT,
  receita TEXT,
  Fonte TEXT DEFAULT 'Whatsapp',
  instancia TEXT,
  
  -- Metadata
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraint: um telefone por agente
  UNIQUE(agent_id, contact_phone, aces_id)
);

-- Índices para performance
CREATE INDEX idx_leads_agent_id ON crm.leads(agent_id);
CREATE INDEX idx_leads_user_id ON crm.leads(user_id);
CREATE INDEX idx_leads_contact_phone ON crm.leads(contact_phone);
CREATE INDEX idx_leads_aces_id ON crm.leads(aces_id);
CREATE INDEX idx_leads_last_message_at ON crm.leads(last_message_at DESC);

-- ============================================================
-- TABELA: message_history
-- Armazena histórico completo de mensagens
-- ============================================================
CREATE TABLE IF NOT EXISTS crm.message_history (
  -- Identificação
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id TEXT NOT NULL REFERENCES crm.agents(agent_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  lead_id UUID REFERENCES crm.leads(id) ON DELETE SET NULL,
  
  -- Informações da mensagem
  conversation_id TEXT NOT NULL,
  content TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  
  -- Metadata
  instance TEXT,
  aces_id INTEGER,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX idx_message_history_agent_id ON crm.message_history(agent_id);
CREATE INDEX idx_message_history_lead_id ON crm.message_history(lead_id);
CREATE INDEX idx_message_history_conversation_id ON crm.message_history(conversation_id);
CREATE INDEX idx_message_history_sent_at ON crm.message_history(sent_at DESC);
CREATE INDEX idx_message_history_direction ON crm.message_history(direction);

-- ============================================================
-- FUNÇÕES: Atualização automática de updated_at
-- ============================================================
CREATE OR REPLACE FUNCTION crm.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para atualizar updated_at
CREATE TRIGGER update_agents_updated_at
  BEFORE UPDATE ON crm.agents
  FOR EACH ROW
  EXECUTE FUNCTION crm.update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON crm.leads
  FOR EACH ROW
  EXECUTE FUNCTION crm.update_updated_at_column();

-- ============================================================
-- RLS (Row Level Security) - Isolamento por usuário
-- ============================================================

-- Habilita RLS
ALTER TABLE crm.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.message_history ENABLE ROW LEVEL SECURITY;

-- Políticas para agents
CREATE POLICY "Usuários podem ver apenas seus próprios agentes"
  ON crm.agents FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Usuários podem criar seus próprios agentes"
  ON crm.agents FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Usuários podem atualizar seus próprios agentes"
  ON crm.agents FOR UPDATE
  USING (auth.uid()::text = user_id);

CREATE POLICY "Usuários podem deletar seus próprios agentes"
  ON crm.agents FOR DELETE
  USING (auth.uid()::text = user_id);

-- Políticas para leads
CREATE POLICY "Usuários podem ver apenas leads de seus agentes"
  ON crm.leads FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Sistema pode criar leads"
  ON crm.leads FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Sistema pode atualizar leads"
  ON crm.leads FOR UPDATE
  USING (true);

-- Políticas para message_history
CREATE POLICY "Usuários podem ver apenas mensagens de seus agentes"
  ON crm.message_history FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY "Sistema pode inserir mensagens"
  ON crm.message_history FOR INSERT
  WITH CHECK (true);

-- ============================================================
-- VIEWS: Visões úteis para analytics
-- ============================================================

-- View: Estatísticas por agente
CREATE OR REPLACE VIEW crm.agent_stats AS
SELECT 
  a.agent_id,
  a.agent_name,
  a.is_active,
  COUNT(DISTINCT l.id) as total_leads,
  COUNT(DISTINCT CASE WHEN l.last_message_at > NOW() - INTERVAL '24 hours' THEN l.id END) as active_leads_24h,
  COUNT(DISTINCT CASE WHEN l.last_message_at > NOW() - INTERVAL '7 days' THEN l.id END) as active_leads_7d,
  COUNT(mh.id) as total_messages,
  COUNT(CASE WHEN mh.direction = 'inbound' THEN 1 END) as inbound_messages,
  COUNT(CASE WHEN mh.direction = 'outbound' THEN 1 END) as outbound_messages
FROM crm.agents a
LEFT JOIN crm.leads l ON a.agent_id = l.agent_id
LEFT JOIN crm.message_history mh ON a.agent_id = mh.agent_id
GROUP BY a.agent_id, a.agent_name, a.is_active;

-- View: Últimas conversas por agente
CREATE OR REPLACE VIEW crm.recent_conversations AS
SELECT 
  l.agent_id,
  l.id as lead_id,
  l.name as lead_name,
  l.contact_phone,
  l.last_message_at,
  (
    SELECT content 
    FROM crm.message_history 
    WHERE lead_id = l.id 
    ORDER BY sent_at DESC 
    LIMIT 1
  ) as last_message_content,
  (
    SELECT direction 
    FROM crm.message_history 
    WHERE lead_id = l.id 
    ORDER BY sent_at DESC 
    LIMIT 1
  ) as last_message_direction
FROM crm.leads l
WHERE l.last_message_at IS NOT NULL
ORDER BY l.last_message_at DESC;

-- ============================================================
-- DADOS DE EXEMPLO (opcional - remover em produção)
-- ============================================================

-- Exemplo de agente (descomente para usar)
/*
INSERT INTO crm.agents (
  agent_id,
  user_id,
  agent_name,
  instance_name,
  aces_id,
  system_message,
  user_message_template
) VALUES (
  'agent_example_001',
  'user_123',
  'Agente Bento - Ótica',
  'instance_bento_001',
  1,
  'Você é Bento, consultor virtual especializado em ótica...',
  'Contexto do lead:\n- Nome: {leadName}\n\nMensagens: {allMessages}'
);
*/

-- ============================================================
-- COMENTÁRIOS NAS TABELAS
-- ============================================================

COMMENT ON TABLE crm.agents IS 'Configurações de agentes SDR multi-tenant';
COMMENT ON TABLE crm.leads IS 'Leads/contatos gerenciados pelos agentes';
COMMENT ON TABLE crm.message_history IS 'Histórico completo de mensagens (memória)';

COMMENT ON COLUMN crm.agents.agent_id IS 'ID único do agente (gerado automaticamente)';
COMMENT ON COLUMN crm.agents.instance_name IS 'Nome da instância Evolution vinculada (único)';
COMMENT ON COLUMN crm.agents.buffer_wait_ms IS 'Tempo de espera do buffer em milissegundos';

COMMENT ON COLUMN crm.leads.agent_id IS 'Referência ao agente responsável';
COMMENT ON COLUMN crm.leads.contact_phone IS 'Telefone do lead (sem @s.whatsapp.net)';
COMMENT ON COLUMN crm.leads.last_message_at IS 'Timestamp da última mensagem recebida';

COMMENT ON COLUMN crm.message_history.direction IS 'Direção da mensagem: inbound (recebida) ou outbound (enviada)';
COMMENT ON COLUMN crm.message_history.conversation_id IS 'ID da conversa no WhatsApp';
