# Sprint 4 - Dados, Relatorios e Organizacao Visual

## 1. Contexto

Sprint focada em melhorar confiabilidade dos indicadores, remover visualizacoes que nao agregam, refinar o Dashboard com uma experiencia operacional sofisticada e criar um Kanban para gerenciamento de instancias/cobranca.

Tarefas de referencia:

- 4.1 Remover indicador/grafico de "Receita por vendedor".
- 4.2 Atualizar logica e apresentacao dos KPIs.
- 4.3 Conectar graficos a fontes dinamicas.
- 4.4 Criar novo quadro Kanban para gerenciamento de instancias, como fluxo de cobranca.

Referencia visual obrigatoria:

- `chat-query.design-ui-ux/00-manifesto.md`
- `chat-query.design-ui-ux/02-componentes.md`
- `chat-query.design-ui-ux/04-graficos-dados.md`
- `chat-query.design-ui-ux/05-layout-responsividade.md`
- `src/components/calendar/`

Plano de implementacao:

- `update/guias/04-dashboard-plano-implementacao.md`

## 2. Diagnostico Do Codigo Atual

### O que ja existe

- `src/pages/Dashboard.tsx` calcula KPIs em memoria a partir de `useLeads`.
- `Dashboard.tsx` usa `LineChart`, `BarChart`, `FunnelChart` e `RevenueByVendorChart`.
- `src/lib/utils/metrics.ts` agrupa leads por dia, origem, vendedor e funil.
- `src/hooks/usePipelineStages.ts` fornece etapas do funil.
- `src/pages/Pipeline.tsx`, `KanbanBoard`, `KanbanColumn` e `LeadCard` ja implementam Kanban de leads.
- `src/hooks/useInstances.ts` carrega instancias via backend.
- `Project/IA/api-server.ts` tem endpoints de instancias e perfil.
- `src/components/calendar/` ja demonstra o nivel de acabamento esperado: superficies silenciosas, densidade, bordas sutis, radius generoso e interacao precisa.

### Lacunas

- Dashboard depende de dados carregados no cliente, o que pode pesar conforme volume.
- "Receita por Vendedor" ainda e renderizado no Dashboard.
- KPIs atuais ainda puxam o Dashboard para uma leitura financeira generica.
- O layout precisa evitar a sensacao de slideshow em blocos grandes.
- Nao ha Kanban especifico de instancias/cobranca.
- Nao ha schema claro para estados de cobranca de instancia.
- Filtros de periodo e instancia precisam manter consistencia entre cards e graficos.

## 3. Arquivos Provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `src/pages/Dashboard.tsx` | Remover grafico, revisar KPIs e reorganizar a tela | Medio |
| `src/lib/utils/metrics.ts` | Ajustar calculos e remover uso morto se aplicavel | Baixo |
| `src/components/charts/*` | Reaproveitar e refinar cards/graficos dinamicos | Medio |
| `src/components/KPICard.tsx` | Garantir padrao visual dos cards principais | Medio |
| `src/pages/Pipeline.tsx` | Avaliar navegacao/entrada para novo quadro | Medio |
| `src/components/kanban/*` | Reaproveitar padroes para novo Kanban | Medio |
| `src/hooks/useInstances.ts` | Base para dados de instancias | Medio |
| `Project/IA/api-server.ts` | Endpoints agregados ou estados de instancia | Medio |
| `supabase/migrations/*` | Schema de workflow de cobranca, se necessario | Alto |

## 4. Proposta Tecnica

### Dashboard

- Remover import e renderizacao de `RevenueByVendorChart`.
- Substituir a narrativa financeira por camadas de leitura operacional.
- Nao montar a tela como "4 atos" visuais. A ordem pode seguir a historia, mas a experiencia deve ser uma superficie escaneavel.
- Usar o Calendar como referencia de acabamento: containers brancos, borda sutil, shadow leve, radius generoso, headers compactos e hover discreto.
- Renomear "Funil e Receita" para `Movimento do Pipeline`.
- Manter receita em `Indicadores Opcionais`, quando houver dado confiavel.

KPIs principais recomendados:

- Leads no Periodo.
- Leads em Atendimento.
- Atendimentos com IA.
- Taxa de Resposta a IA.

KPIs secundarios:

- Conversao do Pipeline.
- Leads sem Interacao Recente.
- Receita Registrada.
- Disparos Enviados.

Todos os KPIs devem usar a mesma base filtrada por periodo e instancia.

### Experiencia Visual Do Dashboard

- Header compacto: label, titulo, descricao curta e filtros.
- Section labels antes dos blocos, sem titulos heroicos.
- Grid de KPIs denso e escaneavel: 4 colunas desktop, 2 tablet, 1 mobile.
- Graficos em `chart-container` ou `card-section`, sem bordas internas extras.
- Textos curtos. A tela deve comunicar por hierarquia, nao por explicacao.
- Estados vazios com microcopy neutra, sem vermelho por ausencia de dado.
- Evitar cards dentro de cards.
- Evitar blocos grandes com cara de apresentacao ou landing page.

### Graficos Dinamicos

- Para v1, manter calculos client-side se volume ainda for aceitavel.
- Se volume real for alto, criar endpoint/RPC de agregados por `aces_id`, periodo e instancia.
- O guia de implementacao deve impedir que grafico use mock enquanto card usa dado real.
- Preferir barras horizontais para comparativos por instancia.
- Parear volume com resposta ou evolucao sempre que possivel.

### Kanban De Instancias/Cobranca

- Nao misturar com `KanbanBoard` de leads sem abstrair corretamente.
- Criar dominio proprio para instancias.
- Usar linguagem operacional, sem dramatizar estados ruins.

Estados sugeridos:

- `ativo`
- `em_atencao`
- `cobranca`
- `suspenso`
- `cancelado`

Entidade sugerida:

- instancia/canal com responsavel, status, ultima atividade, plano ou debito quando houver fonte.

Se ainda nao houver dados financeiros reais, criar o quadro como organizacao operacional manual e sinalizar integracao financeira para Sprint 8/RB.

## 5. Ordem De Execucao

1. Remover `RevenueByVendorChart` do Dashboard.
2. Reorganizar o layout em camadas de leitura: consolidado, pipeline, conversas, instancia e opcionais.
3. Revisar KPIs com filtros de periodo/instancia.
4. Validar dados dos graficos com a mesma base dos KPIs.
5. Ajustar microcopy e labels para linguagem operacional curta.
6. Refinar containers e cards conforme a sofisticacao do Calendar.
7. Definir se Kanban de instancias precisa schema novo ou se usa campos existentes.
8. Criar componentes/hook especificos para Kanban de instancias.
9. Adicionar rota ou aba de acesso sem poluir o Pipeline de leads.
10. Testar estados vazios, sem instancias e com muitas instancias.

## 6. Criterios De Aceite

- Dashboard nao exibe "Receita por Vendedor".
- Dashboard nao usa receita como centro da primeira dobra.
- Primeira dobra exibe Leads no Periodo, Leads em Atendimento, Atendimentos com IA e Taxa de Resposta a IA.
- KPIs e graficos respondem ao mesmo filtro de periodo.
- KPIs e graficos respondem ao mesmo filtro de instancia.
- Bloco de funil chama `Movimento do Pipeline`, nao `Funil e Receita`.
- A tela parece uma ferramenta operacional sofisticada, nao um slideshow.
- Layout respeita tokens, section labels, cards KPI e chart containers.
- Novo Kanban de instancias permite visualizar instancias por estado.
- Mudanca de estado de instancia/cobranca persiste quando houver schema definido.
- Usuarios sem permissao nao conseguem alterar estados administrativos.

## 7. Riscos E Mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Remover grafico causar layout vazio | Media | Reorganizar em camadas de leitura, sem buracos visuais |
| Dashboard ficar explicativo demais | Media | Reduzir copy e usar hierarquia visual |
| KPIs divergirem dos graficos | Media | Centralizar base filtrada |
| IA nao ter fonte unica consolidada | Media | Documentar fallback entre `crm.ai_runs` e `crm.message_history` |
| Kanban de instancia conflitar com Kanban de leads | Media | Criar dominio/hook separado |
| Falta de fonte financeira real | Alta | Marcar quadro como operacional ate RB/Sprint 8 |

## 8. Testes

- `npm run lint`
- `npm run build`
- Testar Dashboard com filtros: total, hoje, 7d, 30d e instancia especifica.
- Testar usuario ADMIN e VENDEDOR.
- Testar estados vazios em todos os KPIs e graficos.
- Testar responsividade: desktop, tablet e mobile.
- Testar Kanban de instancias vazio, com uma instancia e com varias.
- Se houver migration, rodar teste de RLS e grants.

## 9. Pontos De Atencao

- Nao apagar `RevenueByVendorChart.tsx` sem confirmar que nao ha uso futuro.
- Evitar refatorar todo o Dashboard fora do escopo.
- O Kanban de cobranca deve declarar claramente se e operacional manual ou integrado a financeiro/RB.
- Nao transformar a narrativa do Dashboard em textos longos dentro da interface.
- Nao usar vermelho ou linguagem de erro para ausencia de dados.
- Nao criar cards aninhados para simular profundidade visual.
