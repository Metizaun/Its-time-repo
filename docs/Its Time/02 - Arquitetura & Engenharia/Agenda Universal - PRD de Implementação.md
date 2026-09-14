---
title: "Agenda Universal — PRD de Implementação"
tags:
  - project/its-time
  - type/prd
status: "draft"
last_updated: 2026-09-11
author: "Equipe Its Time"
---

# Agenda Universal — PRD de Implementação

## 1. Objetivo

Transformar a agenda do Its Time em um sistema de registro plugável: qualquer ferramenta de terceiro — sistema de atendimento, prontuário, ERP de clínica — consegue manter um espelho fiel da nossa agenda e devolver o resultado do atendimento implementando um contrato único e público.

O caso que origina o projeto: o cliente agenda conosco, por IA ou manualmente, e o atendimento acontece na ferramenta do parceiro. Hoje essa ponte não existe — o agendamento morre no nosso banco e alguém redigita do outro lado.

O objetivo não é integrar com um parceiro específico. É publicar um padrão e deixar de ser o gargalo: quem quiser se acoplar implementa o contrato, sem projeto sob medida do nosso lado a cada parceiro novo.

## 2. Princípios não negociáveis

### 2.1 Nós somos a autoridade da agenda

| Domínio                                              | Quem decide | Como flui                  |
| ---------------------------------------------------- | ----------- | -------------------------- |
| Quem pode agendar, em que horário                    | Its Time    | sai de nós para o parceiro |
| Unidades, profissionais, grade de horário            | Its Time    | sai de nós para o parceiro |
| Paciente vinculado ao agendamento                    | Its Time    | sai de nós para o parceiro |
| Resultado final do atendimento (`done` ou `no_show`) | Parceiro    | volta do parceiro para nós |

A integração é bidirecional, mas assimétrica por desenho. O parceiro não cria agendamento, não altera horário e não edita configuração. Ele espelha o que mandamos e reporta o que aconteceu na sala de atendimento — a única informação que ele tem e nós não.

O motivo é técnico, não político: a verificação de conflito de horário acontece em uma constraint de exclusão no nosso banco, dentro da transação que cria o agendamento. Se uma segunda fonte puder escrever agendamentos, essa garantia deixa de valer e passamos a ter dois sistemas disputando o mesmo horário sem árbitro.

### 2.2 Os identificadores são nossos

Todo identificador de agendamento, unidade, profissional, assignment, serviço e paciente que aparece no contrato é nosso UUID. Recursos que admitem local independente podem ter `unitId` nulo, mas continuam referenciados pelo nosso `assignmentId`. Não guardamos o identificador interno do parceiro e não traduzimos códigos.

Quando o parceiro precisa relacionar o nosso UUID ao registro dele, a tabela de correspondência fica do lado dele. No retorno, ele é obrigado a referenciar o nosso `appointmentId`. Sem esse campo, a requisição é recusada — não tentamos adivinhar o agendamento por telefone, data e profissional.

Isso elimina a camada de tradução por parceiro, que é exatamente a camada que faria a integração virar projeto sob medida a cada cliente novo.

### 2.3 Dois endpoints, muitos eventos

A integração inteira tem duas URLs, e apenas duas, independentemente de quantos recursos o contrato passe a cobrir:

```text
saída:    POST  {url_do_parceiro}
entrada:  POST  {CRM_BACKEND_URL}/api/integrations/agenda/v1/connections/{publicConnectionId}/events
```

O que varia entre uma notificação de profissional novo e uma de agendamento cancelado é o campo `eventType` dentro do envelope, nunca o endereço. A seção 3 detalha por que essa escolha é o que impede a proliferação de endpoints.

### 2.4 O tenant nunca vem do payload

A conta é resolvida exclusivamente pela conexão autenticada. `agenda_sync.connections` guarda o `aces_id`, e toda consulta ou atualização feita pelo backend — inclusive o lookup por `appointmentId` — combina o identificador do recurso com o `aces_id` resolvido. Isso é obrigatório porque o backend usa credencial privilegiada e não pode depender de RLS para isolamento.

Qualquer tentativa de enviar `aces_id`, identificadores internos ou empresa de outra conta no corpo é recusada como payload inválido e auditada; o valor nunca é usado para roteamento. Mesma regra já aplicada na cobrança plugável.

Uma conexão pode cobrir a conta inteira, incluindo locais independentes (`all_resources`), ou somente unidades e locais independentes selecionados (`selected_scope`). No segundo caso, apenas unidades, assignments independentes, profissionais, grades, pacientes e agendamentos relacionados ao escopo vinculado podem ser exportados. As relações ficam em `agenda_sync.connection_units` e `agenda_sync.connection_assignments`; o escopo nunca é inferido do corpo recebido.

### 2.5 A Agenda Universal vive em Conexões

A superfície administrativa faz parte da página existente **Conexões** (`/conexoes`), disponível somente para administradores. A Agenda Universal aparece como um card no bloco **Integrações**, seguindo o mesmo catálogo e o mesmo resumo de estados já usados pelas demais conexões. Não haverá item novo na navegação lateral nem uma segunda área administrativa concorrente.

Ao abrir o card, o administrador entra na visão de gestão da Agenda Universal dentro de Conexões. Essa visão concentra cadastro, URL do parceiro, escopo de unidades, geração e rotação de segredos, teste de conexão, ativação, pausa, ressincronização, histórico de entregas e tratamento de dead letters.

## 3. Por que isso não vira mil endpoints

Essa é a preocupação central do projeto e merece resposta explícita, em três camadas.

### 3.1 Endpoint não é a unidade de extensão — evento é

Um desenho ingênuo criaria `/pacientes`, `/profissionais`, `/horarios`, `/agendamentos`, `/cancelamentos`, e assim por diante, cada um com autenticação, versão, documentação e teste próprios. Vinte recursos viram vinte integrações para manter.

Aqui existe um endpoint de entrada e um de saída. Tudo trafega no mesmo envelope, com a mesma assinatura, a mesma idempotência e o mesmo tratamento de erro. Acrescentar um recurso ao contrato significa acrescentar um valor novo em `eventType` — nenhum endpoint novo, nenhuma mudança de autenticação, nenhum retrabalho para o parceiro que não se importa com aquele recurso.

Para que isso funcione na prática, o contrato obriga o consumidor a ignorar `eventType` desconhecido respondendo `200`. Sem essa regra escrita, qualquer evento novo quebraria integrações antigas e nós ficaríamos presos ao contrato do primeiro dia.

### 3.2 Cada recurso tem núcleo canônico e área livre

Os campos de um recurso vivem em três níveis:

| Nível                | O que é                                             | Exemplo                                       | Quem garante     |
| -------------------- | --------------------------------------------------- | --------------------------------------------- | ---------------- |
| Canônico obrigatório | fato estrutural, sempre presente, tipado e validado | `patient.name`, `patient.phoneE164`           | contrato v1      |
| Canônico opcional    | semântica fixa, valor pode ser nulo                 | `patient.birthDate`, `patient.document`       | contrato v1      |
| `metadata`           | campo específico da conta ou da vertical            | `convenio`, `indicadoPor`, `numeroProntuario` | acordo bilateral |

O `metadata` responde à necessidade de levar informação que ainda não é padrão, sem versionar o contrato e sem renegociar com todos os parceiros. Ele segue os mesmos limites já adotados na cobrança: no máximo 32 chaves por objeto, profundidade 3, listas de até 50 itens e 16 KiB depois de normalizado.

### 3.3 Regra de governança do metadata

`metadata` é transporte informativo. Não é o lugar de campo que vira regra.

No momento em que um campo passa a ser usado pelo parceiro para decidir, filtrar, faturar ou bloquear alguma coisa, ele deve ser promovido a canônico opcional em uma versão menor do contrato — `1.1`, aditiva, que não quebra ninguém. Sem essa regra, em dois anos o `metadata` vira um schema paralelo não documentado e a integração volta a ser sob medida por parceiro.

### 3.4 Onde mora cada dado citado

Os exemplos levantados na definição do escopo, mapeados contra o que existe hoje:

| Dado                              | Onde mora no contrato       | Origem no nosso banco                  | Situação                  |
| --------------------------------- | --------------------------- | -------------------------------------- | ------------------------- |
| Nome                              | `patient.name`              | `crm.leads.name`                       | existe                    |
| Telefone                          | `patient.phoneE164`         | `crm.leads.contact_phone`              | existe                    |
| Idade                             | `patient.birthDate`         | —                                      | campo novo, ver seção 5   |
| CPF                               | `patient.document`          | não capturado no fluxo de agenda       | opcional, nulo por padrão |
| Valor da consulta                 | `appointment.service.price` | `calendar.events.price_cents_snapshot` | existe                    |
| Unidade de referência do paciente | `patient.homeUnitId`        | `crm.leads.empresa_id`                 | existe, pode ser nula     |

Duas correções de modelagem relevantes, porque mudam onde o dado vive:

**Idade é derivada; data de nascimento é fato.** Enviar `age: 34` significa enviar um número que fica errado sozinho: em algum momento o paciente faz aniversário, o parceiro continua guardando 34 e ninguém percebe o erro. O contrato transporta `birthDate` no formato `YYYY-MM-DD` e quem precisa da idade calcula na hora da leitura. Custo idêntico, classe inteira de erro eliminada.

**Valor da consulta pertence ao agendamento, não ao paciente.** O mesmo paciente tem preços diferentes conforme serviço, profissional e data, e o preço de tabela muda ao longo do tempo. Por isso o valor já é congelado por agendamento em `price_cents_snapshot` no momento da marcação — é esse valor acordado que viaja, não o preço atual do catálogo.

## 4. Contrato canônico v1

### 4.1 Envelope

Um evento por requisição. Sem lote na v1 — a ordem importa e o lote a torna ambígua.

```json
{
  "schemaVersion": "1.0",
  "eventId": "9f1c7c4e-2a3b-4d51-9e77-1b5c0a2f8d34",
  "eventType": "appointment.created",
  "occurredAt": "2026-09-11T14:30:00-03:00",
  "resourceVersion": 7,
  "resource": {}
}
```

| Campo             | Obrigatório  | Regra                                                                                                                                                                                  |
| ----------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion`   | sim          | Sempre `"1.0"` na v1.                                                                                                                                                                  |
| `eventId`         | sim          | UUID único do evento. É também o valor obrigatório do cabeçalho `Idempotency-Key`. Permanece igual em toda retentativa da mesma entrega.                                               |
| `eventType`       | sim          | Valor do catálogo da seção 4.2. Desconhecido deve ser ignorado com `200`.                                                                                                              |
| `occurredAt`      | sim          | ISO 8601 com timezone. Registra quando a mudança ocorreu, mas não é usado sozinho para resolver concorrência.                                                                          |
| `resourceVersion` | sim na saída | Inteiro positivo e monotônico por `(aces_id, resourceType, resourceId)`, alocado na mesma transação da outbox. Permite ao consumidor descartar versões antigas sem confiar no relógio. |
| `resource`        | sim          | Objeto do recurso correspondente ao `eventType`.                                                                                                                                       |

Em `appointment.status_reported`, o parceiro envia `baseResourceVersion` dentro de `resource`, copiando a última versão de `appointment` que aplicou. O backend bloqueia a linha do agendamento e aplica a transição somente se a versão-base ainda for compatível; conflito responde `409 stale_resource_version` com a versão atual. Assim, `occurredAt` continua útil para auditoria, mas o relógio do parceiro não decide sozinho qual estado vence.

### 4.2 Catálogo de eventos

Saída, de nós para o parceiro:

| Evento                       | Para que serve                                                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `integration.test`           | Evento sem dado pessoal usado pela ação **Testar conexão** para validar URL, TLS, HMAC e resposta `2xx`; não altera catálogo nem ordem operacional.                                                               |
| `unit.upserted`              | Uma unidade foi criada, editada, desativada, ou teve um fechamento geral registrado — feriado ou bloqueio da unidade inteira. Mantém o cadastro de unidades do parceiro espelhado ao nosso.                       |
| `professional.upserted`      | Um profissional foi criado, editado, desativado, ou passou a atender — ou deixou de atender — em uma unidade. Mantém o cadastro de profissionais e seus vínculos espelhado.                                       |
| `availability.upserted`      | A grade semanal ou as exceções de um profissional em uma unidade mudaram: férias, pausa, bloqueio pessoal. Permite ao parceiro saber quando aquele profissional atende sem consultar nossa agenda em tempo real.  |
| `patient.upserted`           | Um paciente ganhou ou teve atualizado o registro necessário para receber um agendamento. Garante que o `appointment.created` seguinte não referencie um paciente inexistente do outro lado.                       |
| `appointment.created`        | Um agendamento foi confirmado do nosso lado. O parceiro registra o atendimento na agenda dele.                                                                                                                    |
| `appointment.rescheduled`    | Um agendamento existente mudou de data ou horário, mantendo o mesmo `appointmentId`. Evita que o parceiro trate como agendamento novo e perca o histórico.                                                        |
| `appointment.cancelled`      | Um agendamento foi cancelado do nosso lado. O parceiro libera o horário e remove o atendimento.                                                                                                                   |
| `appointment.status_changed` | O status mudou para `confirmed`, `done` ou `no_show` por decisão nossa — por exemplo, alguém registrou o comparecimento na nossa interface. Mantém o resultado sincronizado quando a origem da mudança somos nós. |

Entrada, do parceiro para nós:

| Evento                        | Para que serve                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `appointment.status_reported` | O parceiro registrou o resultado real do atendimento: concluído ou falta. É o único evento que flui na direção contrária, porque só quem atendeu o paciente sabe o resultado final. |

### 4.3 Recursos

**`integration.test`** — payload fixo, sem dado pessoal. Usa a mesma assinatura e os mesmos limites de entrega, mas é enviado fora da fila de catálogo quando a conexão está em `draft` ou `paused`.

```json
{
  "message": "Its Time Agenda Universal connection test"
}
```

**`unit`** — origem `crm.empresas` e as exceções de agenda com escopo de empresa.

```json
{
  "id": "b3f2...",
  "cnpj": "12345678000190",
  "name": "Clínica Centro",
  "address": "Rua X, 100",
  "city": "São Paulo",
  "state": "SP",
  "isActive": true,
  "closures": [
    {
      "type": "holiday",
      "startsAt": "2026-12-25T00:00:00-03:00",
      "endsAt": "2026-12-26T00:00:00-03:00",
      "reason": "Natal"
    }
  ],
  "metadata": {},
  "updatedAt": "2026-09-11T14:30:00-03:00"
}
```

**`professional`** — origem `calendar.professionals` e `calendar.professional_locations`.

```json
{
  "id": "77a1...",
  "name": "Dra. Fulana",
  "specialty": "Oftalmologia",
  "isActive": true,
  "assignments": [
    {
      "assignmentId": "c4d5...",
      "unitId": "b3f2...",
      "locationName": null,
      "isActive": true
    }
  ],
  "metadata": {},
  "updatedAt": "2026-09-11T14:30:00-03:00"
}
```

`unitId` é nulo quando o profissional atende em local próprio sem empresa cadastrada; nesse caso `locationName` carrega o rótulo.

**`availability`** — origem `calendar.availability_rules` e as exceções com escopo de profissional. O `assignmentId` identifica o par profissional-unidade.

```json
{
  "assignmentId": "c4d5...",
  "professionalId": "77a1...",
  "unitId": "b3f2...",
  "timezone": "America/Sao_Paulo",
  "weeklyGrid": [
    {
      "weekday": 1,
      "startTime": "08:00",
      "endTime": "12:00",
      "validFrom": null,
      "validUntil": null
    },
    {
      "weekday": 1,
      "startTime": "13:00",
      "endTime": "18:00",
      "validFrom": "2026-09-01",
      "validUntil": "2026-12-31"
    }
  ],
  "exceptions": [
    {
      "type": "vacation",
      "startsAt": "2026-12-20T00:00:00-03:00",
      "endsAt": "2027-01-05T00:00:00-03:00",
      "reason": "Férias"
    }
  ],
  "updatedAt": "2026-09-11T14:30:00-03:00"
}
```

`weekday` segue o padrão do banco: 0 é domingo, 6 é sábado. `validFrom` e `validUntil` preservam a vigência existente em `calendar.availability_rules`; ambos são nulos para uma regra recorrente sem limite. Apenas regras e exceções ativas entram no estado completo. Alterar o timezone da conta também gera novos `availability.upserted` para os assignments afetados.

**`patient`** — origem `crm.leads`.

```json
{
  "id": "51ab...",
  "name": "Maria Silva",
  "phoneE164": "+5511999999999",
  "birthDate": "1992-04-17",
  "document": null,
  "homeUnitId": "b3f2...",
  "metadata": { "convenio": "Particular" },
  "updatedAt": "2026-09-11T14:30:00-03:00"
}
```

`homeUnitId` é a unidade de referência do cadastro do paciente (`crm.leads.empresa_id`) e pode ser nulo. A unidade onde o atendimento ocorrerá pertence ao agendamento, em `appointment.unitId`; os dois valores não são presumidos iguais. Essa nomenclatura evita transformar uma preferência cadastral em localização do atendimento.

**`appointment`** — origem `calendar.events`.

```json
{
  "id": "8e0c...",
  "status": "scheduled",
  "startTime": "2026-09-18T14:00:00-03:00",
  "endTime": "2026-09-18T14:30:00-03:00",
  "timezone": "America/Sao_Paulo",
  "durationMinutes": 30,
  "unitId": "b3f2...",
  "locationName": null,
  "professionalId": "77a1...",
  "assignmentId": "c4d5...",
  "patientId": "51ab...",
  "service": {
    "id": "2f7d...",
    "name": "Consulta oftalmológica",
    "durationMinutes": 30,
    "price": "150.00",
    "currency": "BRL"
  },
  "origin": "ai",
  "notes": null,
  "cancelReason": null,
  "metadata": {},
  "updatedAt": "2026-09-11T14:30:00-03:00"
}
```

Em atendimento realizado em local próprio sem empresa cadastrada, `unitId` é nulo e `locationName` leva o rótulo de `calendar.professional_locations`. `service.price` é `string | null`, porque o banco permite serviço sem preço; quando presente, sempre usa duas casas decimais. `origin` aceita somente `manual`, `ai`, `api`, `import` ou `external`.

**`appointment.status_reported`** — o que o parceiro envia.

```json
{
  "appointmentId": "8e0c...",
  "status": "no_show",
  "reason": "Paciente não compareceu",
  "reportedAt": "2026-09-18T14:20:00-03:00",
  "baseResourceVersion": 7,
  "metadata": {}
}
```

Na v1, `status` de entrada aceita somente `done` ou `no_show`. `done` significa atendimento concluído e `no_show` significa ausência. `confirmed` continua sendo confirmação do agendamento sob autoridade do Its Time e viaja somente na saída. Cancelamento no balcão é registrado no parceiro como informação operacional, mas não altera a existência do agendamento no Its Time: o parceiro deve solicitar o cancelamento pelo fluxo humano acordado, e o cancelamento continua sendo autoridade nossa.

Campos obrigatórios, nullability, enums, limites de tamanho e regras condicionais — como `unitId` nulo exigir `locationName` — são normativos no JSON Schema/OpenAPI da v1. Os exemplos desta seção são ilustrativos e não substituem o schema executável.

### 4.4 Formatos e tipos

Herdados do contrato de cobrança, para não termos duas gramáticas na mesma casa:

- valores monetários são decimal em texto com ponto, acompanhados de `currency` ISO 4217: `"150.00"` e `"BRL"`. O banco guarda centavos em inteiro (`price_cents`); a conversão para texto com duas casas acontece na montagem do evento e é ponto obrigatório de teste;
- datas sem hora em `YYYY-MM-DD`;
- timestamps em ISO 8601 com timezone;
- horários da grade em `HH:MM`, 24 horas, interpretados no `timezone` do recurso;
- telefones em E.164, normalizados pela rotina central já existente;
- identificadores são UUID nossos, estáveis e nunca reutilizados.

Strings têm limites explícitos no JSON Schema: nomes e rótulos até 200 caracteres, textos livres e motivos até 2.000 caracteres, e documentos/telefones conforme seu formato canônico. `metadata` precisa ser objeto JSON e respeita 32 chaves, profundidade 3, listas de até 50 itens e 16 KiB após normalização; valores reservados de autorização, tenant ou roteamento são recusados.

### 4.5 Compatibilidade e evolução

O contrato evolui sem quebrar consumidores desde que as regras abaixo sejam respeitadas dos dois lados:

- o consumidor ignora `eventType` desconhecido e responde `200`;
- o consumidor ignora campo desconhecido dentro de um recurso conhecido;
- nós só acrescentamos campos opcionais em versões menores. Remover campo ou mudar tipo exige `schemaVersion` maior e convivência das duas versões durante a transição;
- estado sempre completo: cada evento carrega o estado atual inteiro do recurso, não um diff. Se uma regra de horário some, o próximo `availability.upserted` simplesmente não a inclui. Isso elimina eventos de remoção e torna qualquer reenvio autocorretivo;
- retentar a mesma entrega reutiliza o mesmo `eventId`; uma ressincronização manual cria eventos e versões novos. A segurança da ressincronização vem do upsert por UUID do recurso e da versão monotônica, não da repetição do `eventId` antigo;
- remoções físicas de unidade, profissional ou assignment são evitadas no fluxo normal. Quando inevitáveis, o gatilho emite um tombstone usando `OLD`, representado como `isActive: false` e `deletedAt`, para que o parceiro remova o estado antigo.

## 5. Campos que ainda não existem no nosso banco

Levantamento feito contra o schema atual:

| Necessidade            | Situação                                                                                       | Ação                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `patient.birthDate`    | `crm.leads` não tem data de nascimento nem qualquer mecanismo de campo customizado             | acrescentar `birth_date date NULL` em `crm.leads`                                                          |
| `patient.document`     | só existe CPF vindo do fluxo de cobrança (`rb.lead_metadata.cpf_cnpj`), não do fluxo de agenda | manter nulo na v1; o campo existe no contrato e é preenchido quando houver captura                         |
| `metadata` por recurso | não existe para unidade, profissional e paciente                                               | coluna `jsonb` própria, no padrão do `metadata` já presente em `calendar.events`                           |
| Versão monotônica      | os recursos de origem não possuem uma versão compartilhada para integração                     | criar `agenda_sync.resource_versions`, incrementada na mesma transação que grava a outbox                  |
| Escopo de exportação   | conexão ainda não possui vínculo com unidades ou locais independentes autorizados              | criar `scope_mode` em `connections`, `agenda_sync.connection_units` e `agenda_sync.connection_assignments` |

`birthDate`, `document` e `metadata` de negócio não bloqueiam o primeiro envio porque o contrato aceita nulo ou objeto vazio. Versão monotônica e escopo da conexão são bloqueantes para ativação: nenhuma conexão entra em `active` sem ambos.

Todas as colunas `metadata` têm `NOT NULL DEFAULT '{}'::jsonb`, `CHECK (jsonb_typeof(metadata) = 'object')` e validação dos limites do contrato na função compartilhada de normalização. A migration faz preflight dos dados existentes antes de endurecer constraints de escopo ou nullability.

## 6. Transporte e segurança

### 6.1 Assinatura

Igual à cobrança, nos dois sentidos:

```http
POST /api/integrations/agenda/v1/connections/{publicConnectionId}/events
Content-Type: application/json
Idempotency-Key: 9f1c7c4e-2a3b-4d51-9e77-1b5c0a2f8d34
X-Agenda-Timestamp: 1789476600
X-Agenda-Signature: sha256=hexadecimal
```

A assinatura é `HMAC-SHA256(secret, timestamp + "." + rawBody)`. O corpo assinado precisa ser exatamente o corpo transmitido, sem reserialização. O timestamp aceita segundos ou milissegundos e precisa estar dentro da janela de cinco minutos. `Idempotency-Key` deve ser um UUID e deve ser byte a byte igual ao `eventId` do envelope; divergência responde `400`.

Quando nós entregamos ao parceiro, usamos os mesmos cabeçalhos com o segredo de saída da conexão. Uma implementação de verificação serve para as duas direções, o que reduz o esforço do parceiro e o nosso.

O módulo `Project/IA/collections/webhook-security.ts` já implementa assinatura, janela de replay e suporte a múltiplos segredos simultâneos. Ele deve ser promovido a módulo compartilhado, não duplicado.

### 6.2 Segredos e rotação

Cada conexão tem dois segredos independentes: um para o que enviamos e um para o que recebemos. Ambos são guardados com AES-256-GCM, com ciphertext, IV, auth tag e versão de chave, seguindo o padrão já usado em `collections.source_credentials`.

Na rotação, o segredo anterior permanece válido por 24 horas e o novo é exibido uma única vez. Segredo não entra em frontend, migration, repositório ou log.

Se `agenda_sync` for acessado pelo backend através de `supabase-js`/PostgREST, o schema entra explicitamente em `pgrst.db_schemas` e `pgrst.db_extra_search_path`, e `authenticator` recebe somente `USAGE` para descoberta do schema. Tabelas e funções revogam privilégios de `PUBLIC`, `anon` e `authenticated`; apenas `service_role` recebe o mínimo necessário. Se o backend usar conexão PostgreSQL direta, o schema permanece fora do Data API. Em ambos os casos, RLS fica habilitada como defesa em profundidade e toda operação privilegiada filtra explicitamente por `aces_id`.

### 6.3 Conteúdo externo é entrada não confiável

Nome, motivo de cancelamento e `metadata` recebidos do parceiro são dados, nunca instrução. Esse conteúdo não entra em prompt de agente sem tratamento, não altera regra, não concede permissão e não decide roteamento. Mesma postura já adotada para payload bruto na cobrança.

### 6.4 URL de saída e SSRF

A URL do parceiro é entrada administrativa não confiável. Em produção ela deve usar HTTPS, sem credenciais embutidas e sem fragmento. No cadastro, no teste e em cada mudança de DNS, o backend bloqueia loopback, redes privadas, link-local, multicast, portas não permitidas e endpoints de metadata de nuvem. Redirects ficam desabilitados por padrão; se forem permitidos futuramente, cada destino é validado novamente antes de seguir.

O worker aplica timeout de conexão e resposta, limite de corpo de resposta, validação TLS e isolamento de egress. O endpoint de entrada aceita somente `application/json`, possui limite de corpo compatível com os 16 KiB de metadata, rate limit por conexão e IP e rejeita conteúdo excedente com `413`.

### 6.5 Privacidade e retenção

Cada conexão exporta apenas os campos canônicos necessários e somente pacientes que possuam relação real com a agenda e com as unidades autorizadas. Corpo bruto não é persistido em log. Histórico guarda hashes, códigos, latência e trechos de resposta truncados e sanitizados; acesso ao histórico é restrito a administradores e auditado.

O prazo de retenção de `deliveries` e `inbound_events` precisa ser definido antes da ativação em produção, junto com a base legal, contrato de tratamento com o parceiro e procedimento de exclusão/anonimização. A política escolhida vira configuração operacional e job de limpeza testado.

### 6.6 Respostas do nosso endpoint

| HTTP  | Significado                                                          | Ação do parceiro                                                                 |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `200` | `eventType` desconhecido foi ignorado e registrado para idempotência | Não repetir.                                                                     |
| `202` | Evento conhecido aceito ou repetição idempotente do mesmo conteúdo   | Registrar o recibo.                                                              |
| `400` | JSON, cabeçalho ou `Idempotency-Key` inválido                        | Corrigir a requisição, não repetir.                                              |
| `401` | URL, timestamp ou assinatura inválidos                               | Conferir segredo, relógio e bytes assinados.                                     |
| `404` | `appointmentId` desconhecido                                         | Não repetir; reconciliar do lado do parceiro.                                    |
| `409` | `idempotency_conflict` ou `stale_resource_version`                   | Não repetir cegamente; reconciliar usando o código e a versão atual da resposta. |
| `413` | Corpo acima do limite                                                | Reduzir o payload, não repetir igual.                                            |
| `415` | `Content-Type` não suportado                                         | Enviar `application/json`.                                                       |
| `422` | Transição de status inválida para o estado atual                     | Não repetir; ver seção 8.                                                        |
| `429` | Limite temporário excedido                                           | Reenviar após `Retry-After`, com backoff.                                        |
| `503` | Conexão pausada ou indisponível                                      | Reenviar depois, mesmo corpo e mesma chave.                                      |

## 7. Entrega, ordem e ressincronização

### 7.1 A captura é no banco, não na aplicação

Existem hoje caminhos diferentes que escrevem em `calendar.events`: a interface cria eventos genéricos diretamente via RLS e cria agendamentos profissionais por RPC; o agente de IA usa RPC com service role; e workers também podem alterar status. Não existe uma única rota de aplicação que concentre essas mutações.

Portanto o ponto de captura precisa ser o banco. Um gatilho grava na outbox dentro da mesma transação da mudança, e um worker entrega. O gatilho de `calendar.events` possui um predicado explícito de elegibilidade: só considera agendamento profissional quando `professional_id`, `professional_location_id` e `service_id` estão preenchidos e `deleted_at` é nulo. Eventos genéricos nunca são exportados como `appointment`.

Atualizar `deleted_at` de um agendamento já exportado gera `appointment.cancelled` com motivo técnico de remoção. Alterações que fazem um registro entrar ou sair do predicado de elegibilidade são tratadas como criação ou cancelamento, respectivamente.

### 7.2 Ordem

Eventos de uma mesma conexão são entregues em série, um de cada vez, pela coluna monotônica `sequence` da outbox. `created_at` e `occurredAt` não são usados como desempate. Entrega paralela dentro da mesma conexão está proibida: o `appointment.created` poderia ultrapassar o `patient.upserted` e o parceiro receberia um agendamento apontando para um paciente que ele ainda não conhece.

A regra de precedência é: recurso referenciado chega antes do recurso que o referencia. Na prática, `patient.upserted` é enfileirado imediatamente antes do `appointment.created`, na mesma execução do gatilho e com sequências consecutivas. O claim do worker usa lease recuperável e impede duas instâncias de processarem simultaneamente a cabeça da mesma conexão, sem bloquear conexões diferentes.

### 7.3 Ressincronização

A outbox só captura mudanças futuras. Uma conexão nova não conhece nada do que já existe, então a ativação usa um protocolo com fence para não perder mudanças concorrentes:

1. a conexão entra em `syncing`, ainda sem entrega normal;
2. a transação de início registra o watermark da sequência e passa a capturar os deltas seguintes;
3. o worker enfileira o snapshot das unidades autorizadas, profissionais, grades, pacientes necessários e agendamentos futuros/ativos, nessa ordem;
4. depois do snapshot, entrega os deltas posteriores ao watermark;
5. somente quando snapshot e deltas terminam a conexão passa para `active`.

A mesma operação fica disponível como ação manual para quando o parceiro perder sincronismo por qualquer motivo. A ressincronização cria novos eventos com novas versões; ela é segura porque o parceiro faz upsert pelo UUID canônico e ignora versões inferiores, não porque os novos eventos repetem `eventId` antigo.

### 7.4 Retentativa

Resposta `2xx` do parceiro encerra a entrega. Timeout, falha de rede, `408`, `425`, `429` e `5xx` geram retentativa com backoff exponencial e jitter; `Retry-After` válido é respeitado. Outros `4xx` são falhas permanentes e vão diretamente para dead letter. A política inicial é oito tentativas dentro de até 24 horas, com timeout e limites configuráveis por ambiente, nunca pelo payload do parceiro.

Esgotadas as tentativas, o evento vai para dead letter, a conexão é marcada como `error` e um alerta é aberto. A fila daquela conexão não avança até um administrador escolher **Tentar novamente** ou **Ignorar e avançar** com confirmação e motivo auditado. Uma conexão parada nunca bloqueia o processamento de outra conexão.

### 7.5 Prevenção de eco

O endpoint aplica o status por uma única função transacional: valida conexão e escopo, insere `inbound_events`, bloqueia o agendamento, confere `baseResourceVersion`, valida a transição, atualiza o status e grava a nova versão. A função define uma marca transacional com o `origin_connection_id`; o gatilho não devolve o evento para a conexão que o enviou, mas ainda o entrega a outras conexões autorizadas que cubram o mesmo agendamento.

Sem isso, o ciclo é imediato: o parceiro reporta falta, nós gravamos, o gatilho dispara `appointment.status_changed`, o parceiro recebe de volta o que ele mesmo mandou. O `Project/IA/outbound-echo-registry.ts` é apenas precedente conceitual; o registro de agenda não reutiliza sua janela Redis/fingerprint, porque a prevenção precisa ocorrer na mesma transação do banco.

### 7.6 Observabilidade

As métricas mínimas por conexão são profundidade da fila, idade do evento mais antigo, taxa de sucesso, latência de entrega, número de retentativas, dead letters e tempo desde o último sucesso. Alertas usam esses indicadores, sem incluir payload ou dado pessoal. Toda entrega recebe `eventId` como correlation ID nos logs estruturados; `connection_id` interno pode ser registrado, mas segredo, URL com credencial, assinatura, corpo bruto e resposta completa nunca entram em log.

## 8. Máquina de estados e conflito

```text
scheduled ──→ confirmed
    │             │
    ├─────────────┼──→ done
    ├─────────────┼──→ no_show
    └─────────────┴──→ cancelled
```

`done`, `no_show` e `cancelled` são terminais no fluxo normal e não regridem por webhook.

A concorrência usa `resourceVersion` e bloqueio transacional, não a ordem de chegada nem `occurredAt`. O parceiro informa `baseResourceVersion`; versão incompatível recebe `409`, é auditada e não altera o estado. `reportedAt` não pode estar mais de cinco minutos no futuro e serve apenas para auditoria e regras temporais, como impedir `done`/`no_show` antes do início do atendimento.

Na disputa entre os dois lados, horário, reagendamento e cancelamento são nossos; chegada e resultado do atendimento são do parceiro. Uma transição inválida — reportar `done` sobre um agendamento já cancelado, por exemplo — responde `422`, é registrada e não muda estado. Devolver erro de servidor nesse caso faria o parceiro retentar indefinidamente um evento que nunca será aceito.

Correções de `done`, `no_show` ou `cancelled` exigem ação administrativa explícita em Conexões ou na agenda, com motivo obrigatório, ator, estado anterior e novo estado na auditoria. Essa correção gera nova `resourceVersion` e evento para todas as conexões aplicáveis.

## 9. Modelo de dados interno

Schema privado `agenda_sync`, acessado apenas pelo backend com credencial de servidor. Todas as tabelas carregam `aces_id` diretamente ou por chave estrangeira composta e revogam privilégios de `PUBLIC`, `anon` e `authenticated`.

| Tabela                   | Papel                                                                                                                                                                                                                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connections`            | `id`, `public_id` aleatório com pelo menos 128 bits, `aces_id`, nome, URL de saída, `scope_mode` (`all_resources` ou `selected_scope`), status (`draft`, `syncing`, `active`, `paused`, `error`, `disabled`), timezone padrão, watermark e marcas de última entrega e último erro |
| `connection_units`       | vínculo composto entre conexão e unidades autorizadas, sempre validando o mesmo `aces_id`                                                                                                                                                                                         |
| `connection_assignments` | vínculo opcional com assignments de local independente (`unitId` nulo), sempre validando conexão, assignment e `aces_id`                                                                                                                                                          |
| `credentials`            | segredos independentes de entrada e saída, AES-256-GCM, com rotação, status, validade e versão de chave                                                                                                                                                                           |
| `resource_versions`      | versão monotônica por tenant, tipo e UUID de recurso; incrementada dentro da transação de captura                                                                                                                                                                                 |
| `outbox`                 | `connection_id`, `aces_id`, `sequence`, `event_id`, tipo, agregado, versão, envelope imutável, hash, status, tentativa, `available_at`, lease e erro                                                                                                                              |
| `deliveries`             | histórico por tentativa: conexão, evento, número da tentativa, status HTTP, duração, resposta truncada/sanitizada e erro                                                                                                                                                          |
| `inbound_events`         | recebimentos: conexão, `event_id`, hash do corpo, `base_resource_version`, desfecho, código de erro e agendamento resolvido                                                                                                                                                       |

Não existe tabela de correspondência de identificadores externos, por decisão da seção 2.2. Não existe adaptador por parceiro: há um único formato de saída e um único formato de entrada.

As unicidades mínimas são `(connection_id, event_id)` para entrada e saída, `(connection_id, sequence)` para ordenação e `(aces_id, resource_type, resource_id)` para versão. Repetir o mesmo `event_id` e hash retorna o recibo anterior; repetir o `event_id` com hash diferente retorna `409 idempotency_conflict`.

O worker reserva apenas o menor `sequence` pendente de cada conexão, usando `FOR UPDATE SKIP LOCKED` e lease com expiração. Operações privilegiadas ficam em funções no schema privado, com `search_path = ''`, `EXECUTE` revogado de `PUBLIC` e parâmetros de tenant/conexão validados por chave composta.

## 10. Superfície de gatilhos

| Tabela de origem                                                  | Operação                                                                           | Evento gerado                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `crm.empresas`                                                    | insert, update, delete                                                             | `unit.upserted`; delete usa tombstone derivado de `OLD`                 |
| `calendar.availability_exceptions` com `empresa_id`               | insert, update, delete                                                             | `unit.upserted`                                                         |
| `calendar.professionals`                                          | insert, update, delete                                                             | `professional.upserted`; delete usa tombstone                           |
| `calendar.professional_locations`                                 | insert, update, delete                                                             | `professional.upserted` e `availability.upserted` do assignment afetado |
| `calendar.availability_rules`                                     | insert, update, delete                                                             | `availability.upserted`                                                 |
| `calendar.availability_exceptions` com `professional_location_id` | insert, update, delete                                                             | `availability.upserted`                                                 |
| `calendar.settings`                                               | update de timezone                                                                 | `availability.upserted` para todos os assignments afetados              |
| `calendar.events` elegível                                        | insert                                                                             | `patient.upserted` seguido de `appointment.created`                     |
| `calendar.events` elegível                                        | update de horário                                                                  | `appointment.rescheduled`                                               |
| `calendar.events` elegível                                        | update de status                                                                   | `appointment.cancelled` ou `appointment.status_changed`                 |
| `calendar.events` elegível                                        | preenchimento de `deleted_at`                                                      | `appointment.cancelled`                                                 |
| `crm.leads` com paciente já exportável                            | update de nome, telefone, nascimento, documento, unidade de referência ou metadata | `patient.upserted` somente para conexões relacionadas                   |

Não existe gatilho amplo em `crm.leads`. Essa é a tabela de todo o CRM, com leads de vendas, atendimento e prospecção que nunca terão agendamento. O gatilho observa apenas campos canônicos e só enfileira quando existe agendamento elegível ligado ao lead e à conexão/unidade em questão. O primeiro `patient.upserted` continua nascendo junto do agendamento; atualizações posteriores passam a manter o espelho fiel sem exportar leads alheios à agenda.

Na v1, `calendar.availability_exceptions` deve ter exatamente um escopo: `empresa_id` ou `professional_location_id`. A migration faz preflight de linhas com ambos nulos antes de substituir a constraint atual de “no máximo um” por “exatamente um”.

## 11. OpenAPI e Swagger

### 11.1 O que é, em linguagem simples

OpenAPI, popularmente chamado de Swagger, é um arquivo que descreve a API inteira em um formato padronizado que máquinas conseguem ler: quais endereços existem, quais campos cada um aceita, quais são obrigatórios, que tipo de dado cada um carrega, quais erros podem voltar e exemplos reais de uso.

É a diferença entre entregar ao parceiro um documento em prosa, que ele lê e interpreta, e entregar um arquivo que as ferramentas dele consomem direto.

A partir desse único arquivo saem, sem trabalho adicional:

- uma página de documentação navegável, onde o parceiro vê cada campo e testa chamadas no navegador;
- uma coleção Postman pronta, que reduz o primeiro teste de dias para minutos;
- validação automática dos exemplos contra o contrato;
- geração de código cliente em várias linguagens;
- uma fonte estruturada que agentes de IA leem para implementar a integração com pouca intervenção humana — cada vez mais o caminho real pelo qual a integração vai ser feita do outro lado.

### 11.2 O que ele não resolve

O OpenAPI descreve o contrato; ele não o aplica. Assinatura HMAC, janela de replay, idempotência, autorização, isolamento por conta e regra de negócio continuam sendo responsabilidade do backend e dos testes. Tratar a especificação como se fosse segurança é o erro clássico, e o mapeamento de cobrança já registra essa ressalva corretamente.

### 11.3 Decisão para a agenda

O documento de cobrança recomendou adiar o OpenAPI, e a recomendação estava certa no contexto dela: aquela API não era oferecida publicamente, era usada por integrações acompanhadas caso a caso.

Aqui a premissa é oposta. O objetivo declarado deste projeto é que terceiros se acoplem sem nós no meio. Nesse cenário o OpenAPI deixa de ser documentação e passa a ser o próprio produto de integração — é o que torna o autoatendimento viável e o que evita que cada parceiro novo vire uma reunião.

Portanto: a especificação OpenAPI 3.1 entra na v1, versionada no repositório junto com o código, cobrindo o webhook de entrada, o formato de saída em `webhooks`, todos os recursos do catálogo e os códigos de erro. JSON Schemas e exemplos são validados em CI contra a implementação. Os endpoints administrativos de conexão ficam fora da especificação pública até que se decida quais serão expostos.

## 12. Experiência administrativa em Conexões

### 12.1 Entrada e organização

Na rota existente `/conexoes`, o bloco **Integrações** ganha o card **Agenda Universal**. O card usa os estados visuais já existentes na aplicação:

| Estado visual    | Estado operacional                                |
| ---------------- | ------------------------------------------------- |
| `not_configured` | nenhuma conexão cadastrada                        |
| `pending`        | `draft` ou `syncing`                              |
| `connected`      | ao menos uma conexão `active` sem erro bloqueante |
| `attention`      | conexão `error` ou dead letter pendente           |
| `disabled`       | todas as conexões `paused` ou `disabled`          |

O resumo superior de Conexões inclui as conexões de agenda nas contagens de ativas, pendentes e com erro. Ao selecionar o card, a página abre a gestão da Agenda Universal dentro do mesmo contexto de Conexões, com ação clara para voltar ao catálogo.

### 12.2 Lista e detalhe

A visão lista uma linha/card por conexão, mostrando nome, unidades vinculadas, status, última entrega bem-sucedida, fila pendente e último erro. Em desktop pode usar tabela; abaixo de 640px vira cards empilhados. O detalhe da conexão organiza:

- **Configuração:** nome, URL HTTPS e escopo `all_resources` ou seleção de unidades e locais independentes;
- **Autenticação:** geração/rotação separada dos segredos de entrada e saída, exibidos uma única vez com confirmação de cópia;
- **Operação:** testar conexão, ativar, pausar, retomar e ressincronizar;
- **Entregas:** histórico filtrável por evento, status e período, sem payload pessoal bruto;
- **Dead letters:** erro sanitizado, número de tentativas, **Tentar novamente** e **Ignorar e avançar**;
- **Auditoria:** alterações de configuração, rotação, correções de estado e ações destrutivas.

Somente administradores acessam ou executam essas ações. Ativar exige URL validada, ao menos um segredo em cada direção e escopo válido. Ressincronizar, ignorar dead letter, desativar e corrigir estado terminal exigem modal de confirmação; ignorar/corrigir também exige motivo.

### 12.3 Estados e design

A implementação reutiliza `ConnectionCard`, componentes shadcn/Radix, Lucide e tokens existentes. O fundo da página permanece `bg-base`; cards usam `surface-1` e elevação Soft UI; laranja é reservado ao CTA principal; sucesso, aviso e erro usam apenas cores semânticas. Todos os controles cobrem default, hover, focus-visible, disabled, loading e erro, respeitam `prefers-reduced-motion` e funcionam nos breakpoints de 1280px, 1024px, 768px e mobile.

Durante `syncing`, a interface mostra progresso por etapa — catálogo, deltas e ativação — sem prometer porcentagem quando o total não é conhecido. Durante `error`, mantém leitura e diagnóstico disponíveis, desabilitando somente ações incompatíveis com o estado atual.

## 13. Fases

| Fase | Entrega                                                                                                                         | Depende de terceiro |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 0    | Contrato v1 e JSON Schema/OpenAPI executáveis; enums, nullability, limites, preflight de dados e versão da plataforma definidos | não                 |
| 1    | Banco: schema privado, escopo de exportação, versões, gatilhos filtrados, outbox ordenada e testes SQL                          | não                 |
| 2    | Saída: worker com lease por conexão, HMAC, SSRF, retentativa classificada, histórico e dead letters                             | não                 |
| 3    | Entrada: endpoint assinado, idempotência, concorrência por versão, máquina de estados e prevenção transacional de eco           | não                 |
| 4    | Ressincronização com fence/watermark, rotação de segredo, retenção e alertas de conexão parada                                  | não                 |
| 5    | Módulo Agenda Universal em Conexões: cadastro, escopo, segredos, estados, histórico, dead letters e reenvio manual              | não                 |

Nenhuma fase depende de informação de parceiro específico. O contrato é nosso e é publicado; quem se conecta se adapta a ele.

## 14. Critérios de aceite

- Agendamento criado pela interface web chega ao parceiro. Esse é o teste que prova que a captura está no banco, e não na aplicação.
- Agendamento criado pela IA chega ao parceiro com os mesmos campos.
- Evento genérico sem profissional/local/serviço não é exportado.
- Soft delete de agendamento exportado chega como `appointment.cancelled`.
- `patient.upserted` chega sempre antes do `appointment.created` correspondente.
- Alteração posterior de nome ou telefone do paciente gera novo `patient.upserted` somente para conexões relacionadas.
- Regra de disponibilidade preserva `validFrom` e `validUntil`; mudança de timezone ressincroniza os assignments afetados.
- Reenvio do mesmo `eventId` não duplica efeito em nenhum dos dois sentidos.
- Mesmo `eventId` com hash diferente responde `409 idempotency_conflict`.
- Falta reportada pelo parceiro atualiza o status no CRM e não retorna para o parceiro como evento nosso.
- `baseResourceVersion` obsoleta responde `409 stale_resource_version` e não altera o estado.
- Falta registrada na nossa interface chega ao parceiro.
- Conexão nova recebe snapshot e todos os deltas ocorridos durante a sincronização antes de entrar em `active`.
- Conexão limitada a uma unidade não recebe recursos nem pacientes exclusivos de outra unidade.
- Assinatura inválida, timestamp fora da janela e conteúdo divergente com a mesma chave são recusados com o código correto.
- `Idempotency-Key` diferente de `eventId` é recusado com `400`.
- Duas instâncias do worker preservam a ordem por conexão e recuperam leases abandonados após crash.
- Crash após o parceiro responder `2xx`, mas antes do commit local, pode reenviar o evento sem duplicar efeito.
- Uma conexão parada não bloqueia entregas de outras conexões.
- Profundidade da fila, idade do evento mais antigo, sucesso, latência, retentativas e dead letters são observáveis por conexão sem expor PII.
- URL privada, loopback, link-local, redirect inseguro e resposta acima do limite são bloqueados.
- Evento desconhecido responde `200`; campo desconhecido em evento conhecido é ignorado.
- Nenhum segredo, corpo bruto ou dado pessoal completo aparece em log.
- Dead letter pode ser retentada ou ignorada somente por administrador, com confirmação e auditoria.
- O card Agenda Universal aparece no bloco Integrações de `/conexoes`, reflete os estados operacionais e é funcional em desktop e mobile.
- Especificação OpenAPI publicada, com exemplos validados contra o contrato implementado.

## 15. Fora de escopo

Nesta versão não entram: criação ou edição de agendamento pelo parceiro; escrita de disponibilidade no sentido inverso; adaptador sob medida por parceiro; catálogo de serviços como recurso autônomo, já que serviço viaja dentro do agendamento; lote de eventos em uma requisição; e qualquer operação financeira.

Serviço como recurso autônomo e lote são adições diretas caso um parceiro real precise — ambas seguem o padrão já estabelecido e não exigem mudança estrutural.

## 16. Riscos e decisões em aberto

| Risco                                                               | Mitigação                                                                                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Fila serial por conexão vira gargalo com volume alto                | medir antes de otimizar; se necessário, paralelizar por agregado preservando a ordem dentro de cada agendamento   |
| Uma dead letter bloqueia a fila da conexão                          | alerta imediato e ações administrativas auditadas de retentar ou ignorar; demais conexões continuam independentes |
| Mudança durante ressincronização se perde entre snapshot e ativação | fence/watermark e entrega obrigatória dos deltas antes de `active`                                                |
| URL de parceiro acessa rede interna                                 | validação SSRF em cadastro e entrega, redirects controlados e egress restrito                                     |
| Conexão recebe dados de unidade não contratada                      | escopo obrigatório por unidade e filtros tenant-scoped em toda consulta privilegiada                              |
| `metadata` crescer até virar schema paralelo não documentado        | regra de promoção da seção 3.3, revisada periodicamente                                                           |
| Parceiro sem idempotência duplica atendimento do lado dele          | `eventId` estável no contrato e exigência explícita na documentação de integração                                 |
| Grade de horário gerar volume alto de eventos em edições sucessivas | agrupar alterações próximas em uma única notificação por par profissional-unidade                                 |
| Divergência silenciosa entre os dois lados                          | ressincronização manual disponível e alerta de conexão parada                                                     |

Decisões que ainda cabem ao produto, sem bloquear o início das fases 0 e 1: incluir ou não `service.upserted` como recurso autônomo e se `birthDate` passa a ser coletado pela IA durante o agendamento ou apenas pela interface.

Decisões bloqueantes antes de produção: prazo de retenção de `deliveries` e `inbound_events`, política de exclusão/anonimização, contrato de tratamento de dados com o parceiro, limites finais de rate limit/timeout e versão de PostgreSQL/Supabase usada no ambiente self-hosted.

---

_Relacionado: [[Cobrança Plugável - Contrato, Operação e Cutover]]_
