---
title: "Agenda Universal — Guia de Integração v1"
tags:
  - project/its-time
  - type/integration-guide
status: "approved"
last_updated: 2026-09-15
author: "Equipe Its Time"
---

# Agenda Universal — Guia de Integração v1

Este guia explica como um sistema parceiro se conecta à agenda do Its Time.
Apesar de a integração usar duas direções HTTP, ela não é uma API CRUD de
agendamentos: o Its Time continua sendo a autoridade da agenda e o parceiro
mantém um espelho dos eventos recebidos.

## 1. Modelo da integração

Existem dois webhooks:

| Direção | Quem chama | O que acontece |
| --- | --- | --- |
| Its Time → parceiro | Its Time faz `POST` na URL cadastrada pelo cliente | Envia unidades, profissionais, disponibilidade, pacientes e alterações de agendamento. |
| Parceiro → Its Time | O sistema parceiro faz `POST` no endpoint público do Its Time | Reporta somente o resultado do atendimento: `done` ou `no_show`. |

O parceiro não cria, altera horário, cancela ou configura agendamentos na v1.
Todos os IDs que aparecem no contrato são UUIDs do Its Time. Mantenha uma
tabela local para relacionar esses IDs aos registros internos do parceiro.

## 2. Início rápido

1. O administrador cria a conexão no painel **Conexões → Integrações → Agenda Universal**.
2. O administrador cadastra a URL HTTPS pública que receberá os eventos.
3. O Its Time gera `publicConnectionId`, `inboundSecret` e `outboundSecret`.
4. O cliente entrega os valores ao Dev por um canal seguro, nunca por código, navegador ou log.
5. O parceiro implementa o webhook receptor, valida a assinatura e responde com `2xx`.
6. O administrador executa o teste de conexão e ativa a integração.
7. A ativação envia uma ressincronização inicial antes da operação normal.

### Direção dos segredos

| Segredo | Usado por | Finalidade |
| --- | --- | --- |
| `inboundSecret` | Parceiro | Assinar o evento enviado ao Its Time. |
| `outboundSecret` | Its Time | Assinar o webhook enviado ao parceiro. |

Os segredos são exibidos somente na criação ou rotação. Ao rotacionar, aceite
temporariamente o segredo anterior durante a janela de transição informada
pela operação.

## 3. Autenticação HMAC

Todas as requisições usam JSON e os cabeçalhos abaixo:

| Cabeçalho | Regra |
| --- | --- |
| `Content-Type` | `application/json` |
| `Idempotency-Key` | UUID idêntico, byte a byte, ao `eventId` do corpo. |
| `X-Agenda-Timestamp` | Unix timestamp em segundos ou milissegundos. Tolerância de 5 minutos. |
| `X-Agenda-Signature` | `sha256=` seguido do HMAC-SHA256 em hexadecimal. |

Calcule a assinatura sobre os bytes exatos enviados:

```text
signature = HMAC-SHA256(secret, timestamp + "." + rawBody)
X-Agenda-Signature: sha256=<hash_hexadecimal>
```

Não reformate o JSON depois de assinar. Espaços, quebras de linha e ordem das
propriedades alteram os bytes e invalidam a assinatura.

## 4. Eventos enviados pelo Its Time

Todos os eventos são enviados para a mesma URL configurada na conexão. O tipo
fica no campo `eventType`:

| `eventType` | Uso |
| --- | --- |
| `integration.test` | Teste de conexão. |
| `unit.upserted` | Unidade criada ou atualizada. |
| `professional.upserted` | Profissional criado ou atualizado. |
| `availability.upserted` | Grade ou exceção de disponibilidade atualizada. |
| `patient.upserted` | Paciente criado ou atualizado. |
| `appointment.created` | Novo agendamento. |
| `appointment.rescheduled` | Horário do agendamento alterado. |
| `appointment.cancelled` | Agendamento cancelado. |
| `appointment.status_changed` | Status do agendamento alterado no Its Time. |

O consumidor deve ignorar `eventType` desconhecido e campos desconhecidos,
respondendo com `2xx`. Isso permite evoluir o contrato sem quebrar versões
antigas do parceiro.

Envelope ilustrativo:

```json
{
  "schemaVersion": "1.0",
  "eventId": "9c0c3d11-1e3e-4a18-8c19-02ab7c4d2001",
  "eventType": "appointment.created",
  "occurredAt": "2026-09-15T15:00:00Z",
  "resourceVersion": 1,
  "resource": {
    "id": "6f0f3d0f-9db5-4f35-a6e8-0a0c4d0e1001",
    "status": "scheduled",
    "startTime": "2026-09-20T14:00:00Z",
    "endTime": "2026-09-20T14:30:00Z",
    "timezone": "America/Sao_Paulo",
    "durationMinutes": 30,
    "unitId": "7de2e00c-0b1e-4f3a-9c2b-01c8b6d30001",
    "professionalId": "8de2e00c-0b1e-4f3a-9c2b-01c8b6d30001",
    "assignmentId": "9de2e00c-0b1e-4f3a-9c2b-01c8b6d30001",
    "patientId": "0de2e00c-0b1e-4f3a-9c2b-01c8b6d30001",
    "service": {
      "id": "1de2e00c-0b1e-4f3a-9c2b-01c8b6d30001",
      "name": "Consulta",
      "durationMinutes": 30,
      "price": "123.45",
      "currency": "BRL"
    },
    "origin": "api",
    "notes": null,
    "cancelReason": null,
    "metadata": {},
    "updatedAt": "2026-09-15T15:00:00Z"
  }
}
```

Persista `eventId` antes de confirmar o processamento. Se o mesmo evento chegar
novamente, não aplique a alteração duas vezes; responda `2xx` novamente.
Use `resourceVersion` para evitar aplicar um evento antigo sobre um recurso mais
novo.

## 5. Reportar o resultado do atendimento

Endpoint de entrada do Its Time:

```http
POST https://api.itstime.pro/api/integrations/agenda/v1/connections/{publicConnectionId}/events
```

O parceiro deve assinar a requisição com o `inboundSecret`. O único evento
suportado na v1 é `appointment.status_reported`:

```json
{
  "schemaVersion": "1.0",
  "eventId": "4b1d2d8a-5bd2-4f4c-9a9e-26a9a0e2d001",
  "eventType": "appointment.status_reported",
  "occurredAt": "2026-09-15T18:00:00Z",
  "resource": {
    "appointmentId": "6f0f3d0f-9db5-4f35-a6e8-0a0c4d0e1001",
    "status": "done",
    "reason": null,
    "reportedAt": "2026-09-15T18:00:00Z",
    "baseResourceVersion": 7,
    "metadata": { "source": "reception" }
  }
}
```

`baseResourceVersion` deve ser a última versão do agendamento conhecida pelo
parceiro. Se a versão estiver obsoleta, a resposta será `409` com
`stale_resource_version`; atualize o espelho antes de reenviar.

### Exemplo cURL

```bash
URL="https://api.itstime.pro/api/integrations/agenda/v1/connections/SEU_PUBLIC_CONNECTION_ID/events"
SECRET="SEU_INBOUND_SECRET"
TIMESTAMP=$(date +%s)
EVENT_ID="4b1d2d8a-5bd2-4f4c-9a9e-26a9a0e2d001"
BODY='{"schemaVersion":"1.0","eventId":"4b1d2d8a-5bd2-4f4c-9a9e-26a9a0e2d001","eventType":"appointment.status_reported","occurredAt":"2026-09-15T18:00:00Z","resource":{"appointmentId":"6f0f3d0f-9db5-4f35-a6e8-0a0c4d0e1001","status":"done","reason":null,"reportedAt":"2026-09-15T18:00:00Z","baseResourceVersion":7,"metadata":{"source":"reception"}}}'
SIGNATURE=$(printf '%s.%s' "$TIMESTAMP" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

curl --request POST "$URL" \
  --header "Content-Type: application/json" \
  --header "Idempotency-Key: $EVENT_ID" \
  --header "X-Agenda-Timestamp: $TIMESTAMP" \
  --header "X-Agenda-Signature: sha256=$SIGNATURE" \
  --data-raw "$BODY"
```

### Exemplo Node.js 18+

```js
import { createHmac, randomUUID } from "node:crypto";

const url = "https://api.itstime.pro/api/integrations/agenda/v1/connections/SEU_PUBLIC_CONNECTION_ID/events";
const secret = process.env.AGENDA_INBOUND_SECRET;
const eventId = randomUUID();
const timestamp = Math.floor(Date.now() / 1000).toString();
const payload = {
  schemaVersion: "1.0",
  eventId,
  eventType: "appointment.status_reported",
  occurredAt: new Date().toISOString(),
  resource: {
    appointmentId: "6f0f3d0f-9db5-4f35-a6e8-0a0c4d0e1001",
    status: "no_show",
    reason: "Paciente não compareceu",
    reportedAt: new Date().toISOString(),
    baseResourceVersion: 7,
    metadata: { source: "reception" }
  }
};
const rawBody = JSON.stringify(payload);
const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${rawBody}`)
  .digest("hex");

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": eventId,
    "X-Agenda-Timestamp": timestamp,
    "X-Agenda-Signature": `sha256=${signature}`
  },
  body: rawBody
});

console.log(response.status, await response.text());
```

### Exemplo Python 3.10+

```python
import hashlib
import hmac
import json
import os
import time
import uuid
import requests

event_id = str(uuid.uuid4())
timestamp = str(int(time.time()))
payload = {
    "schemaVersion": "1.0",
    "eventId": event_id,
    "eventType": "appointment.status_reported",
    "occurredAt": "2026-09-15T18:00:00Z",
    "resource": {
        "appointmentId": "6f0f3d0f-9db5-4f35-a6e8-0a0c4d0e1001",
        "status": "done",
        "reason": None,
        "reportedAt": "2026-09-15T18:00:00Z",
        "baseResourceVersion": 7,
        "metadata": {"source": "reception"},
    },
}
raw_body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
digest = hmac.new(
    os.environ["AGENDA_INBOUND_SECRET"].encode("utf-8"),
    timestamp.encode("ascii") + b"." + raw_body,
    hashlib.sha256,
).hexdigest()

response = requests.post(
    "https://api.itstime.pro/api/integrations/agenda/v1/connections/SEU_PUBLIC_CONNECTION_ID/events",
    data=raw_body,
    headers={
        "Content-Type": "application/json",
        "Idempotency-Key": event_id,
        "X-Agenda-Timestamp": timestamp,
        "X-Agenda-Signature": f"sha256={digest}",
    },
    timeout=10,
)
print(response.status_code, response.text)
```

## 6. Respostas, erros e retentativas

Resposta aceita:

```json
{
  "accepted": true,
  "duplicate": false,
  "eventId": "4b1d2d8a-5bd2-4f4c-9a9e-26a9a0e2d001",
  "resourceVersion": 8
}
```

Uma repetição idêntica retorna `duplicate: true`. Evento desconhecido retorna
`200` com `accepted: false` e `ignored: true`.

| HTTP | Significado | Ação |
| --- | --- | --- |
| `200` | Evento desconhecido ou recibo já concluído. | Não repetir sem necessidade. |
| `202` | Evento aceito ou duplicado idempotente. | Marcar como entregue. |
| `400` | JSON, cabeçalho ou `Idempotency-Key` inválido. | Corrigir antes de repetir. |
| `401` | Conexão, timestamp ou assinatura inválidos. | Revisar segredo, relógio e corpo bruto. |
| `404` | Agendamento não encontrado na conexão. | Não tentar adivinhar por telefone/data. |
| `409` | Idempotência em conflito ou `resourceVersion` obsoleto. | Reconciliar o espelho. |
| `422` | Transição de status inválida. | Corrigir o estado enviado. |
| `429` | Limite de requisições excedido. | Respeitar `Retry-After`. |
| `503` | Conexão pausada ou indisponível. | Repetir com espera progressiva. |

Para o webhook do parceiro, o Its Time repete respostas `408`, `425`, `429` e
`5xx`, além de falhas de rede. Use o mesmo `eventId` e o mesmo corpo ao repetir;
gere apenas um novo timestamp e assinatura. Responda rapidamente e processe o
evento de forma idempotente.

## 7. Contrato oficial e checklist

Arquivos oficiais:

- `Project/IA/agenda-sync/contracts/agenda-universal-v1.openapi.yaml`
- `Project/IA/agenda-sync/contracts/agenda-universal-v1.schema.json`

Checklist antes da ativação:

- [ ] URL do webhook é pública e usa HTTPS.
- [ ] Segredos estão guardados em um gerenciador seguro.
- [ ] O parceiro valida HMAC sobre o corpo bruto.
- [ ] O parceiro persiste `eventId` e trata duplicidade.
- [ ] O parceiro ignora eventos e campos desconhecidos.
- [ ] O parceiro controla `resourceVersion`.
- [ ] O endpoint de retorno envia `Idempotency-Key` igual ao `eventId`.
- [ ] `done` e `no_show` são enviados somente após o atendimento.
- [ ] Respostas temporárias têm retentativa com backoff.
- [ ] O teste de conexão foi concluído antes da ativação.
