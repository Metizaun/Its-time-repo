# Sprint 4 - Dados, Relatorios e Organizacao Visual

## 1. Contexto

Sprint focada em melhorar confiabilidade dos indicadores, remover visualizacoes que nao agregam e criar um Kanban para gerenciamento de instancias/cobranca.

Tarefas de referencia:

- 4.1 Remover indicador/grafico de "Receita por vendedor".
- 4.2 Atualizar logica e apresentacao dos KPIs.
- 4.3 Conectar graficos a fontes dinamicas.
- 4.4 Criar novo quadro Kanban para gerenciamento de instancias, como fluxo de cobranca.

## 2. Diagnostico do codigo atual

### O que ja existe

- `src/pages/Dashboard.tsx` calcula KPIs em memoria a partir de `useLeads`.
- `Dashboard.tsx` usa `LineChart`, `BarChart`, `FunnelChart` e `RevenueByVendorChart`.
- `src/lib/utils/metrics.ts` agrupa leads por dia, origem, vendedor e funil.
- `src/hooks/usePipelineStages.ts` fornece etapas do funil.
- `src/pages/Pipeline.tsx`, `KanbanBoard`, `KanbanColumn` e `LeadCard` ja implementam Kanban de leads.
- `src/hooks/useInstances.ts` carrega instancias via backend.
- `Project/IA/api-server.ts` tem endpoints de instancias e perfil.

### Lacunas

- Dashboard depende de dados carregados no cliente, o que pode pesar conforme volume.
- "Receita por Vendedor" ainda e renderizado no Dashboard.
- Nao ha Kanban especifico de instancias/cobranca.
- Nao ha schema claro para estados de cobranca de instancia.
- Filtros de periodo e instancia precisam manter consistencia entre cards e graficos.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `src/pages/Dashboard.tsx` | Remover grafico e revisar KPIs | Medio |
| `src/lib/utils/metrics.ts` | Ajustar calculos e remover uso morto se aplicavel | Baixo |
| `src/components/charts/*` | Reaproveitar cards/graficos dinamicos | Medio |
| `src/pages/Pipeline.tsx` | Avaliar navegacao/entrada para novo quadro | Medio |
| `src/components/kanban/*` | Reaproveitar padroes para novo Kanban | Medio |
| `src/hooks/useInstances.ts` | Base para dados de instancias | Medio |
| `Project/IA/api-server.ts` | Endpoints agregados ou estados de instancia | Medio |
| `supabase/migrations/*` | Schema de workflow de cobranca, se necessario | Alto |

## 4. Proposta tecnica

### Dashboard

- Remover import e renderizacao de `RevenueByVendorChart`.
- Manter secao "Funil e Receita" com `FunnelChart` e outro card relevante, ou reorganizar em grid sem buraco visual.
- KPIs v1 recomendados:
  - Total de Leads.
  - Negocios Ganhos.
  - Receita Total.
  - Taxa de Conversao.
- Todos os KPIs devem usar a mesma base filtrada por periodo e instancia.

### Graficos dinamicos

- Para v1, manter calculos client-side se volume ainda for aceitavel.
- Se volume real for alto, criar endpoint/RPC de agregados por `aces_id`, periodo e instancia.
- O guia de implementacao deve impedir que grafico use mock enquanto card usa dado real.

### Kanban de instancias/cobranca

- Nao misturar com `KanbanBoard` de leads sem abstrair corretamente.
- Criar dominio proprio para instancias, por exemplo:
  - estados: `ativo`, `em_atencao`, `cobranca`, `suspenso`, `cancelado`;
  - entidade: instancia/canal com responsavel, status, ultima atividade, plano ou debito quando houver fonte.
- Se ainda nao houver dados financeiros reais, criar o quadro como organizacao operacional manual e sinalizar integracao financeira para Sprint 8/RB.

## 5. Ordem de execucao

1. Remover `RevenueByVendorChart` do Dashboard e ajustar layout.
2. Revisar KPIs com filtros de periodo/instancia.
3. Validar dados dos graficos com a mesma base dos KPIs.
4. Definir se Kanban de instancias precisa schema novo ou se usa campos existentes.
5. Criar componentes/hook especificos para Kanban de instancias.
6. Adicionar rota ou aba de acesso sem poluir o Pipeline de leads.
7. Testar estados vazios, sem instancias e com muitas instancias.

## 6. Criterios de aceite

- Dashboard nao exibe "Receita por Vendedor".
- KPIs e graficos respondem ao mesmo filtro de periodo.
- KPIs e graficos respondem ao mesmo filtro de instancia.
- Novo Kanban de instancias permite visualizar instancias por estado.
- Mudanca de estado de instancia/cobranca persiste quando houver schema definido.
- Usuarios sem permissao nao conseguem alterar estados administrativos.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Remover grafico causar layout vazio | Media | Reorganizar grid e cards |
| KPIs divergirem dos graficos | Media | Centralizar base filtrada |
| Kanban de instancia conflitar com Kanban de leads | Media | Criar dominio/hook separado |
| Falta de fonte financeira real | Alta | Marcar quadro como operacional ate RB/Sprint 8 |

## 8. Testes

- `npm run lint`
- `npm run build`
- Testar Dashboard com filtros: total, hoje, 7d, 30d e instancia especifica.
- Testar usuario ADMIN e VENDEDOR.
- Testar Kanban de instancias vazio, com uma instancia e com varias.
- Se houver migration, rodar teste de RLS e grants.

## 9. Pontos de atencao

- Nao apagar `RevenueByVendorChart.tsx` sem confirmar que nao ha uso futuro.
- Evitar refatorar todo o Dashboard fora do escopo.
- O Kanban de cobranca deve declarar claramente se e operacional manual ou integrado a financeiro/RB.

