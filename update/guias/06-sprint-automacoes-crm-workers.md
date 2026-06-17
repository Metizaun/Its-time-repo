# Sprint 6 - Automacoes de Base, CRM e Workers

## 1. Contexto

Sprint focada em consolidar o motor existente de automacoes, workers e sincronizacoes assincronas do CRM.
O projeto ja possui fluxo funcional de automacao; esta sprint deve estabilizar, observar e expandir a base sem recriar o motor atual.

Tarefas de referencia:

- 6.1 Desenvolver estrutura base para integracao com workers.
- 6.2 Desenvolver e ativar atualizacao automatizada de dados no CRM de forma assincrona.

## 2. Escopo ajustado

O escopo desta sprint nao e "criar o motor de IA", e sim:

- formalizar o que o worker atual ja faz;
- adicionar contratos operacionais para novos workers;
- preparar atualizacao automatizada de CRM com idempotencia e trilha de auditoria;
- incluir na primeira implementacao a gestao do CRM feita pela IA: etapa do funil, tags, nota de resumo e verificacao do lead;
- reanalisar o CRM somente quando houver mensagem nova do lead depois da ultima analise;
- melhorar observabilidade para Admin/dev;
- evitar duplicidade de mensagens, leads e sincronizacoes.

## 3. Diagnostico do codigo atual

### O que ja existe

- `Project/IA/automation-worker.ts` processa execucoes pendentes, usa retries, feriados, janela humanizada, registro de outbound echo e reparo de freeze.
- O mesmo worker tambem processa follow-up de calendario e limpeza de anexos expirados.
- `Project/IA/api-server.ts` inicia `startAutomationWorker()` quando `AUTOMATION_WORKER_ENABLED=true`.
- `Project/IA/sdr-agent-gemini.ts` ja possui classificacao de conversa e aplicacao de etapa do funil por IA.
- `Project/IA/sdr-agent-gemini.ts` salva mensagens inbound, atualiza `ai_lead_state.last_inbound_at` e grava `last_processed_message_at` apos processar o buffer.
- `Project/IA/whatsapp-provider-registry.ts` ja resolve provider Evolution/Meta por instancia.
- `Project/IA/outbound-echo-registry.ts` ja registra e reconhece ecos de saida para evitar duplicidade.
- `Crm.leads.stage_id`, `Crm.pipeline_stages`, `Crm.tags`, `Crm.lead_tags`, `Crm.leads.notes` e `Crm.leads."check"` ja sustentam parte do CRM operacional.
- `src/pages/Automacao.tsx` ja fornece board por etapas, filtro de instancia e modal de configuracao.
- `src/components/modals/AutomationMessageModal.tsx` ja inclui regras, mensagens, envio humanizado, debug e preview.
- Hooks `useAutomationJourneys`, `useAutomationExecutions`, `useAutomationPreview`, `useAutomationCatalog` ja existem.
- Migrations de automacao incluem funis, execucoes, humanizacao, dispatch state, reparos e limpeza diaria de execucoes antigas.

### Comportamentos atuais da IA/worker

- Seleciona execucoes pendentes via RPC e processa em lote.
- Respeita janela humanizada e pode adiar disparos.
- Registra outbound echo antes do envio para evitar eco/duplicidade.
- Faz retry para falhas transientes e encerra falhas permanentes com auditoria.
- Repara freezes de IA durante o ciclo do worker e apos o envio.
- Processa follow-ups de calendario em ciclo separado.
- Faz limpeza de anexos expirados do chat.
- Resolve provider WhatsApp por instancia, com fallback para Evolution quando Meta nao esta ativo.
- Classifica a conversa recente e pode mover o lead de etapa quando ha confianca suficiente.
- Em cada inbound, enfileira processamento e atualiza `ai_lead_state.last_inbound_at`.
- V1 da gestao de CRM pela IA aplica tags existentes, atualiza bloco de resumo em `Crm.leads.notes`, marca `Crm.leads."check"` e audita em `ai_runs`.
- A reanalise usa a regra `ultima mensagem inbound do lead > ai_lead_state.last_processed_message_at`.

### Lacunas reais

- Nao ha painel operacional dedicado para saude do worker.
- Nao ha contrato geral padronizado para novos workers alem do worker atual.
- A migration `20260617123000_add_ai_crm_management_v1.sql` precisa estar aplicada para expor `Crm.tags.usage_description` e aceitar `ai_runs.action_taken = 'crm_updated'`.
- Rollback operacional ainda depende de auditoria em `ai_runs`; nao ha tela dedicada para desfazer alteracoes da IA.
- Atualizacao automatizada de CRM externo/parceiro ainda nao esta explicitamente contratada.
- Observabilidade e alertas ainda parecem depender muito de logs.
- Falta schema/contrato formal para fila de sync de CRM quando houver persistencia externa.

## 4. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `Project/IA/automation-worker.ts` | Consolidar padrao de worker, metricas e fluxos atuais | Alto |
| `Project/IA/api-server.ts` | Expor health/status de workers | Medio |
| `Project/IA/sdr-agent-gemini.ts` | Aplicar decisoes da IA no CRM: etapa, tags e nota | Alto |
| `Project/IA/outbound-echo-registry.ts` | Reusar contrato de anti-duplicidade | Medio |
| `Project/IA/whatsapp-provider-registry.ts` | Padronizar resolucao de provider por instancia | Medio |
| `src/hooks/useLeadTags.ts` | Entender contrato atual de tags do lead | Medio |
| `src/pages/Automacao.tsx` | Exibir diagnostico operacional quando admin/dev | Medio |
| `src/components/modals/AutomationMessageModal.tsx` | Ajustes finos no debug/preview | Medio |
| `src/hooks/useAutomation*` | Hooks de status/diagnostico | Medio |
| `supabase/migrations/20260617123000_add_ai_crm_management_v1.sql` | Descricao de uso das tags e action `crm_updated` | Alto |
| `src/services/crmBackend.ts` | Chamadas para endpoints novos | Baixo |

## 5. Proposta tecnica

### Padrao de worker

Formalizar uma interface operacional comum:

- `name`: nome unico do worker.
- `enabled`: flag por env.
- `pollMs`: frequencia.
- `batchSize`: lote.
- `lastRunAt`: ultima execucao.
- `lastSuccessAt`: ultimo sucesso.
- `lastError`: erro resumido.
- `processedCount`: volume recente.

Para v1, isso pode ser persistido em tabela simples `crm.worker_runs` ou exposto em memoria se o deploy for monoprocesso. Se houver multiplas instancias, persistir em banco.

### Atualizacao CRM assincrona

- Primeira implementacao deve considerar o CRM interno como destino obrigatorio.
- Antes de chamar o modelo, comparar a ultima mensagem inbound do lead com a ultima analise:
  - fonte principal: `message_history` com `source_type = 'lead'` e maior `sent_at`;
  - marco de analise: `ai_lead_state.last_processed_message_at`;
  - executar analise apenas quando a ultima mensagem inbound for maior que `last_processed_message_at` ou quando ainda nao houver analise;
  - `Crm.leads.last_message_at` pode ser usado como sinal auxiliar, mas nao deve substituir a checagem de `message_history.source_type = 'lead'`.
- A IA deve retornar uma decisao estruturada para:
  - mover o lead para uma etapa do funil (`stage_id`);
  - aplicar tags existentes quando a conversa bater com a descricao de uso da tag;
  - escrever ou atualizar uma nota curta de resumo do ultimo atendimento em `leads.notes`;
  - marcar `Crm.leads."check"` quando o lead for analisado/verificado pela IA;
  - registrar motivo e confianca de cada decisao.
- Tags devem ser selecionadas somente a partir do catalogo existente da conta. A IA nao deve criar tags automaticamente nesta primeira versao.
- O schema usa `Crm.tags.usage_description` como descricao operacional de quando usar cada tag.
- Definir origem/destino externo antes de implementar integracoes com parceiro externo, RB ou outro.
- Criar fila/log de sincronizacao com idempotencia:
  - entidade (`lead`, `lead_tag`, `lead_note`, `lead_verification`, `instance`, `automation_execution`);
  - evento (`created`, `updated`, `stage_changed`, `tag_applied`, `tag_removed`, `note_summary_updated`, `lead_checked`, `message_sent`);
  - payload resumido;
  - status (`pending`, `processing`, `completed`, `failed`);
  - tentativas e proxima tentativa.
- Reaproveitar padrao de retries do `automation-worker.ts`.

### Gestao do CRM pela IA

O ciclo de IA deve tratar a conversa como uma decisao operacional unica:

- verificar se existe mensagem nova do lead desde `ai_lead_state.last_processed_message_at`;
- se nao houver mensagem nova, nao chamar o modelo e nao alterar etapa/tag/nota/check;
- carregar lead, mensagens recentes, etapas disponiveis e catalogo de tags com descricao de uso;
- pedir ao modelo uma resposta estruturada com `stage_decision`, `tag_decisions`, `attendance_summary` e `lead_verification`;
- validar todas as decisoes contra entidades reais da conta antes de aplicar;
- aplicar stage via RPC existente de movimentacao de lead;
- aplicar tags em `Crm.lead_tags` com `upsert` idempotente;
- atualizar `Crm.leads.notes` preservando historico util ou substituindo apenas o bloco de resumo da IA, conforme contrato definido;
- atualizar `Crm.leads."check"` com o timestamp da verificacao quando a IA concluir a analise do lead;
- gravar snapshot da entrada, saida e alteracoes aplicadas em `ai_runs` ou log equivalente.

### Observabilidade

- Endpoint Admin para status de worker.
- Logs estruturados com contexto: `acesId`, `leadId`, `instanceName`, `executionId`, `workerName`.
- Visao no frontend apenas para admin/dev, sem expor payload sensivel.

## 6. Tarefas faltantes por prioridade

### Prioridade alta

- Aplicar a migration `20260617123000_add_ai_crm_management_v1.sql` no Supabase antes do deploy.
- Validar em ambiente com dados reais a gestao de CRM pela IA: etapa do funil, tags, resumo do ultimo atendimento e verificacao do lead.
- Validar guarda de reanalise: somente processar quando a ultima mensagem do lead for posterior a ultima analise.
- Definir o contrato da fila de sync de CRM com idempotencia.
- Criar status operacional do worker com `lastRunAt`, `lastSuccessAt`, `lastError` e contagem recente.
- Expor endpoint backend de health/status do worker.
- Garantir que a sincronizacao de CRM nao duplique eventos em multiplas instancias.
- Documentar oficialmente os fluxos atuais de outbound echo, retry e reparo de freeze.

### Prioridade media

- Criar UI simples de diagnostico para Admin/dev.
- Padronizar logs estruturados e mascaramento de dados sensiveis.
- Integrar ou reutilizar o provider registry em todos os caminhos relevantes de envio, se ainda houver pontos fora dele.
- Criar monitoramento de falhas transientes vs permanentes.

### Prioridade baixa

- Adicionar metricas historicas de volume por worker.
- Criar painel visual dedicado para saude do worker.
- Criar alertas automatizados a partir dos estados de erro.

## 7. Ordem de execucao

1. Documentar comportamento atual do `automation-worker.ts`.
2. Definir contrato da decisao de CRM da IA: etapa, tags, nota, verificacao, confianca e motivo.
3. Implementar guarda de reanalise por `last inbound > last processed`.
4. Confirmar ou criar campo de descricao de uso das tags.
5. Implementar aplicacao idempotente de etapa, tags, resumo do atendimento e `Crm.leads."check"`.
6. Criar contrato de status/health de worker.
7. Adicionar endpoint backend para status operacional.
8. Definir origem/destino da atualizacao automatizada de CRM externo, se houver.
9. Criar schema de fila/sync se o destino exigir persistencia.
10. Implementar worker de sync com idempotencia e retries.
11. Criar UI simples de diagnostico para Admin/dev, se necessario.
12. Validar que automacoes existentes nao mudaram comportamento.

## 8. Criterios de aceite

- Worker atual continua processando automacoes pendentes.
- Follow-ups de calendario, reparos de freeze e limpeza de anexos continuam funcionando.
- IA move o lead para a etapa correta do funil apenas quando a confianca atingir o limite configurado.
- IA aplica apenas tags existentes da conta, usando a descricao de quando usar como criterio.
- IA escreve resumo do ultimo atendimento em `Crm.leads.notes` sem apagar informacoes humanas relevantes.
- IA marca `Crm.leads."check"` com timestamp quando concluir a verificacao do lead.
- IA so reanalisa CRM quando existir mensagem do lead com `sent_at` maior que `ai_lead_state.last_processed_message_at`.
- Se nao houver mensagem nova do lead, a IA nao chama o modelo e nao altera etapa, tag, nota ou `check`.
- Toda alteracao automatica de etapa, tag, nota e verificacao fica auditavel com motivo, confianca e snapshot resumido.
- Admin/dev consegue ver se worker esta ativo, ultimo ciclo e ultimo erro.
- Novo fluxo de sync CRM tem fila/log e nao duplica eventos.
- Falhas transientes tentam novamente com limite.
- Falhas permanentes ficam auditaveis.
- Nenhuma mensagem automatica duplica por causa do novo worker.

## 9. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Duplicar disparos de automacao | Media | Idempotencia, locks e outbound echo registry |
| Worker em multiplas instancias processar mesmo job | Alta | Claim atomico via RPC/status no banco |
| Logs vazarem dados sensiveis | Media | Payload resumido e mascaramento |
| IA aplicar tag ou etapa errada | Media | Threshold de confianca, validacao contra catalogo real e auditoria |
| Resumo da IA sobrescrever nota humana | Alta | Usar bloco delimitado de resumo IA ou estrategia de append controlado |
| Lead ser marcado como verificado antes da analise completa | Media | Atualizar `Crm.leads."check"` apenas depois de validar/aplicar as decisoes de CRM |
| Reanalise duplicada sem mensagem nova | Media | Comparar ultima mensagem inbound do lead contra `ai_lead_state.last_processed_message_at` antes de chamar o modelo |
| IA criar taxonomia paralela de tags | Media | Proibir criacao automatica de tags na v1 |
| Sync externo sem contrato definido | Alta | Travar implementacao ate origem/destino estarem claros |
| Mudanca no worker afetar fluxos ja existentes | Media | Documentar e testar follow-up, freeze repair e outbound echo |

## 10. Testes

- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Teste de worker com `AUTOMATION_WORKER_ENABLED=true`.
- Teste de claim de execucoes em lote.
- Teste de retry transiente e falha permanente.
- Teste de classificacao de etapa pela IA com confianca abaixo/acima do limite.
- Teste sem mensagem nova do lead: nao chama modelo e nao altera CRM.
- Teste com mensagem nova do lead posterior a `last_processed_message_at`: chama modelo e analisa ultimas mensagens.
- Teste de aplicacao idempotente de tags existentes.
- Teste garantindo que tag inexistente sugerida pela IA seja ignorada/rejeitada.
- Teste de atualizacao de `leads.notes` preservando nota humana.
- Teste de atualizacao de `Crm.leads."check"` apenas apos verificacao concluida.
- Teste de auditoria da decisao da IA com motivo e confianca.
- Teste de follow-up de calendario.
- Teste de reparo de freeze.
- Teste de limpeza de anexos expirados.
- Teste de endpoint de health/status.
- Teste de UI Admin/dev sem permissao para vendedor.

## 11. Pontos de atencao

- Nao recriar motor de automacao; partir do worker existente.
- Nao misturar sync CRM com envio WhatsApp sem fila/idempotencia.
- Antes de novas migrations Supabase, seguir fluxo de migration formal e revisar RLS/grants.
- Nao assumir que o worker atual e apenas "CRM sync"; ele hoje tambem cuida de resiliencia operacional.

