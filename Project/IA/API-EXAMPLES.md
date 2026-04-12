# 📡 Exemplos de API - SDR Agent

Exemplos práticos de todas as chamadas de API disponíveis.

## 🔐 Autenticação

Todas as requisições (exceto webhook) precisam do header:

```
Authorization: Bearer SEU_TOKEN_AQUI
```

---

## 📝 Gerenciamento de Agentes

### 1. Criar um Agente

**Endpoint:** `POST /api/agents`

```bash
curl -X POST http://localhost:3000/api/agents \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "agentName": "Bento - Ótica Central",
    "instanceName": "instance_otica_central",
    "acesId": 1,
    "systemMessage": "Você é Bento, consultor virtual de ótica...",
    "userMessageTemplate": "Contexto:\n- Nome: {leadName}\n\nMensagens:\n{allMessages}",
    "bufferWaitMs": 15000
  }'
```

**Resposta:**
```json
{
  "success": true,
  "agent": {
    "agentId": "agent_1712750400_abc123",
    "agentName": "Bento - Ótica Central",
    "instanceName": "instance_otica_central",
    "isActive": true,
    "createdAt": "2025-04-10T15:30:00.000Z"
  }
}
```

### 2. Listar Todos os Agentes

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
      "agentId": "agent_1712750400_abc123",
      "agentName": "Bento - Ótica Central",
      "instanceName": "instance_otica_central",
      "isActive": true,
      "createdAt": "2025-04-10T15:30:00.000Z"
    },
    {
      "agentId": "agent_1712750500_def456",
      "agentName": "Bento - Ótica Filial 2",
      "instanceName": "instance_otica_filial2",
      "isActive": false,
      "createdAt": "2025-04-10T16:00:00.000Z"
    }
  ]
}
```

### 3. Ver Detalhes de um Agente

**Endpoint:** `GET /api/agents/:agentId`

```bash
curl http://localhost:3000/api/agents/agent_1712750400_abc123 \
  -H "Authorization: Bearer user_123"
```

**Resposta:**
```json
{
  "success": true,
  "agent": {
    "agentId": "agent_1712750400_abc123",
    "agentName": "Bento - Ótica Central",
    "instanceName": "instance_otica_central",
    "acesId": 1,
    "systemMessage": "Você é Bento...",
    "userMessageTemplate": "Contexto:\n- Nome: {leadName}...",
    "bufferWaitMs": 15000,
    "isActive": true,
    "createdAt": "2025-04-10T15:30:00.000Z",
    "updatedAt": "2025-04-10T15:30:00.000Z"
  }
}
```

### 4. Atualizar um Agente

**Endpoint:** `PATCH /api/agents/:agentId`

```bash
curl -X PATCH http://localhost:3000/api/agents/agent_1712750400_abc123 \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "agentName": "Bento - Ótica Central (Atualizado)",
    "systemMessage": "Novo prompt do sistema...",
    "userMessageTemplate": "Novo template...",
    "bufferWaitMs": 20000
  }'
```

**Resposta:**
```json
{
  "success": true,
  "message": "Agente atualizado com sucesso",
  "agent": {
    "agentId": "agent_1712750400_abc123",
    "agentName": "Bento - Ótica Central (Atualizado)",
    "systemMessage": "Novo prompt...",
    "userMessageTemplate": "Novo template...",
    "bufferWaitMs": 20000,
    "isActive": true,
    "updatedAt": "2025-04-10T16:00:00.000Z"
  }
}
```

### 5. Pausar um Agente

**Endpoint:** `POST /api/agents/:agentId/pause`

```bash
curl -X POST http://localhost:3000/api/agents/agent_1712750400_abc123/pause \
  -H "Authorization: Bearer user_123"
```

**Resposta:**
```json
{
  "success": true,
  "message": "Agente pausado"
}
```

### 6. Ativar um Agente

**Endpoint:** `POST /api/agents/:agentId/activate`

```bash
curl -X POST http://localhost:3000/api/agents/agent_1712750400_abc123/activate \
  -H "Authorization: Bearer user_123"
```

**Resposta:**
```json
{
  "success": true,
  "message": "Agente ativado"
}
```

### 7. Duplicar um Agente

**Endpoint:** `POST /api/agents/:agentId/duplicate`

```bash
curl -X POST http://localhost:3000/api/agents/agent_1712750400_abc123/duplicate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer user_123" \
  -d '{
    "newName": "Bento - Ótica Filial 3",
    "newInstanceName": "instance_otica_filial3"
  }'
```

**Resposta:**
```json
{
  "success": true,
  "message": "Agente duplicado com sucesso",
  "agent": {
    "agentId": "agent_1712750600_ghi789",
    "agentName": "Bento - Ótica Filial 3",
    "instanceName": "instance_otica_filial3"
  }
}
```

### 8. Deletar um Agente

**Endpoint:** `DELETE /api/agents/:agentId`

```bash
curl -X DELETE http://localhost:3000/api/agents/agent_1712750400_abc123 \
  -H "Authorization: Bearer user_123"
```

**Resposta:**
```json
{
  "success": true,
  "message": "Agente deletado com sucesso"
}
```

---

## 📨 Webhook Evolution API

### Receber Mensagens

**Endpoint:** `POST /webhook/evolution` (Público - sem autenticação)

Este endpoint é chamado automaticamente pela Evolution API quando uma mensagem chega.

**Exemplo de Payload (Texto):**
```json
{
  "event": "messages.upsert",
  "instance": "instance_otica_central",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "msg_abc123"
    },
    "pushName": "João Silva",
    "message": {
      "conversation": "Olá, gostaria de informações sobre óculos"
    },
    "messageType": "conversation",
    "messageTimestamp": 1712750400
  }
}
```

**Exemplo de Payload (Áudio):**
```json
{
  "event": "messages.upsert",
  "instance": "instance_otica_central",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "msg_def456"
    },
    "pushName": "Maria Santos",
    "message": {
      "audioMessage": {
        "base64": "base64_audio_data_here..."
      }
    },
    "messageType": "audioMessage",
    "messageTimestamp": 1712750500
  }
}
```

**Exemplo de Payload (Imagem):**
```json
{
  "event": "messages.upsert",
  "instance": "instance_otica_central",
  "data": {
    "key": {
      "remoteJid": "5511999999999@s.whatsapp.net",
      "fromMe": false,
      "id": "msg_ghi789"
    },
    "pushName": "Pedro Costa",
    "message": {
      "imageMessage": {
        "base64": "base64_image_data_here...",
        "caption": "Minha receita"
      }
    },
    "messageType": "imageMessage",
    "messageTimestamp": 1712750600
  }
}
```

**Resposta:**
```json
{
  "success": true,
  "message": "Webhook recebido"
}
```

---

## 📋 Templates Padrão

### Obter Templates Padrão

**Endpoint:** `GET /api/templates/default`

```bash
curl http://localhost:3000/api/templates/default
```

**Resposta:**
```json
{
  "success": true,
  "templates": {
    "systemMessage": "🎯 Regras Invioláveis do Consultor Virtual\n\n...",
    "userMessageTemplate": "Contexto do lead:\n- Nome: {leadName}\n..."
  }
}
```

---

## 🔍 Health Check

### Verificar Status da API

**Endpoint:** `GET /health`

```bash
curl http://localhost:3000/health
```

**Resposta:**
```json
{
  "status": "ok",
  "timestamp": "2025-04-10T15:30:00.000Z"
}
```

---

## 💡 Exemplos de Integração

### JavaScript/Fetch

```javascript
// Criar agente
const createAgent = async () => {
  const response = await fetch('http://localhost:3000/api/agents', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer user_123',
    },
    body: JSON.stringify({
      agentName: 'Meu Agente',
      instanceName: 'instance_001',
      acesId: 1,
      systemMessage: 'Você é um assistente virtual...',
      userMessageTemplate: 'Mensagens:\n{allMessages}',
    }),
  })
  
  const data = await response.json()
  console.log('Agente criado:', data.agent)
}
```

### Python/Requests

```python
import requests

# Criar agente
response = requests.post(
    'http://localhost:3000/api/agents',
    headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer user_123',
    },
    json={
        'agentName': 'Meu Agente',
        'instanceName': 'instance_001',
        'acesId': 1,
        'systemMessage': 'Você é um assistente virtual...',
        'userMessageTemplate': 'Mensagens:\n{allMessages}',
    }
)

data = response.json()
print('Agente criado:', data['agent'])
```

### PHP/cURL

```php
<?php
$data = [
    'agentName' => 'Meu Agente',
    'instanceName' => 'instance_001',
    'acesId' => 1,
    'systemMessage' => 'Você é um assistente virtual...',
    'userMessageTemplate' => 'Mensagens:\n{allMessages}',
];

$ch = curl_init('http://localhost:3000/api/agents');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Authorization: Bearer user_123',
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$response = curl_exec($ch);
$result = json_decode($response, true);

echo 'Agente criado: ' . $result['agent']['agentId'];
curl_close($ch);
?>
```

---

## 🚨 Códigos de Erro

| Código | Significado |
|--------|-------------|
| 200 | Sucesso |
| 201 | Criado com sucesso |
| 400 | Dados inválidos |
| 401 | Não autorizado |
| 403 | Acesso negado |
| 404 | Recurso não encontrado |
| 500 | Erro interno do servidor |

---

## 📊 Queries SQL Úteis

### Ver leads de um agente
```sql
SELECT * FROM crm.leads 
WHERE agent_id = 'agent_1712750400_abc123'
ORDER BY last_message_at DESC;
```

### Ver mensagens recentes
```sql
SELECT * FROM crm.message_history 
WHERE agent_id = 'agent_1712750400_abc123'
ORDER BY sent_at DESC 
LIMIT 50;
```

### Estatísticas de um agente
```sql
SELECT * FROM crm.agent_stats 
WHERE agent_id = 'agent_1712750400_abc123';
```

---

💡 **Dica:** Use ferramentas como [Postman](https://www.postman.com/) ou [Insomnia](https://insomnia.rest/) para testar as APIs de forma visual!
