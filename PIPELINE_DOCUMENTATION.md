# Documentação Técnica: Sistema de Pipeline Dinâmico

Este documento resume as alterações arquiteturais e técnicas realizadas no
sistema de Crm para transição de um funil estático para um sistema de etapas
dinâmicas gerenciadas pelo banco de dados.

## 1. Banco de Dados (PostgreSQL / Supabase)

### Nova Tabela: `Crm.pipeline_stages`

Responsável por armazenar as etapas configuráveis por conta (`aces_id`).

- `id` (uuid): Chave primária.
- `name` (text): Nome da etapa (ex: "Novo", "Venda Concluída").
- `color` (text): Código hexadecimal da cor.
- `category` (enum): Classificação técnica para KPIs ('Aberto', 'Ganho',
  'Perdido').
- `position` (int): Ordem de exibição no Kanban.
- `aces_id` (int): Vínculo com a conta da empresa.

### Gatilho de Sincronização: `Crm.sync_status_and_stage`

Atrelado à tabela `Crm.leads` (BEFORE INSERT OR UPDATE).

- **Entrada via n8n/Status (Texto)**: Se o campo `leads.status` for preenchido
  com um texto (ex: "Atendimento"), o gatilho busca automaticamente o `stage_id`
  UUID correspondente para manter a integridade do Kanban.
- **Fallbacks Inteligentes**: Se o nome não bater exatamente, o gatilho usa
  palavras-chave ('sucesso', 'cancelado') para mapear para as categorias 'Ganho'
  ou 'Perdido'.
- **Saída via Drag & Drop (UUID)**: Quando o frontend altera o `stage_id`
  (UUID), o gatilho atualiza retroativamente o campo `leads.status` com o
  **nome** da etapa para manter compatibilidade com automações externas.

### Automação de Configuração

- **Função `Crm.fn_create_default_pipeline_stages(p_aces_id)`**: Insere as 5
  etapas padrão ("Novo", "Atendimento", "Fechado", "Perdido", "Remarketing")
  para qualquer nova conta.
- **Trigger `tr_accounts_insert_pipeline_stages`**: Dispara automaticamente a
  função acima quando uma nova linha é inserida em `Crm.accounts`.

---

## 2. Frontend (React / Vite)

### Tipos e Interfaces

- Atualizada interface `PipelineStage` no arquivo `src/types/index.ts`.
- Tipagem rigorosa para `category` para evitar inconsistências nos KPIs.

### Hook: `usePipelineStages.ts`

Novo hook centralizador que gerencia:

- Fetching das etapas via Supabase.
- Funções CRUD (`createStage`, `updateStage`, `deleteStage`).
- Reordenação via `reorderStages` (persistência das posições).
- Subscrição em Tempo Real (Realtime) para atualizações instantâneas entre
  múltiplos usuários.

### Componentes Atualizados

- **`KanbanBoard.tsx`**: Agora renderiza colunas dinamicamente baseado nos dados
  de `pipeline_stages`.
- **`StageModal.tsx`**: Interface administrativa para criar/editar etapas, com
  foco em como cada uma afeta os KPIs.
- **`DeleteStageModal.tsx`**: Lógica de segurança para migração de leads ao
  excluir uma etapa e trava para evitar a exclusão da última etapa de categorias
  críticas (Ganho/Perda).
- **`LeadModal.tsx` & `EditLeadModal.tsx`**: Refatorados para sincronizar o
  texto do status com o nome da etapa selecionada no select dinâmico.
- **`StageBadge.tsx`**: Novo componente padronizado para exibir a cor e o nome
  da etapa em qualquer lugar do app.

---

## 3. Estado dos Dados

- **Migração de Massa**: Todos os leads existentes sem `stage_id` foram
  sincronizados com suas etapas correspondentes baseadas no texto do seu
  `status` atual.
- **Integridade**: Leads ativos estão todos dentro de etapas válidas do pipeline
  de suas respectivas contas.

---

_Este documento é a fonte da verdade para o Codex e desenvolvedores sobre o
funcionamento do novo Pipeline Dinâmico._
