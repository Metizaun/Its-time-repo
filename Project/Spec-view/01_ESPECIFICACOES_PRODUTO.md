# Especificações do Produto — Crm Arquem

> Documento de referência técnica e funcional. Leia antes de qualquer nova feature ou correção.

---

## 1. Visão Geral do Produto

O **Crm Arquem** é uma plataforma web de gestão de relacionamento com clientes (Crm) voltada para **empresas do setor óptico e de saúde visual** (óticas, clínicas, MedPrev). O sistema é multi-tenant, ou seja, uma única instância do software atende múltiplas empresas ao mesmo tempo, com dados completamente isolados.

### Stack Tecnológica

| Camada | Tecnologia |
| :--- | :--- |
| Frontend | React + TypeScript + Vite |
| Estilização | Tailwind CSS + shadcn/ui |
| Backend / BaaS | Supabase (PostgreSQL + Auth + Realtime + Edge Functions) |
| Roteamento | React Router v6 |
| Estado Global | Context API (`AuthContext`, `AppContext`) |
| Consultas HTTP | Supabase JS Client (sem React Query para dados do Crm) |
| Notificações | Sonner (toast) |
| Deploy | Vercel |

---

## 2. Estrutura de Rotas

Todas as rotas abaixo são **protegidas** por `<ProtectedRoute>` — o usuário precisa estar autenticado. A rota `/auth` é a única pública.

| Rota | Página | Descrição |
| :--- | :--- | :--- |
| `/auth` | `Auth.tsx` | Login e registro de usuários via Supabase Auth |
| `/` | `Dashboard.tsx` | KPIs, gráficos de performance e funil de vendas |
| `/leads` | `Leads.tsx` | Listagem, busca e gestão de leads |
| `/pipeline` | `Pipeline.tsx` | Kanban de etapas do funil de vendas |
| `/chat` | `Chat.tsx` | Interface de IA integrada ao agente configurado |
| `/admin` | `Admin.tsx` | Gestão de usuários e instâncias WhatsApp (**somente ADMIN**) |

---

## 3. Arquitetura de Componentes

```
src/
├── App.tsx                   # Roteamento principal e providers
├── pages/                    # Páginas (uma por rota)
├── components/
│   ├── layout/               # MainLayout, Sidebar, Header
│   ├── auth/                 # ProtectedRoute, PendingApprovalModal
│   ├── modals/               # ModalManager (gerencia todos os modais globais)
│   ├── drawers/              # Painel lateral de detalhes do lead
│   ├── kanban/               # Board, Column, Card do pipeline
│   ├── leads/                # Tabela de leads, filtros, search
│   ├── charts/               # LineChart, BarChart, FunnelChart, RevenueByVendorChart
│   ├── admin/                # InstanceManager, CreateUserModal
│   └── chat/                 # ChatInput, MessageBubble, ConversationList
├── hooks/                    # Lógica de dados (useLeads, usePipeline, etc.)
├── context/                  # AppContext (estado global de UI)
├── contexts/                 # AuthContext (sessão e role do usuário)
├── services/                 # webhookService (integrações externas)
├── types/                    # Interfaces TypeScript globais
└── lib/utils/                # Funções puras (filters.ts, metrics.ts)
```

---

## 4. Sistema de Autenticação e Multi-Tenancy

### Como funciona

1. O usuário faz login via **Supabase Auth** (email/senha).
2. O `auth.uid()` é mapeado para `Crm.users.auth_user_id`.
3. O campo `Crm.users.aces_id` identifica **a empresa** do usuário.
4. Esse `aces_id` é injetado no JWT do usuário via a função `sync_aces_id_to_jwt` (trigger automático).
5. Todo o **RLS (Row Level Security)** usa `aces_id` para filtrar os dados — nenhuma query manual de filtragem por empresa é necessária no frontend.

### Roles disponíveis (`Crm.user_role`)

| Role | Permissões |
| :--- | :--- |
| `ADMIN` | Acesso total: gerencia usuários, instâncias, etapas do pipeline e todos os leads |
| `VENDEDOR` | Acesso ao Crm; pode criar/editar leads e oportunidades |
| `NENHUM` | Usuário cadastrado mas sem acesso (aguardando aprovação do Admin) |

> ⚠️ **Peculiaridade importante**: Usuários com role `NENHUM` ficam bloqueados por um modal (`PendingApprovalModal`) após o login, impedindo o uso do sistema até que um ADMIN eleve seu nível.

---

## 5. Módulo de Leads — Peculiaridades Críticas

### View `v_lead_details`

Os leads **não são carregados diretamente da tabela `Crm.leads`**. O hook `useLeads` faz um processo em **duas etapas**:

1. **Passo 1**: Busca os IDs de todos os leads visíveis (`view = true`) da tabela `Crm.leads`, paginando em blocos de 500.
2. **Passo 2**: Para cada bloco de 200 IDs, consulta a **view `v_lead_details`** que une `Crm.leads` + `Crm.opportunities` + `Crm.users` + `Crm.lead_tags` + `Crm.instance` em uma única estrutura desnormalizada.

> ⚠️ **Nunca consulte `Crm.leads` diretamente para exibição**. Sempre use `v_lead_details` para obter dados completos. Se a view não retornar um lead que deveria aparecer, o código registra um warning no console indicando divergência.

### Campo `view`

- `view = true`: Lead ativo, visível na interface.
- `view = false`: Lead "arquivado". Não aparece em nenhuma listagem. **Nunca delete um lead, apenas defina `view = false`**.

### Ordenação

Os leads são ordenados por:
1. Presença de `last_message_at` (leads com mensagem recente primeiro)
2. `last_message_at` DESC
3. `created_at` DESC

### Realtime

O hook `useLeads` suporta **Realtime do Supabase** via `enableRealtime: true`. Quando ativo, usa um sistema de **debounce de 250ms** para agrupar múltiplas mudanças simultâneas antes de buscar os dados atualizados, evitando múltiplas requisições em cascata.

### Comunicação entre módulos

Para notificar que os leads foram atualizados (ex: após criar ou mover um lead), usa-se um **Custom Event do browser**:

```typescript
// Disparar:
notifyLeadsUpdated(); // dispara window.dispatchEvent(new Event("leads-updated"))

// Qualquer hook ouvindo useLeads irá recarregar automaticamente
```

---

## 6. Módulo Pipeline (Kanban)

### Estrutura de Etapas

Cada etapa (`pipeline_stages`) tem os campos:
- `name`: Nome da etapa (ex: "Prospecção", "Negociação")
- `color`: Cor hex para identificação visual
- `position`: Ordem no kanban (começa em 0)
- `category`: Classificação de KPI — `Aberto`, `Ganho` ou `Perdido`

### Regra de Movimentação

Mover um lead entre etapas **não** é um simples UPDATE na tabela. A operação é feita via RPC do Supabase:

```typescript
supabase.rpc("rpc_move_lead_to_stage", {
  p_lead_id: leadId,
  p_stage_id: newStageId
});
```

> ⚠️ **Nunca faça UPDATE direto em `Crm.leads.stage_id`** pela interface. A RPC garante que validações e sincronizações de status sejam executadas corretamente no banco.

### Reordenar Etapas

Ao arrastar e soltar no Admin, o hook `usePipelineStages.reorderStages` atualiza o campo `position` de todas as etapas em paralelo com `Promise.all`. Em caso de falha, faz rollback visual e recarrega do banco.

### Exclusão de Etapa com Leads

Não é possível excluir uma etapa que contém leads sem antes selecionar uma **etapa de destino** para migração. O hook verifica a quantidade de leads antes de prosseguir.

---

## 7. Módulo Dashboard — Métricas

### Fluxo de processamento dos dados

```
useLeads() → normalizedLeads (mapeamento de campos)
           → filterLeadsByPeriod() (filtro de data)
           → filteredLeads (filtro de instância)
           → KPIs + Gráficos
```

### KPIs calculados

| KPI | Fórmula |
| :--- | :--- |
| Total de Leads | `filteredLeads.length` |
| Negócios Ganhos | `leads com status === "Fechado"` |
| Receita Total | `Σ value dos leads com status "Fechado"` |
| Taxa de Conversão | `(Ganhos / Total) × 100` |

### Filtros disponíveis

- **Por período**: Hoje, Últimos 7 dias, Últimos 30 dias, Total
- **Por instância WhatsApp**: Todas ou uma instância específica

---

## 8. Módulo Chat (IA)

### Como funciona

- O chat conecta-se a uma **Edge Function do Supabase** (`/functions/v1/chat`).
- A função requer o **JWT do usuário** no header `Authorization: Bearer <token>`.
- Cada conversa é salva em `public.conversations` + `public.messages`.
- O uso de tokens é contabilizado automaticamente via `billing_record_usage()`.

### Agentes

Um **agente** (`public.agents`) é configurado com um `system_prompt` e tem acesso limitado às tabelas definidas em `public.agent_tables`. Atualmente o sistema opera com um agente padrão por conta.

---

## 9. Módulo Admin

- **Acesso restrito**: Redireciona (`<Navigate to="/" />`) qualquer usuário que não seja ADMIN.
- **Gestão de usuários**: Lista usuários ativos + convites pendentes. Permite alterar roles e cancelar convites.
- **Gerenciador de Instâncias**: Permite associar instâncias WhatsApp à empresa (`Crm.instance`).
- **Convites**: O Admin pode convidar novos usuários por email. O convite expira em 7 dias.

---

## 10. Como Rodar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
# Crie um arquivo .env.local com:
# VITE_SUPABASE_URL=https://<seu-projeto>.supabase.co
# VITE_SUPABASE_ANON_KEY=<sua-chave-anon>

# 3. Iniciar o servidor de desenvolvimento
npm run dev
```

O app estará disponível em `http://localhost:8080` (ou a porta configurada no vite.config.ts).

---

## 11. Pontos de Atenção e Armadilhas

> [!WARNING]
> **Não faça queries diretas em tabelas do schema `Crm` sem passar pelo RLS.** O isolamento multi-tenant depende 100% das políticas de Row Level Security. Sempre use o cliente Supabase autenticado.

> [!WARNING]
> **Não delete registros de Leads.** Use `view = false` para arquivar. Deleção quebra histórico de mensagens e oportunidades vinculadas.

> [!NOTE]
> **A view `v_lead_details` é a fonte de verdade para exibição**. Se um campo novo for adicionado à tabela `Crm.leads`, a view precisa ser atualizada para o frontend enxergar.

> [!NOTE]
> **O campo `Fonte` (com F maiúsculo) em `Crm.leads` é uma coluna com nome em português e maiúsculo.** No insert, sempre use `"Fonte": valor`. Isso é uma peculiaridade do banco herdada do sistema legado.

> [!TIP]
> **Para adicionar um novo gráfico no Dashboard**, adicione a função de agrupamento em `src/lib/utils/metrics.ts` e consuma o resultado via `useMemo` no `Dashboard.tsx`. Mantenha o padrão de separação: hooks buscam dados, utils transformam dados, componentes renderizam.
