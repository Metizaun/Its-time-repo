# PRD — Feature: Automação de Follow-up
> Kanban vertical dinâmico de funis de mensagens vinculados ao `crm.leads.status`

---

## Contexto

O CRM já possui `crm.pipeline_stages`, `crm.lead_remarketing`, `crm.follow_up_tasks` e `crm.agendamentos`. Esta feature cria uma tela de gerenciamento de funis de automação onde o usuário monta sequências de disparos de mensagens vinculadas a um status de lead (ex: "Agendado"), com delays configuráveis em minutos/horas/dias.

---

## Objetivo

Permitir criar funis de mensagens personalizados por status, onde cada funil pode ter múltiplos disparos (ex: Follow-up 1h antes do agendamento, Follow-up 15min antes), com template de mensagem com variáveis dinâmicas.

---

## Modelo de dados

### Novas tabelas necessárias

```sql
-- Funil de automação (ex: "Follow-up Agendamento")
CREATE TABLE crm.automation_funnels (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  aces_id integer NOT NULL REFERENCES accounts(id),
  name text NOT NULL,                        -- Ex: "Follow-up Agendamento"
  trigger_status text NOT NULL,              -- Ex: "Agendado" — vincula ao leads.status
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Etapas/disparos dentro de um funil
CREATE TABLE crm.automation_steps (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  funnel_id uuid NOT NULL REFERENCES crm.automation_funnels(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,       -- Ordem dos disparos dentro do funil
  label text NOT NULL,                       -- Ex: "Follow-up 1h antes"
  delay_minutes integer NOT NULL DEFAULT 0,  -- Minutos ANTES (negativo) ou DEPOIS do evento
  delay_reference text NOT NULL DEFAULT 'after_status',
  -- Valores possíveis:
  -- 'after_status'         → X minutos após o lead entrar no status
  -- 'before_appointment'   → X minutos antes do agendamento (usa agendamentos.data_agendamento)
  -- 'after_appointment'    → X minutos após o agendamento
  message_template text NOT NULL,            -- Suporta variáveis: {nome}, {telefone}, {data_agendamento}, {cidade}
  channel text NOT NULL DEFAULT 'whatsapp',  -- 'whatsapp' | 'email' (futuro)
  created_at timestamptz DEFAULT now()
);

-- Registro de execução por lead (evita re-disparo)
CREATE TABLE crm.automation_executions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  step_id uuid NOT NULL REFERENCES crm.automation_steps(id),
  lead_id uuid NOT NULL REFERENCES crm.leads(id),
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  status text NOT NULL DEFAULT 'pending',    -- 'pending' | 'sent' | 'failed' | 'cancelled'
  aces_id integer NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (step_id, lead_id)                  -- Nunca disparar duas vezes o mesmo step para o mesmo lead
);
```

### Tabelas do projeto já utilizadas

| Tabela | Uso |
|---|---|
| `crm.leads` | `status` é o trigger dos funis; `name`, `contact_phone`, `last_city` são variáveis de template |
| `crm.agendamentos` | `data_agendamento` é a referência de tempo para funis do tipo `before_appointment` |
| `crm.pipeline_stages` | Os status disponíveis no select de trigger vêm daqui (`name` da stage) |
| `crm.tags` | Filtros opcionais por tag (ver seção de filtros) |

---

## Interface — Kanban Vertical

### Estrutura da tela

```
┌─────────────────────────────────────────────────────────────────┐
│  Automação de Follow-up                         [+ Novo Funil]  │
├─────────────────────────────────────────────────────────────────┤
│  Filtros: [Status ▾] [Tag ▾] [Ativo/Inativo ▾]                 │
├───────────────────────┬─────────────────────────────────────────┤
│  FUNIS (coluna)       │  ETAPAS DO FUNIL SELECIONADO (coluna)   │
│                       │                                         │
│  ┌─ Follow-up Agend ─┐│  ● Follow-up 1h antes    [Disparo 1]   │
│  │ Status: Agendado  ││    Mensagem: "Oi {nome}..."             │
│  │ 3 disparos · ativo││    1h antes do agendamento              │
│  └───────────────────┘│                                         │
│                       │  ● Follow-up 15min antes  [Disparo 2]  │
│  ┌─ Remarketing ─────┐│    Mensagem: "Estamos te esperando..."  │
│  │ Status: Perdido   ││    15min antes do agendamento           │
│  │ 2 disparos · ativo││                                         │
│  └───────────────────┘│  ● Follow-up pós atend.  [Disparo 3]   │
│                       │    Mensagem: "Obrigado {nome}!"         │
│  [+ Novo Funil]       │    2h após o agendamento                │
│                       │                                         │
│                       │  [+ Adicionar disparo]                  │
└───────────────────────┴─────────────────────────────────────────┘
```

### Comportamento do Kanban

- Coluna esquerda: lista de funis, clicável. Funil ativo fica destacado.
- Coluna direita: etapas/disparos do funil selecionado, em ordem vertical (drag para reordenar `position`).
- Ao clicar em um disparo, abre um painel/modal inline de edição (sem navegação).
- Cada funil tem um toggle on/off que ativa/desativa todos os seus disparos.

---

## Formulário de criação de funil

```
Nome do funil:        [Follow-up Agendamento         ]
Status gatilho:       [Agendado                    ▾ ]  ← vem de pipeline_stages.name
Instância WhatsApp:   [Scael                       ▾ ]
Ativo:                [✓]
```

O campo "Status gatilho" é um `select` populado com `SELECT name FROM crm.pipeline_stages WHERE aces_id = :aces_id ORDER BY position`.

---

## Formulário de criação de disparo (step)

```
Label:                [Follow-up 1h antes agendamento]
Referência de tempo:  [Antes do agendamento         ▾]
  Opções:
  - Após entrar no status (X minutos depois)
  - Antes do agendamento (X minutos antes)
  - Após o agendamento (X minutos depois)

Delay:                [60] minutos

Template da mensagem:
┌──────────────────────────────────────────────────────┐
│ Oi {nome}! Lembrando que seu agendamento é às        │
│ {hora_agendamento}. Estamos te esperando!            │
│                                                      │
│ Variáveis disponíveis:                               │
│ {nome}  {telefone}  {data_agendamento}               │
│ {hora_agendamento}  {cidade}  {status}               │
└──────────────────────────────────────────────────────┘

Canal:                [WhatsApp ▾]
```

---

## Filtros disponíveis na tela

| Filtro | Origem dos dados | Comportamento |
|---|---|---|
| Status | `pipeline_stages.name` | Filtra funis pelo `trigger_status` |
| Tag | `crm.tags.name` | Filtra funis que têm leads com aquela tag (join) |
| Ativo/Inativo | `automation_funnels.is_active` | Toggle simples |
| Busca por nome | Input de texto | Filtra `automation_funnels.name ILIKE %termo%` |

---

## Motor de execução (scheduler)

O scheduler roda como um job recorrente (cron ou worker). Sugestão: a cada 5 minutos.

### Lógica de agendamento

```typescript
// Ao lead mudar de status → buscar funi(s) com aquele trigger_status
async function onLeadStatusChange(leadId: string, newStatus: string, acesId: number) {
  const funnels = await db.query(`
    SELECT af.id, as2.id as step_id, as2.delay_minutes, as2.delay_reference,
           as2.message_template, as2.label
    FROM crm.automation_funnels af
    JOIN crm.automation_steps as2 ON as2.funnel_id = af.id
    WHERE af.trigger_status = $1
      AND af.aces_id = $2
      AND af.is_active = true
    ORDER BY as2.position ASC
  `, [newStatus, acesId])

  for (const step of funnels) {
    let scheduledAt: Date

    if (step.delay_reference === 'after_status') {
      scheduledAt = addMinutes(new Date(), step.delay_minutes)
    } else if (step.delay_reference === 'before_appointment') {
      const appt = await getNextAppointment(leadId)
      if (!appt) continue
      scheduledAt = subMinutes(appt.data_agendamento, step.delay_minutes)
    } else if (step.delay_reference === 'after_appointment') {
      const appt = await getNextAppointment(leadId)
      if (!appt) continue
      scheduledAt = addMinutes(appt.data_agendamento, step.delay_minutes)
    }

    // Inserir execução (upsert: ignora se já existir para esse step+lead)
    await db.query(`
      INSERT INTO crm.automation_executions (step_id, lead_id, scheduled_at, aces_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (step_id, lead_id) DO NOTHING
    `, [step.step_id, leadId, scheduledAt, acesId])
  }
}
```

### Cron de disparo

```typescript
// Roda a cada 5 minutos — busca execuções pendentes no horário
async function processScheduledMessages() {
  const pending = await db.query(`
    SELECT ae.*, as2.message_template, as2.channel,
           l.name, l.contact_phone, l.last_city, l.status,
           l.instancia,
           ag.data_agendamento
    FROM crm.automation_executions ae
    JOIN crm.automation_steps as2 ON as2.id = ae.step_id
    JOIN crm.leads l ON l.id = ae.lead_id
    LEFT JOIN crm.agendamentos ag ON ag.lead_id = ae.lead_id
    WHERE ae.status = 'pending'
      AND ae.scheduled_at <= now()
    LIMIT 100
  `)

  for (const exec of pending) {
    const message = renderTemplate(exec.message_template, {
      nome: exec.name,
      telefone: exec.contact_phone,
      cidade: exec.last_city,
      status: exec.status,
      data_agendamento: formatDate(exec.data_agendamento),
      hora_agendamento: formatTime(exec.data_agendamento),
    })

    // Enviar via Evolution API (instância do lead)
    await sendWhatsAppMessage(exec.instancia, exec.contact_phone, message)

    // Marcar como enviado
    await db.query(`
      UPDATE crm.automation_executions
      SET status = 'sent', sent_at = now()
      WHERE id = $1
    `, [exec.id])
  }
}
```

### Função `renderTemplate`

```typescript
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`)
}
```

---

## Rotas de API necessárias

```
GET    /api/automacao/funnels              → lista funis do aces_id
POST   /api/automacao/funnels              → criar funil
PATCH  /api/automacao/funnels/:id          → editar nome, status, is_active
DELETE /api/automacao/funnels/:id          → deletar funil (cascade steps)

GET    /api/automacao/funnels/:id/steps    → listar steps do funil
POST   /api/automacao/funnels/:id/steps    → criar step
PATCH  /api/automacao/steps/:id            → editar step
DELETE /api/automacao/steps/:id            → deletar step
PATCH  /api/automacao/steps/reorder        → reordenar (array de {id, position})

GET    /api/automacao/executions           → histórico de disparos (com filtros)
```

---

## Instruções para o Codex

> Leia estas instruções antes de qualquer implementação.

1. **Crie as 3 novas tabelas via migration versionada** (`crm.automation_funnels`, `crm.automation_steps`, `crm.automation_executions`). Não altere nenhuma tabela existente.

2. **O hook `onLeadStatusChange` deve ser chamado no lugar onde o app já atualiza `leads.status`**. Procure no código atual onde esse update acontece e adicione a chamada após o commit da transação. Não mude a lógica de atualização de status — apenas adicione o side-effect.

3. **O scheduler (cron) deve ser implementado como um worker separado** ou job agendado, seguindo o padrão já utilizado no projeto (verifique se há `node-cron`, `bullmq`, `pg-boss` ou similar já instalado antes de adicionar nova dependência).

4. **A Evolution API de envio já está integrada no projeto** — use a função/serviço existente de envio de WhatsApp. Não crie uma nova abstração de envio.

5. **O campo `trigger_status` do funil deve validar contra `pipeline_stages.name`** — faça a validação no backend antes de inserir.

6. **Drag-and-drop para reordenar steps**: use `@dnd-kit/core` se já instalado. Se não, verifique o que o projeto usa. Não instale nova biblioteca de DnD sem confirmar.

7. **Nunca disparar o mesmo step duas vezes para o mesmo lead**: a constraint `UNIQUE (step_id, lead_id)` em `automation_executions` garante isso em nível de banco.

8. **Se o agendamento não existir** ao tentar agendar um step do tipo `before_appointment`, simplesmente pule (`continue`) sem erro.

---

## Critérios de aceite

- [ ] Kanban vertical com funis na coluna esquerda e steps na direita
- [ ] Criar/editar/deletar funil com nome livre e status gatilho dinâmico
- [ ] Criar/editar/deletar steps com delay e referência de tempo configurável
- [ ] Drag-and-drop para reordenar steps
- [ ] Template com variáveis `{nome}`, `{data_agendamento}`, `{hora_agendamento}`, `{cidade}` funcionando
- [ ] Funis com `before_appointment` buscam corretamente `agendamentos.data_agendamento`
- [ ] Scheduler roda a cada 5 minutos e processa execuções pendentes
- [ ] Execução duplicada (mesmo step + mesmo lead) é ignorada pelo banco
- [ ] Toggle ativo/inativo por funil funcional
- [ ] Filtros por status, tag e nome funcionam na listagem
