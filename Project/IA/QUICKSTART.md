# 🚀 Guia Rápido - SDR Agent

Este guia vai te ajudar a ter o sistema rodando em **15 minutos**.

## ⚡ Início Rápido

### 1. Instale as dependências (2 min)

```bash
npm install
```

### 2. Configure as credenciais (5 min)

Copie o arquivo de exemplo:
```bash
cp .env.example .env
```

Edite o `.env` e preencha:

```env
# Gemini API (https://makersuite.google.com/app/apikey)
GEMINI_API_KEY=sua_chave_aqui

# Supabase (https://app.supabase.com/project/_/settings/api)
SUPABASE_URL=https://seu-projeto.supabase.co
SUPABASE_KEY=sua_chave_supabase

# Redis (para dev local use: redis://localhost:6379)
REDIS_URL=redis://localhost:6379

# Evolution API
EVOLUTION_API_URL=https://sua-evolution-api.com
EVOLUTION_API_KEY=sua_chave_evolution
```

### 3. Configure o banco de dados (3 min)

1. Acesse o **Supabase SQL Editor**
2. Copie e cole o conteúdo de `schema.sql`
3. Execute o script

### 4. Inicie o servidor (1 min)

```bash
npm run dev
```

Pronto! O servidor está rodando em `http://localhost:3000`

### 5. Crie seu primeiro agente (4 min)

#### Usando cURL:

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "agentName": "Meu Primeiro Agente",
    "instanceName": "instance_001",
    "acesId": 1,
    "systemMessage": "Você é um consultor virtual amigável e prestativo.",
    "userMessageTemplate": "Mensagens:\n{allMessages}"
  }'
```

#### Ou usando a interface React:

Copie o código de `example-react-ui.tsx` para o seu projeto React e acesse via navegador.

## 📱 Configure o Webhook da Evolution API

No painel da Evolution API, configure o webhook para:

```
POST http://seu-servidor.com/webhook/evolution
```

**Importante:** Use HTTPS em produção!

## ✅ Teste seu agente

Envie uma mensagem no WhatsApp para o número conectado à instância que você configurou.

O agente deve responder automaticamente!

## 🔍 Monitorar

### Ver agentes criados:

```bash
curl http://localhost:3000/api/agents \
  -H "Authorization: Bearer user_123"
```

### Ver estatísticas (direto no Supabase):

```sql
SELECT * FROM crm.agent_stats;
```

### Ver conversas recentes:

```sql
SELECT * FROM crm.recent_conversations LIMIT 10;
```

## 🛠️ Comandos Úteis

```bash
# Desenvolvimento (auto-reload)
npm run dev

# Build para produção
npm run build

# Rodar em produção
npm start

# Formatar código
npm run format

# Verificar erros
npm run lint
```

## 🎯 Próximos Passos

1. **Customize o prompt**: Edite o `systemMessage` do agente para sua necessidade
2. **Adicione campos customizados**: Modifique o `userMessageTemplate` para incluir mais dados
3. **Configure múltiplos agentes**: Crie um agente para cada produto/serviço
4. **Implemente autenticação real**: Substitua o `Bearer user_123` por JWT ou OAuth
5. **Deploy em produção**: Use Railway, Render ou Fly.io

## ⚠️ Troubleshooting Rápido

### Erro: Cannot connect to Redis
```bash
# Inicie o Redis localmente
docker run -d -p 6379:6379 redis:alpine
```

### Erro: Gemini API key invalid
- Verifique se a chave está correta
- Teste a chave em: https://makersuite.google.com/app/apikey

### Agente não responde
1. Verifique se está ativo: `GET /api/agents/:agentId`
2. Confira os logs do servidor
3. Confirme que o `instanceName` está correto

### Mensagens duplicadas
- Aumente o `bufferWaitMs` para 20000 (20 segundos)

## 📚 Documentação Completa

Para guia completo, consulte: `README.md`

## 💬 Suporte

Se encontrar problemas:
1. Verifique os logs do servidor (`console`)
2. Verifique os logs do Supabase (Dashboard > Logs)
3. Verifique se o Redis está rodando: `redis-cli ping`

---

**Tempo estimado:** 15 minutos ⏱️

Agora você tem um sistema de agentes SDR rodando! 🎉
