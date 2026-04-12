# Guia — Docker + Evolution API
> Conectar nova instância WhatsApp e integrar chats ao CRM

---

## Visão geral

A Evolution API é um servidor que gerencia conexões WhatsApp via Baileys (multi-device). Cada instância equivale a um número WhatsApp. Este guia cobre: subir o container, criar instância, conectar via QR code, e integrar os webhooks de mensagens ao CRM.

---

## 1. Pré-requisitos

- Docker e Docker Compose instalados no servidor
- Porta `8080` (ou escolhida) liberada no firewall
- PostgreSQL do CRM já rodando (usaremos o mesmo banco)
- Variável `APIFY_API_TOKEN` já configurada no `.env` principal

---

## 2. docker-compose.yml

Adicione o serviço ao seu `docker-compose.yml` existente (ou crie um dedicado):

```yaml
version: '3.8'

services:
  evolution-api:
    image: atendai/evolution-api:latest
    container_name: evolution_api
    restart: always
    ports:
      - "8080:8080"
    environment:
      # Autenticação global da API
      AUTHENTICATION_TYPE: apikey
      AUTHENTICATION_API_KEY: ${EVOLUTION_API_KEY}
      AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES: true

      # Banco de dados (mesmo PostgreSQL do CRM)
      DATABASE_ENABLED: true
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/${DB_NAME}
      DATABASE_CONNECTION_CLIENT_NAME: evolution_api
      DATABASE_SAVE_DATA_INSTANCE: true
      DATABASE_SAVE_DATA_NEW_MESSAGE: true
      DATABASE_SAVE_DATA_CONTACTS: true
      DATABASE_SAVE_DATA_CHATS: true

      # Redis (cache de sessão — recomendado)
      CACHE_REDIS_ENABLED: true
      CACHE_REDIS_URI: redis://redis:6379/1

      # Webhook global (aponta para seu backend CRM)
      WEBHOOK_GLOBAL_ENABLED: true
      WEBHOOK_GLOBAL_URL: ${CRM_BACKEND_URL}/api/webhook/evolution
      WEBHOOK_GLOBAL_WEBHOOK_BY_EVENTS: true
      WEBHOOK_EVENTS_MESSAGES_UPSERT: true
      WEBHOOK_EVENTS_CONNECTION_UPDATE: true
      WEBHOOK_EVENTS_QRCODE_UPDATED: true

      # Configurações gerais
      SERVER_TYPE: http
      SERVER_PORT: 8080
      DEL_INSTANCE: false
      LANGUAGE: pt-BR

    volumes:
      - evolution_instances:/evolution/instances
      - evolution_store:/evolution/store

  redis:
    image: redis:7-alpine
    container_name: evolution_redis
    restart: always
    volumes:
      - redis_data:/data

volumes:
  evolution_instances:
  evolution_store:
  redis_data:
```

### Variáveis de ambiente necessárias no `.env`

```env
EVOLUTION_API_KEY=sua_chave_secreta_aqui
EVOLUTION_API_URL=http://localhost:8080

DB_USER=postgres
DB_PASSWORD=sua_senha
DB_HOST=localhost
DB_NAME=seu_banco

CRM_BACKEND_URL=https://seu-crm.com
```

---

## 3. Subir os containers

```bash
docker-compose up -d evolution-api redis

# Verificar se subiu corretamente
docker logs evolution_api --tail 50
```

Acesse `http://localhost:8080` — deve retornar `{"status":"ok"}`.

---

## 4. Criar uma nova instância (número WhatsApp)

### Via API REST

```bash
curl -X POST http://localhost:8080/instance/create \
  -H "Content-Type: application/json" \
  -H "apikey: ${EVOLUTION_API_KEY}" \
  -d '{
    "instanceName": "Scael",
    "qrcode": true,
    "integration": "WHATSAPP-BAILEYS"
  }'
```

Resposta:
```json
{
  "instance": { "instanceName": "Scael", "status": "created" },
  "hash": { "apikey": "INSTANCE_API_KEY_GERADA" },
  "qrcode": { "base64": "data:image/png;base64,..." }
}
```

Salve o `hash.apikey` — é a chave específica dessa instância.

### Conectar via QR Code

```bash
# Buscar QR code atualizado
curl http://localhost:8080/instance/connect/Scael \
  -H "apikey: ${EVOLUTION_API_KEY}"
```

O campo `base64` retorna a imagem do QR code. Exiba no frontend para o usuário escanear com o WhatsApp.

### Verificar status da conexão

```bash
curl http://localhost:8080/instance/connectionState/Scael \
  -H "apikey: ${EVOLUTION_API_KEY}"
```

Resposta esperada após scan: `{"instance":{"state":"open"}}`

---

## 5. Integração no backend do CRM

### 5.1 Endpoint de criação de instância (`POST /api/instancias`)

```typescript
import axios from 'axios'

const EVOLUTION_URL = process.env.EVOLUTION_API_URL
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY

export async function createInstance(instanceName: string) {
  const { data } = await axios.post(`${EVOLUTION_URL}/instance/create`, {
    instanceName,
    qrcode: true,
    integration: 'WHATSAPP-BAILEYS',
  }, {
    headers: { apikey: EVOLUTION_KEY }
  })

  // Salvar instância na tabela existente crm.instance
  await db.query(`
    INSERT INTO crm.instance (instancia, token, status)
    VALUES ($1, $2, 'disconnected')
    ON CONFLICT (instancia) DO UPDATE SET token = $2
  `, [instanceName, data.hash.apikey])

  return {
    instanceName,
    qrCodeBase64: data.qrcode.base64,
  }
}
```

### 5.2 Endpoint de QR code para reconexão (`GET /api/instancias/:nome/qrcode`)

```typescript
export async function getQRCode(instanceName: string) {
  const { data } = await axios.get(
    `${EVOLUTION_URL}/instance/connect/${instanceName}`,
    { headers: { apikey: EVOLUTION_KEY } }
  )
  return data.base64
}
```

### 5.3 Webhook de eventos (`POST /api/webhook/evolution`)

Este endpoint recebe todos os eventos da Evolution API. Os mais importantes:

```typescript
export async function evolutionWebhook(req, res) {
  const { event, instance, data } = req.body
  res.status(200).send('ok') // Responder rápido

  switch (event) {
    case 'connection.update':
      await handleConnectionUpdate(instance, data)
      break
    case 'messages.upsert':
      await handleNewMessage(instance, data)
      break
    case 'qrcode.updated':
      // Opcional: notificar frontend via SSE/WebSocket
      break
  }
}

async function handleConnectionUpdate(instanceName: string, data: any) {
  const status = data.state === 'open' ? 'connected' : 'disconnected'
  await db.query(`
    UPDATE crm.instance SET status = $1 WHERE instancia = $2
  `, [status, instanceName])
}

async function handleNewMessage(instanceName: string, data: any) {
  const messages = Array.isArray(data) ? data : [data]

  for (const msg of messages) {
    if (!msg.key || msg.key.fromMe) continue // Ignorar próprias mensagens

    const phone = msg.key.remoteJid.replace('@s.whatsapp.net', '')
    const content = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || ''

    // Buscar lead pelo telefone + instância
    const lead = await db.query(`
      SELECT id FROM crm.leads
      WHERE contact_phone LIKE $1 AND instancia = $2
      LIMIT 1
    `, [`%${phone.slice(-9)}%`, instanceName])

    if (!lead.rows[0]) return

    // Salvar na message_history (tabela existente)
    await db.query(`
      INSERT INTO crm.message_history
        (lead_id, content, direction, conversation_id, instance)
      VALUES ($1, $2, 'inbound', $3, $4)
    `, [
      lead.rows[0].id,
      content,
      msg.key.id,
      instanceName
    ])

    // Atualizar last_message_at no lead
    await db.query(`
      UPDATE crm.leads SET last_message_at = now()
      WHERE id = $1
    `, [lead.rows[0].id])
  }
}
```

---

## 6. Enviar mensagem via Evolution API

Função reutilizável para o scheduler de automação:

```typescript
export async function sendWhatsAppMessage(
  instanceName: string,
  phone: string,
  message: string
) {
  const number = phone.replace(/\D/g, '') // Limpar formatação

  await axios.post(`${EVOLUTION_URL}/message/sendText/${instanceName}`, {
    number: `${number}@s.whatsapp.net`,
    text: message,
    delay: 1000, // ms de delay humanizado
  }, {
    headers: { apikey: EVOLUTION_KEY }
  })
}
```

---

## 7. Fluxo de conexão no frontend (tela de instâncias)

```
1. Usuário clica em "Nova Instância"
2. Frontend POST /api/instancias { nome: "MinhaEmpresa" }
3. Backend cria na Evolution API → retorna QR code base64
4. Frontend exibe QR code em modal (atualiza a cada 30s se não conectado)
5. Usuário escaneia com WhatsApp
6. Evolution API dispara webhook connection.update { state: "open" }
7. Backend atualiza crm.instance.status = 'connected'
8. Frontend polling /api/instancias/:nome/status → exibe "Conectado ✓"
```

---

## 8. Tabela `crm.instance` — verificar schema

Certifique-se que a tabela já existente tem pelo menos:

```sql
-- Adicionar coluna se não existir
ALTER TABLE crm.instance ADD COLUMN IF NOT EXISTS token text;
ALTER TABLE crm.instance ADD COLUMN IF NOT EXISTS status text DEFAULT 'disconnected';
```

---

## 9. Instruções para o Codex

1. **Não substitua o cliente WhatsApp atual** se já houver algum integrado — verifique antes. Esta implementação é aditiva.

2. **O webhook deve responder `200` imediatamente** e processar de forma assíncrona (enfileire ou use `setImmediate`). A Evolution API cancela a entrega se não receber resposta em tempo.

3. **Normalização de telefone**: ao buscar o lead pelo número, use `LIKE '%${phone.slice(-9)}%'` pois os números podem vir com ou sem código de país.

4. **A tabela `crm.instance` já existe** — não recrie. Apenas adicione as colunas `token` e `status` se ausentes (via `ADD COLUMN IF NOT EXISTS`).

5. **Nunca exponha `EVOLUTION_API_KEY` no frontend** — toda comunicação com a Evolution API é backend-only.

6. **Para múltiplas instâncias**: a Evolution API suporta N instâncias no mesmo container. Cada `instanceName` é isolado.

7. **Reconexão automática**: se o status ficar `disconnected`, o frontend deve oferecer botão para gerar novo QR code via `GET /api/instancias/:nome/qrcode`.

---

## 10. Checklist de deploy

- [ ] Container `evolution-api` rodando e saudável
- [ ] Container `redis` rodando
- [ ] Variáveis de ambiente configuradas no servidor
- [ ] Endpoint `CRM_BACKEND_URL/api/webhook/evolution` acessível publicamente (HTTPS)
- [ ] Instância criada e QR code escaneado
- [ ] Status da instância = `open` confirmado
- [ ] Envio de mensagem de teste funcionando
- [ ] Mensagem recebida aparecendo em `crm.message_history`
- [ ] Colunas `token` e `status` existem em `crm.instance`
