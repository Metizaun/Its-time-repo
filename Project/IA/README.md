# SDR Agent - Sistema Multi-tenant com Gemini

Sistema de agentes SDR (Sales Development Representative) totalmente backend, replicável e multi-tenant, usando Gemini 2.0 Flash Thinking.

## 📋 Características

- ✅ **Backend-only**: Sem interface visual integrada
- ✅ **Multi-tenant**: Múltiplos agentes por usuário
- ✅ **Replicável**: Fácil duplicação de agentes
- ✅ **Gemini-only**: Usa apenas modelos Gemini (sem OpenAI)
- ✅ **Isolamento**: Dados completamente isolados por agente/usuário
- ✅ **Buffer inteligente**: Agrupa mensagens rápidas antes de processar
- ✅ **Memória persistente**: Histórico de conversas no PostgreSQL
- ✅ **Suporte multimodal**: Texto, áudio e imagem

## 🏗️ Arquitetura

```
┌─────────────────┐
│  Evolution API  │ (WhatsApp)
└────────┬────────┘
         │ webhook
         ▼
┌─────────────────┐
│   API Server    │ (Express)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Agent Manager   │ (Roteamento)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   SDR Agent     │ (Instância específica)
└────────┬────────┘
         │
         ├─► Supabase (PostgreSQL)
         ├─► Redis (Buffer + Freeze)
         ├─► Gemini API (IA)
         └─► Evolution API (Envio)
```

## 📦 Instalação

### 1. Clone o repositório

```bash
git clone <repo>
cd sdr-agent
```

### 2. Instale dependências

```bash
npm install
```

### 3. Configure variáveis de ambiente

Crie um arquivo `.env`:

```env
# Gemini API
GEMINI_API_KEY=sua_chave_gemini

# Supabase
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_chave_supabase

# Redis
REDIS_URL=redis://localhost:6379

# Evolution API
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=sua_chave_evolution

# Servidor
PORT=3000
```

### 4. Configure o banco de dados

Execute o script SQL no Supabase SQL Editor:

```bash
# Copie o conteúdo de schema.sql e execute no Supabase
```

### 5. Inicie o servidor

```bash
npm run dev
```

## 🚀 Uso

### Criando um Agente

**Endpoint:** `POST /api/agents`

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "agentName": "Bento - Ótica Central",
    "instanceName": "instance_otica_001",
    "acesId": 1,
    "systemMessage": "Você é Bento, consultor de ótica...",
    "userMessageTemplate": "Contexto:\n- Nome: {leadName}\n\nMensagens:\n{allMessages}",
    "bufferWaitMs": 15000
  }'
```

**Resposta:**
```json
{
  "success": true,
  "agent": {
    "agentId": "agent_1234567890_abc123",
    "agentName": "Bento - Ótica Central",
    "instanceName": "instance_otica_001",
    "isActive": true,
    "createdAt": "2025-04-10T10:30:00.000Z"
  }
}
```

### Listando Agentes

**Endpoint:** `GET /api/agents`

```bash
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer user_123"
```

**Resposta:**
```json
{
  "success": true,
  "agents": [
    {
      "agentId": "agent_1234567890_abc123",
      "agentName": "Bento - Ótica Central",
      "instanceName": "instance_otica_001",
      "isActive": true,
      "createdAt": "2025-04-10T10:30:00.000Z"
    }
  ]
}
```

### Atualizando um Agente

**Endpoint:** `PATCH /api/agents/:agentId`

```bash
curl -X PATCH http://localhost:3000/api/agents/agent_1234567890_abc123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "systemMessage": "Novo prompt do sistema...",
    "userMessageTemplate": "Novo template..."
  }'
```

### Duplicando um Agente

**Endpoint:** `POST /api/agents/:agentId/duplicate`

```bash
curl -X POST http://localhost:3000/api/agents/agent_1234567890_abc123/duplicate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "newName": "Bento - Ótica Filial 2",
    "newInstanceName": "instance_otica_002"
  }'
```

### Pausando/Ativando um Agente

```bash
# Pausar
curl -X POST http://localhost:3000/api/agents/agent_123/pause \
  -H "Authorization: Bearer user_123"

# Ativar
curl -X POST http://localhost:3000/api/agents/agent_123/activate \
  -H "Authorization: Bearer user_123"
```

### Deletando um Agente

**Endpoint:** `DELETE /api/agents/:agentId`

```bash
curl -X DELETE http://localhost:3000/api/agents/agent_123 \
  -H "Authorization: Bearer user_123"
```

## 🔄 Webhook Evolution API

Configure o webhook da Evolution API para apontar para:

```
POST http://seu-servidor.com/webhook/evolution
```

O sistema automaticamente roteará as mensagens para o agente correto baseado no `instance_name`.

## 🧩 Integrando no seu Frontend

### Exemplo React - Criar Agente

```tsx
import { useState } from 'react'

function CreateAgentForm() {
  const [config, setConfig] = useState({
    agentName: '',
    instanceName: '',
    systemMessage: DEFAULT_SYSTEM_MESSAGE,
    userMessageTemplate: DEFAULT_USER_MESSAGE_TEMPLATE,
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    const response = await fetch('/api/agents', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
      },
      body: JSON.stringify({
        ...config,
        acesId: 1,
        bufferWaitMs: 15000,
      }),
    })

    const data = await response.json()
    if (data.success) {
      alert('Agente criado com sucesso!')
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        placeholder="Nome do agente"
        value={config.agentName}
        onChange={(e) => setConfig({ ...config, agentName: e.target.value })}
      />
      
      <input
        placeholder="Nome da instância Evolution"
        value={config.instanceName}
        onChange={(e) => setConfig({ ...config, instanceName: e.target.value })}
      />

      <textarea
        placeholder="Prompt do sistema"
        value={config.systemMessage}
        onChange={(e) => setConfig({ ...config, systemMessage: e.target.value })}
        rows={10}
      />

      <textarea
        placeholder="Template de mensagem"
        value={config.userMessageTemplate}
        onChange={(e) => setConfig({ ...config, userMessageTemplate: e.target.value })}
        rows={5}
      />

      <button type="submit">Criar Agente</button>
    </form>
  )
}
```

### Exemplo React - Listar e Gerenciar Agentes

```tsx
function AgentList() {
  const [agents, setAgents] = useState([])

  useEffect(() => {
    fetchAgents()
  }, [])

  const fetchAgents = async () => {
    const response = await fetch('/api/agents', {
      headers: { 'Authorization': `Bearer ${userToken}` },
    })
    const data = await response.json()
    setAgents(data.agents)
  }

  const duplicateAgent = async (agentId) => {
    const newName = prompt('Nome do novo agente:')
    const newInstance = prompt('Nome da nova instância:')

    await fetch(`/api/agents/${agentId}/duplicate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userToken}`,
      },
      body: JSON.stringify({ newName, newInstanceName: newInstance }),
    })

    fetchAgents()
  }

  const toggleAgent = async (agentId, isActive) => {
    const action = isActive ? 'pause' : 'activate'
    await fetch(`/api/agents/${agentId}/${action}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken}` },
    })
    fetchAgents()
  }

  return (
    <div>
      {agents.map((agent) => (
        <div key={agent.agentId}>
          <h3>{agent.agentName}</h3>
          <p>Instância: {agent.instanceName}</p>
          <p>Status: {agent.isActive ? '🟢 Ativo' : '🔴 Pausado'}</p>
          
          <button onClick={() => toggleAgent(agent.agentId, agent.isActive)}>
            {agent.isActive ? 'Pausar' : 'Ativar'}
          </button>
          
          <button onClick={() => duplicateAgent(agent.agentId)}>
            Duplicar
          </button>
        </div>
      ))}
    </div>
  )
}
```

## 🔐 Isolamento de Dados

Cada agente tem isolamento completo:

- **Redis**: Prefixo com `agentId` em todas as chaves
- **PostgreSQL**: Filtragem por `agent_id` em todas as queries
- **RLS**: Row Level Security garante acesso apenas aos próprios dados

### Exemplo de chaves Redis:

```
agent_123_5511999999999_bloqueado  → Freeze de conversa
agent_123_5511999999999            → Buffer de mensagens
```

## 📊 Monitoramento

### View de Estatísticas

```sql
SELECT * FROM crm.agent_stats WHERE agent_id = 'agent_123';
```

Retorna:
- Total de leads
- Leads ativos (24h, 7d)
- Total de mensagens
- Mensagens inbound/outbound

### View de Conversas Recentes

```sql
SELECT * FROM crm.recent_conversations 
WHERE agent_id = 'agent_123' 
ORDER BY last_message_at DESC 
LIMIT 10;
```

## 🎨 Customização do Agente

Ao criar/editar um agente, você pode customizar:

### 1. **System Message** (Prompt do Sistema)
Define a personalidade e comportamento do agente.

```
Você é Bento, consultor virtual de ótica.

Regras:
- Mensagens com máximo 120 caracteres
- Tom amigável e profissional
- Sempre sugira agendar uma visita
```

### 2. **User Message Template** (Template de Contexto)
Define quais informações do lead são passadas para a IA.

```
Contexto do lead:
- Nome: {leadName}
- Telefone: {leadPhone}
- Voucher: {leadVoucher}
- Receita: {leadReceita}

Mensagens recebidas:
{allMessages}
```

Variáveis disponíveis:
- `{leadName}`: Nome do contato
- `{leadPhone}`: Telefone
- `{leadVoucher}`: Código de voucher
- `{leadReceita}`: Receita médica
- `{allMessages}`: Mensagens agrupadas do buffer

## 🧪 Testando

### Teste Manual com cURL

```bash
# Simular webhook da Evolution
curl -X POST http://localhost:3000/webhook/evolution \
  -H "Content-Type: application/json" \
  -d '{
    "event": "messages.upsert",
    "instance": "instance_otica_001",
    "data": {
      "key": {
        "remoteJid": "5511999999999@s.whatsapp.net",
        "fromMe": false,
        "id": "msg_123"
      },
      "pushName": "João Silva",
      "message": {
        "conversation": "Olá, gostaria de informações sobre óculos"
      },
      "messageType": "conversation",
      "messageTimestamp": 1712750400
    }
  }'
```

## 🔧 Troubleshooting

### Agente não responde

1. Verifique se está ativo: `GET /api/agents/:agentId`
2. Verifique logs do servidor
3. Confirme que o `instanceName` corresponde

### Mensagens duplicadas

- Aumente o `bufferWaitMs` (padrão: 15000ms)

### Freeze não funciona

- Verifique conexão Redis
- Confirme TTL configurado (padrão: 3600s = 1h)

## 📝 Estrutura de Tabelas

### `crm.agents`
Configurações de cada agente criado.

### `crm.leads`
Leads/contatos gerenciados por cada agente.

### `crm.message_history`
Histórico completo de mensagens (memória do agente).

## 🚀 Deploy

### Recomendações

- **API**: Railway, Render, Fly.io
- **Banco**: Supabase (PostgreSQL gerenciado)
- **Redis**: Upstash, Redis Cloud
- **Webhook**: Configure HTTPS (Evolution exige)

### Variáveis de Ambiente (Produção)

```env
NODE_ENV=production
GEMINI_API_KEY=...
SUPABASE_URL=...
SUPABASE_KEY=...
REDIS_URL=...
EVOLUTION_API_URL=...
EVOLUTION_API_KEY=...
PORT=3000
```

## 📚 Referências

- [Gemini API Docs](https://ai.google.dev/docs)
- [Evolution API Docs](https://doc.evolution-api.com/)
- [Supabase Docs](https://supabase.com/docs)

## 🤝 Contribuindo

Pull requests são bem-vindos! Para mudanças grandes, abra uma issue primeiro.

## 📄 Licença

MIT
