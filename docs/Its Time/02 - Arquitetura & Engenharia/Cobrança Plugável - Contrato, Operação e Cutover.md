# Cobrança plugável — contrato, operação e cutover

## 1. Responsabilidades

O schema privado `collections` é o núcleo de orquestração. Ele recebe e normaliza dados, mantém projeções de títulos e casos, avalia jornadas, controla a cadência e registra auditoria. A fonte externa continua dona do estado financeiro: o núcleo não calcula juros, emite títulos, concilia pagamentos nem deduz quitação por ausência.

RB, webhook e arquivo são adaptadores do mesmo contrato. Nenhum adaptador informa `aces_id`, `agent_id`, `lead_id` ou estado de comunicação. O tenant vem exclusivamente da conexão autenticada.

O `collection-worker` executa pulls, publicação de arquivos, outbox, elegibilidade, leases e retenção. Somente o `automation-worker` envia mensagens.

## 2. Contrato canônico v1

O envelope usa `schemaVersion: "1.0"`, valores monetários como decimal textual com ponto, vencimentos em `YYYY-MM-DD` e timestamps ISO 8601 com timezone.

```json
{
  "schemaVersion": "1.0",
  "connectionId": "substituido-pelo-backend-no-webhook",
  "ingestionId": "erp-2026-09-04-lote-42",
  "mode": "incremental",
  "occurredAt": "2026-09-04T14:30:00-03:00",
  "scope": {
    "creditorExternalId": "loja-01",
    "sourcePartition": "abertos"
  },
  "records": [
    {
      "schemaVersion": "1.0",
      "source": {
        "connectionId": "substituido-pelo-backend-no-webhook",
        "externalEventId": "evt-9001",
        "sourceUpdatedAt": "2026-09-04T14:29:55-03:00"
      },
      "customer": {
        "externalId": "cliente-123",
        "name": "Maria Silva",
        "phone": "+55 11 99999-9999",
        "document": "00000000000"
      },
      "creditor": {
        "externalId": "loja-01",
        "name": "Loja Centro",
        "document": "00000000000000"
      },
      "receivable": {
        "externalId": "titulo-456",
        "description": "Parcela 2/3",
        "originalAmount": "150.00",
        "remainingAmount": "150.00",
        "currency": "BRL",
        "dueDate": "2026-09-01",
        "status": "open"
      },
      "payment": {
        "method": "pix",
        "pixKey": "chave-fornecida-pela-fonte"
      },
      "metadata": {
        "contract": "C-123"
      }
    }
  ]
}
```

Status financeiros: `open`, `settled`, `cancelled`, `suspended` e `unknown`. Métodos de pagamento: `pix`, `boleto`, `card`, `cash`, `bank_transfer`, `store_credit` e `other`.

Identidades:

- título: conexão + `receivable.externalId`;
- caso: conexão + `customer.externalId` + `creditor.externalId`;
- proteção diária: conta + hash do telefone normalizado + data local.

Eventos com `sourceUpdatedAt` anterior ao estado persistido são auditados e ignorados. `snapshot` só é válido quando `supportsAuthoritativeSnapshot=true`; ausência em snapshot integral publicado vira `not_present`, nunca `settled`. Ausência em incremental não tem efeito.

`metadata` aceita no máximo 32 chaves por objeto, profundidade 3, listas de 50 itens e 16 KiB normalizados. Payload bruto e metadata não entram no prompt.

## 3. Webhook genérico

Endpoint:

```http
POST /api/integrations/collections/v1/sources/{publicSourceId}/events
Content-Type: application/json
Idempotency-Key: chave-unica-do-lote
X-Collection-Timestamp: 1788532200
X-Collection-Signature: sha256=hexadecimal
```

A assinatura é `HMAC-SHA256(secret, timestamp + "." + rawBody)`. O corpo usado para assinar deve ser exatamente o corpo transmitido, sem reserialização. O timestamp pode estar em segundos ou milissegundos e deve ficar na janela de cinco minutos.

Exemplo Node.js:

```js
import { createHmac } from "node:crypto";

const timestamp = Math.floor(Date.now() / 1000).toString();
const rawBody = JSON.stringify(envelope);
const signature = `sha256=${createHmac("sha256", secret)
  .update(timestamp).update(".").update(rawBody).digest("hex")}`;
```

### 3.1 Guia de utilização

Este fluxo é usado quando o sistema externo de cobrança envia títulos para o CRM. O sistema externo continua sendo a fonte da verdade financeira; o webhook apenas publica o estado atual para que o CRM crie ou atualize os casos e avalie as jornadas de cobrança.

#### 3.1.1 Criar e preparar a fonte

Um administrador deve criar uma fonte do tipo `webhook` na tela **Cobrança** ou pela API administrativa. A configuração mínima é:

```json
{
  "name": "ERP Cobrança",
  "sourceType": "webhook",
  "deliveryMode": "push",
  "defaultIngestionMode": "incremental"
}
```

Na criação, o backend retorna `source.id` (interno), `source.public_id` (usado na URL) e `secret` (segredo HMAC exibido uma única vez). O endereço de recebimento é:

```text
{CRM_BACKEND_URL}/api/integrations/collections/v1/sources/{public_id}/events
```

O `public_id` e o `secret` devem ser cadastrados no sistema externo. O segredo não deve ser colocado no frontend, em migrations, no repositório ou em logs.

#### 3.1.2 Enviar um lote

Cada chamada deve serializar o JSON uma única vez, gerar um `Idempotency-Key` único para o lote, gerar o timestamp atual, assinar `timestamp + "." + rawBody` com HMAC-SHA256 e enviar no máximo 500 registros em até 1 MiB.

Exemplo completo em Node.js:

```js
import { createHmac, randomUUID } from "node:crypto";

const url = `${process.env.CRM_BACKEND_URL}/api/integrations/collections/v1/sources/${process.env.COLLECTION_SOURCE_PUBLIC_ID}/events`;
const secret = process.env.COLLECTION_WEBHOOK_SECRET;
const timestamp = Math.floor(Date.now() / 1000).toString();
const idempotencyKey = `billing-${randomUUID()}`;

const payload = {
  schemaVersion: "1.0",
  connectionId: "ignored-by-client",
  ingestionId: idempotencyKey,
  mode: "incremental",
  occurredAt: new Date().toISOString(),
  records: [{
    schemaVersion: "1.0",
    source: {
      connectionId: "ignored-by-client",
      externalEventId: "evt-9001",
      sourceUpdatedAt: new Date().toISOString()
    },
    customer: {
      externalId: "cliente-123",
      name: "Maria Silva",
      phone: "+5511999999999",
      document: "00000000000"
    },
    creditor: {
      externalId: "loja-01",
      name: "Loja Centro",
      document: "00000000000000"
    },
    receivable: {
      externalId: "titulo-456",
      description: "Parcela 2/3",
      originalAmount: "150.00",
      remainingAmount: "150.00",
      currency: "BRL",
      dueDate: "2026-09-01",
      status: "open"
    },
    payment: { method: "pix", pixKey: "chave-fornecida-pela-fonte" }
  }]
};

const rawBody = JSON.stringify(payload);
const signature = `sha256=${createHmac("sha256", secret)
  .update(timestamp).update(".").update(rawBody).digest("hex")}`;

const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
    "X-Collection-Timestamp": timestamp,
    "X-Collection-Signature": signature
  },
  body: rawBody
});

console.log(response.status, await response.json());
```

O cliente não precisa conhecer o `connectionId` interno. O backend substitui esse valor pelo vínculo autenticado da URL e rejeita qualquer tentativa de enviar `aces_id`, `agent_id`, `lead_id` ou `communication_status`.

#### 3.1.3 Regras do payload

| Campo | Obrigatório | Regra |
| --- | --- | --- |
| `schemaVersion` | sim | Sempre `"1.0"`. |
| `ingestionId` | sim | ID estável do lote, até 255 caracteres. |
| `mode` | sim | `incremental` para alterações pontuais; `snapshot` somente quando o lote representa toda a carteira/escopo. |
| `occurredAt` | sim | ISO 8601 com timezone. |
| `records` | sim | Lista com 1 a 500 registros. |
| `customer.externalId` | sim | ID estável do cliente na origem. |
| `customer.name` | sim | Nome do cliente. |
| `customer.phone` | sim | Telefone válido; o CRM normaliza o formato. |
| `creditor.externalId` | sim | ID estável da loja/credor. |
| `receivable.externalId` | sim | ID estável do título. |
| `receivable.remainingAmount` | sim | Decimal não negativo, com ponto, por exemplo `"150.00"`. |
| `receivable.currency` | sim | Código ISO 4217 em três letras, normalmente `BRL`. |
| `receivable.dueDate` | sim | Data no formato `YYYY-MM-DD`. |
| `receivable.status` | sim | `open`, `settled`, `cancelled`, `suspended` ou `unknown`. |
| `payment` | não | Pode informar `method`, `pixKey`, `paymentUrl` HTTPS e `expiresAt`. |

`externalId` deve ser estável. O título é identificado por conexão + `receivable.externalId`; o caso, por conexão + cliente + credor. Não reutilize o mesmo identificador para títulos diferentes.

#### 3.1.4 Idempotência e reenvio

- Reenvio com a mesma chave e o mesmo conteúdo retorna `202` com `duplicate: true` e não repete efeitos.
- Reutilização da chave com conteúdo diferente retorna `409`; use uma nova chave somente para um novo lote intencional.
- Falhas de rede podem ser reenviadas com a mesma chave, sem criar duplicidade.
- `sourceUpdatedAt` protege contra eventos fora de ordem: evento mais antigo é registrado como `unchanged` e não sobrescreve o estado mais novo.

Use `incremental` na operação normal. Use `snapshot` somente quando o lote for integral e o `scope` identificar claramente a carteira representada. A ausência de um título em um snapshot autorizado marca o registro como ausente (`not_present`); não marca automaticamente o título como quitado.

#### 3.1.5 Respostas e política de retry

Uma aceitação retorna `202` com um recibo semelhante a:

```json
{
  "accepted": true,
  "duplicate": false,
  "ingestionId": "9e4d...",
  "status": "succeeded",
  "receivedCount": 1,
  "createdCount": 1,
  "updatedCount": 0,
  "unchangedCount": 0,
  "affectedCasesCount": 1
}
```

| HTTP | Significado | Ação |
| --- | --- | --- |
| `202` | Lote aceito ou repetição idempotente | Registrar o recibo. |
| `400` | JSON, cabeçalho ou `Idempotency-Key` inválido | Corrigir a requisição. |
| `401` | URL, timestamp ou assinatura inválidos | Conferir URL, segredo, relógio e bytes assinados. |
| `409` | Chave já usada com outro conteúdo | Não reutilizar a chave; investigar a divergência. |
| `413` | Corpo acima de 1 MiB | Dividir o lote. |
| `422` | Contrato ou registro inválido | Corrigir o campo indicado. |
| `429` | Limite temporário excedido | Reenviar após `Retry-After`, com backoff. |
| `503` | Fonte pausada ou indisponível | Reenviar depois, com o mesmo corpo. |

Não faça retry automático de `400`, `401`, `409` ou `422`. Para `429` e `503`, preserve a mesma chave e o mesmo corpo. Se o reenvio ocorrer fora da janela de cinco minutos, gere novo timestamp e recalcule a assinatura.

#### 3.1.6 Conferência no CRM

Depois do primeiro `202`, o administrador deve conferir a fonte como **ativa**, a ingestão no histórico com status `succeeded`, as contagens de criados/atualizados/inalterados, o caso de cobrança e a regra de jornada vinculada à fonte.

O webhook não envia mensagens diretamente. Ele atualiza os dados, coloca a reavaliação na outbox e deixa o `automation-worker` decidir se existe uma cobrança elegível.

#### 3.1.7 Rotação do segredo

Use a ação **Rotacionar segredo** da fonte webhook. O novo valor é exibido uma única vez; o anterior permanece válido por 24 horas. Atualize o emissor, envie um evento de teste, confirme `202` e remova o segredo antigo após a janela. Se o segredo for perdido, faça uma nova rotação.

#### 3.1.8 Checklist de produção

- [ ] Fonte criada com `sourceType=webhook` e `deliveryMode=push`.
- [ ] URL, `public_id` e segredo cadastrados no emissor.
- [ ] Corpo bruto assinado sem reserialização posterior.
- [ ] Relógio do emissor sincronizado por NTP.
- [ ] Cada lote usa chave de idempotência única e persistida.
- [ ] `incremental` é usado na rotina normal; `snapshot` fica restrito a cargas integrais.
- [ ] Teste retornou `202` e apareceu no histórico do CRM.
- [ ] Reenvio do mesmo lote não duplicou título, caso ou mensagem.
- [ ] Política de retry diferencia erros corrigíveis de indisponibilidade temporária.

As respostas, limites, reenvios e procedimentos de rotação estão detalhados no [guia de utilização](#31-guia-de-utilização) abaixo.

## 4. CSV/XLSX

O upload usa uma URL assinada e o bucket privado `collection-imports`. São aceitos CSV e XLSX de até 20 MiB e 50 mil linhas. O preview e a publicação usam o mesmo parser, mapeamento, aba, cabeçalho, formatos de data/decimal e timestamp-base do import.

Fluxo operacional:

1. crie uma fonte `file` e uma intenção de upload;
2. envie o arquivo pela URL assinada;
3. configure aba, cabeçalho, formatos, colunas e defaults;
4. gere o preview e corrija os erros por linha;
5. confirme `incremental` ou `snapshot`;
6. acompanhe a publicação assíncrona no histórico.

Snapshot com qualquer linha inválida é rejeitado integralmente. Incremental com linhas inválidas só publica as válidas após confirmação explícita. Fórmulas não são executadas. O arquivo bruto é excluído após sete dias; amostras e detalhes de erro são limpos após trinta dias.

## 5. Criação de adaptadores

Um novo ERP implementa `CollectionSourceMapper<TInput>` e, quando for pull, `PullCollectionConnector<TInput>`. O mapper declara `AdapterCapabilities`, converte o payload de origem para `CanonicalIngestionEnvelope` e é submetido à mesma suíte de contrato usada por RB, webhook e arquivos.

Checklist do adaptador:

- autenticar fora do mapper e resolver a conexão sem confiar no payload;
- manter IDs externos estáveis;
- informar capacidade de snapshot somente com consulta comprovadamente integral;
- mapear status sem inferir pagamento;
- informar instrução de pagamento somente quando confiável;
- usar a normalização central de telefone e validação canônica;
- cobrir duplicidade, concorrência, evento antigo, lote parcial e isolamento tenant.

## 6. Operação e incidentes

Estados internos do dispatcher: `legacy_rb`, `canonical` e `paused`. A seleção é feita por fonte, não por conta: webhook, arquivo e fontes RB ativas usam o fluxo canônico; uma fonte RB pausada não faz pull nem despacho. Nunca habilite dois dispatchers para a mesma fonte. Em incidente, use `paused`, preserve outbox e reconcilie efeitos externos antes de retomar.

No administrativo, a existência da conexão Via RB indica apenas que as credenciais foram cadastradas. O switch `Cobrança RB` controla a operação financeira. Ao ativá-lo, o backend prepara a fonte RB canônica e escolhe a rota automaticamente; ao pausá-lo, interrompe novas leituras e despachos, preservando histórico, configurações e preferências dos agentes.

Nos agentes, a Tool `Cobrança RB` só aparece quando a conexão está configurada e a cobrança está ativa. Ela possui somente o controle de ativação por agente. A configuração de Pix pertence à empresa: uma empresa pode usar uma `Chave Pix` manual ou `Usar CNPJ como Pix`; quando o segundo campo está ativo, o CNPJ normalizado tem prioridade, sem apagar a chave manual salva.

Alertas mínimos: fonte stale, falhas RB consecutivas, aumento de rejeições webhook, outbox sem progresso, import confirmado com falha, rota conflitante, execução pendente após baixa e divergência RB/canônico.

Para reconstrução, use a API administrativa de casos com motivo auditável. Para pausa, atendimento, opt-out ou contestação, use o controle transversal por contato; ele atualiza todos os casos do telefone e cancela execuções pendentes ou em processamento.

## 7. Runbook de ativação automática RB

Pré-condições: migrations aplicadas, schema preflight aprovado e segredo de criptografia configurado.

Ao salvar uma conexão RB com `Cobrança RB` ativa, o backend:

1. valida credenciais e empresas vinculadas;
2. cria ou atualiza a fonte RB canônica e sua credencial protegida;
3. prepara as rotas e preserva o funil legado durante a transição;
4. passa a usar o dispatcher canônico somente para essa fonte;
5. impede uma execução RB legada simultânea para a mesma conta/fonte.

O cutover manual permanece disponível apenas para reconciliação operacional de contas antigas. Ele exige backfill, três ciclos de shadow aprovados, comparação sem divergências relevantes, pausa temporária e ausência de execução RB `processing`. O usuário comum não precisa conhecer o termo `canonical` nem invocar esse fluxo.

Se a ativação automática não conseguir preparar uma rota segura, a cobrança não deve iniciar novos envios; as credenciais, o histórico e as preferências ficam preservados para revisão. Conflitos de Pix antigos e registros sem empresa correspondente são registrados em revisão e não recebem escolha automática.

Após sete dias consecutivos saudáveis em todas as contas, remova o bootstrap do `RbBillingWorker`, rotas exclusivas, aliases de templates, leitura de `rb.get_billing_info`, plaintext legado, `rb.lead_metadata` sem consumidores e `RB_BILLING_WORKER_ENABLED`. Essa etapa requer autorização operacional explícita e comprovação dos consumidores antes da remoção.

## 8. Segurança, segredos e LGPD

`collections` é acessado apenas pelo backend com service role; `anon` e `authenticated` não recebem acesso às tabelas nem às funções privilegiadas. Credenciais usam AES-256-GCM com ciphertext, IV, auth tag e versão de chave. Configure no backend:

```dotenv
COLLECTION_SECRETS_ENCRYPTION_KEY=<32 bytes em base64 ou 64 hex>
COLLECTION_SECRETS_ENCRYPTION_KEY_VERSION=v1
```

Nunca registre segredo, payload bruto, service role ou instruções completas de pagamento em logs. Logs usam IDs, hashes, contagens, códigos e tempos. A retenção dos dados normalizados deve seguir a matriz contratual da conta; solicitações LGPD devem preservar somente a auditoria mínima legal, com anonimização dos identificadores de contato quando aplicável.

Na rotação da chave de criptografia, mantenha o material da versão anterior disponível ao backend até recriptografar todas as credenciais; altere `key_version` somente junto com ciphertext, IV e auth tag na mesma operação controlada.

## 9. Dispatcher automático por fonte

`collections.resolve_source_dispatcher(source_connection_id)` é a única regra de roteamento. A conta pode ter RB e webhook ao mesmo tempo; cada fonte é resolvida de forma independente:

| Condição da fonte | Comportamento interno | Resultado operacional |
| --- | --- | --- |
| webhook ou arquivo ativos | fluxo canônico | ingere e pode agendar cobrança |
| RB ativo e preparado pelo backend | fluxo canônico | faz pull e pode agendar cobrança |
| RB ativo ainda não migrado | fluxo legado | worker legado pode operar somente essa fonte |
| fonte pausada/desativada ou conta em pausa emergencial | sem despacho | não cria novas execuções nem envia mensagens |
| RB sem credencial válida ou com Cobrança RB desligada | sem despacho | aguarda regularização sem cobrança parcial |

Ingestão, elegibilidade, pull, criação de execução e validação antes do envio consultam essa resolução. O worker legado consulta a mesma função antes de operar e não executa uma fonte RB que já esteja no fluxo canônico. O controle global permanece somente como pausa emergencial; o usuário não configura Dispatcher.

A interface comum mostra apenas fontes, regras, histórico e alertas. Os termos técnicos `canonical`, `legacy_rb` e `cutover` ficam restritos a rotas administrativas, auditoria e runbooks internos. Quando algo estiver incompleto, a tela deve apresentar estados operacionais como `Aguardando configuração do agente`, `Aguardando regra de cobrança`, `Fonte pausada`, `Credencial inválida` ou `Cobrança pronta`.

## 10. Preflight e rollout

Antes de habilitar uma conta de teste:

1. confira o histórico e o status das migrations;
2. execute o schema preflight e os testes de contrato/segurança;
3. configure uma conta com uma fonte RB e uma fonte webhook;
4. valide que cada fonte ingere, cria casos, resolve sua regra e segue seu próprio fluxo;
5. confirme que pausa global bloqueia todas as fontes e pausa individual bloqueia somente a fonte selecionada.

Durante o rollout, monitore ingestões aceitas/falhas, outbox pendente, fontes stale, execuções canceladas antes do envio, erros de credencial, pulls RB e mensagens efetivamente enviadas. O cutover manual continua reservado a contas antigas ou incidentes e não deve ser exposto como configuração de rotina.
