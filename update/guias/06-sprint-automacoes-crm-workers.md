# Sprint 6 - Automacoes de Base e CRM

## 1. Contexto

Sprint focada em consolidar workers e sincronizacoes assincronas do CRM. O projeto ja possui um motor de automacoes robusto; esta sprint deve estabilizar, observar e expandir a base existente.

Tarefas de referencia:

- 6.1 Desenvolver estrutura base para integracao com workers.
- 6.2 Desenvolver e ativar atualizacao automatizada de dados no CRM de forma assincrona.

## 2. Diagnostico do codigo atual

### O que ja existe

- `Project/IA/automation-worker.ts` processa execucoes pendentes, usa retries, feriados, janela humanizada, registro de outbound echo e reparo de freeze.
- `Project/IA/api-server.ts` inicia `startAutomationWorker()` quando `AUTOMATION_WORKER_ENABLED=true`.
- `src/pages/Automacao.tsx` ja fornece board por etapas, filtro de instancia e modal de configuracao.
- `src/components/modals/AutomationMessageModal.tsx` ja inclui regras, mensagens, envio humanizado, debug e preview.
- Hooks `useAutomationJourneys`, `useAutomationExecutions`, `useAutomationPreview`, `useAutomationCatalog` ja existem.
- Migrations de automacao incluem funis, execucoes, humanizacao, dispatch state, reparos e limpeza diaria de execucoes antigas.

### Lacunas

- Nao ha painel operacional dedicado para saude do worker.
- Nao ha contrato geral para novos workers alem do worker atual.
- Atualizacao automatizada de CRM externo/parceiro ainda nao esta clara.
- Observabilidade e alertas parecem depender de logs.
- Fila/workflow para CRM externo ainda precisa de schema/contrato.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `Project/IA/automation-worker.ts` | Consolidar padrao de worker e metricas | Alto |
| `Project/IA/api-server.ts` | Expor health/status de workers | Medio |
| `src/pages/Automacao.tsx` | Exibir diagnostico operacional quando admin/dev | Medio |
| `src/components/modals/AutomationMessageModal.tsx` | Ajustes finos no debug/preview | Medio |
| `src/hooks/useAutomation*` | Hooks de status/diagnostico | Medio |
| `supabase/migrations/*` | Tabelas de jobs, logs ou sync state | Alto |
| `src/services/crmBackend.ts` | Chamadas para endpoints novos | Baixo |

## 4. Proposta tecnica

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

- Definir origem/destino antes de implementar: CRM interno, parceiro externo, RB ou outro.
- Criar fila/log de sincronizacao com idempotencia:
  - entidade (`lead`, `instance`, `automation_execution`);
  - evento (`created`, `updated`, `stage_changed`, `message_sent`);
  - payload resumido;
  - status (`pending`, `processing`, `completed`, `failed`);
  - tentativas e proxima tentativa.
- Reaproveitar padrao de retries do `automation-worker.ts`.

### Observabilidade

- Endpoint Admin para status de worker.
- Logs estruturados com contexto: `acesId`, `leadId`, `instanceName`, `executionId`, `workerName`.
- Visao no frontend apenas para admin/dev, sem expor payload sensivel.

## 5. Ordem de execucao

1. Documentar comportamento atual do `automation-worker.ts`.
2. Criar contrato de status/health de worker.
3. Adicionar endpoint backend para status operacional.
4. Criar UI simples de diagnostico para Admin/dev, se necessario.
5. Definir origem/destino da atualizacao automatizada do CRM.
6. Criar schema de fila/sync se o destino exigir persistencia.
7. Implementar worker de sync com idempotencia e retries.
8. Validar que automacoes existentes nao mudaram comportamento.

## 6. Criterios de aceite

- Worker atual continua processando automacoes pendentes.
- Admin/dev consegue ver se worker esta ativo, ultimo ciclo e ultimo erro.
- Novo fluxo de sync CRM tem fila/log e nao duplica eventos.
- Falhas transientes tentam novamente com limite.
- Falhas permanentes ficam auditaveis.
- Nenhuma mensagem automatica duplica por causa do novo worker.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Duplicar disparos de automacao | Media | Idempotencia, locks e outbound echo registry |
| Worker em multiplas instancias processar mesmo job | Alta | Claim atomico via RPC/status no banco |
| Logs vazarem dados sensiveis | Media | Payload resumido e mascaramento |
| Sync externo sem contrato definido | Alta | Travar implementacao ate origem/destino estarem claros |

## 8. Testes

- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Teste de worker com `AUTOMATION_WORKER_ENABLED=true`.
- Teste de claim de execucoes em lote.
- Teste de retry transiente e falha permanente.
- Teste de endpoint de health/status.
- Teste de UI Admin/dev sem permissao para vendedor.

## 9. Pontos de atencao

- Nao recriar motor de automacao; partir do worker existente.
- Nao misturar sync CRM com envio WhatsApp sem fila/idempotencia.
- Antes de novas migrations Supabase, seguir fluxo de migration formal e revisar RLS/grants.

