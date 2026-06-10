# PRD Principal - Roadmap UI, Chat e IA

## 1. Contexto

Este documento consolida o plano de implementacao descrito no documento estrategico da pasta `update/` e transforma o roadmap em guias de execucao por sprint, alinhados ao codigo atual do projeto.

O objetivo nao e implementar funcionalidades neste arquivo. O objetivo e dar orientacao revisavel para que cada sprint seja iniciada com contexto, riscos, dependencias, ordem de execucao e criterios de aceite claros.

## 2. Diagnostico do codigo atual

### Stack e organizacao

- Frontend: React 18, TypeScript, Vite, React Router, Tailwind CSS, Radix/shadcn-ui, lucide-react e TanStack React Query.
- Backend: Node/Express em `Project/IA`, com endpoints REST, webhooks Evolution/Meta, worker de automacao, Gemini, OpenAI e Redis via `ioredis`.
- Dados: Supabase/Postgres, schemas `crm` e `meta`, Edge Functions em `supabase/functions` e migrations em `supabase/migrations`.
- Padrao de imports: aliases `@/` no frontend e imports relativos no backend `Project/IA`.
- Padrao de feature: paginas em `src/pages`, hooks em `src/hooks`, servicos HTTP em `src/services`, componentes por dominio em `src/components`.

### Modulos existentes que devem ser reaproveitados

- Chat: `src/pages/Chat.tsx`, `src/hooks/useChat.ts`, `src/components/chat/ChatInput.tsx`, `MessageList.tsx`, `MessageBubble.tsx`, `src/services/webhookService.ts`.
- Admin e instancias: `src/pages/Admin.tsx`, `src/components/admin/InstanceManager.tsx`, `src/services/instanceService.ts`, endpoints `/api/instances` e `/api/meta/*` em `Project/IA/api-server.ts`.
- Automacao: `src/pages/Automacao.tsx`, `src/components/modals/AutomationMessageModal.tsx`, hooks `useAutomation*`, `Project/IA/automation-worker.ts`.
- Agentes: `src/pages/Agentes.tsx`, `src/components/modals/AgentConfigModal.tsx`, `src/hooks/useAgents.ts`, tabelas `crm.ai_agents`, `crm.ai_stage_rules`, `crm.ai_runs`.
- Dashboard e pipeline: `src/pages/Dashboard.tsx`, `src/pages/Pipeline.tsx`, `src/components/kanban/*`, `src/lib/utils/metrics.ts`.
- Importacao CSV: `src/pages/Leads.tsx`, `src/components/modals/LeadCsvImportModal.tsx`, `src/hooks/useLeadCsvImport.ts`, `src/lib/utils/export.ts`.

### Lacunas principais

- O chat atual e texto puro: `rpc_get_chat` retorna `content`, `direction`, `sent_at`, `lead_name` e `sender_name`; `sendManualMessage` aceita apenas `content`.
- Nao ha contrato persistente de anexo/midia em `crm.message_history`; imagens/audio recebidos sao normalizados para texto no backend, mas nao renderizados como midia no produto.
- Redis ja existe no backend para buffer/echo, mas nao ha cache de leitura de chat com contrato documentado para UI.
- Supabase Storage ainda nao tem bucket/politicas especificas para anexos do chat.
- Meta ja tem fundacao tecnica, mas a criacao/gestao operacional ainda precisa evoluir sobre a base existente.
- Automacoes e workers ja existem; o trabalho futuro deve consolidar, observar e expandir, nao recriar.
- RB, memoria vetorial, visagismo e agente de cobranca ainda nao aparecem como modulos implementados.

## 3. Roadmap por sprint

| Sprint | Foco | Dependencias principais | Risco |
|---|---|---|---|
| 1 | Quick wins de UI e fundacao de Storage | Frontend, Supabase Storage | Medio |
| 2 | Core backend do chat | Supabase, Redis, cron/worker | Alto |
| 3 | Frontend do chat multimidia | Sprint 2, Storage, APIs de envio | Alto |
| 4 | Dados, relatorios e Kanban de instancias | Hooks de leads/instancias, metricas | Medio |
| 5 | Meta Admin e integracao | Base `meta`, Graph API, segredos | Alto |
| 6 | Automacoes e CRM assincrono | Worker existente, RPCs, observabilidade | Medio/Alto |
| 7 | IA fase 1 e preparacao RB | Agentes, runs, memoria, contrato RB | Alto |
| 8 | IA avancada, visagismo e cobranca RB | Sprint 7, RB, modelos multimodais | Alto |

## 4. Contratos-alvo para implementacao futura

### Chat e midias

- Manter `crm.message_history` como fonte de historico textual e criar metadados de midia de forma explicita antes de alterar a UI.
- Padrao v1 recomendado: Supabase Storage, pois o projeto ja usa Supabase e nao possui SDK AWS/GCP instalado.
- Criar contrato de anexo com no minimo: `message_id`, `kind`, `mime_type`, `storage_bucket`, `storage_path`, `file_name`, `file_size`, `expires_at`, `created_at`.
- Expandir `rpc_get_chat` ou criar RPC nova para retornar mensagens com anexos sem quebrar consumidores existentes.
- Expandir `/api/chat/send-manual` apenas depois do contrato de storage estar validado.
- Imagens devem ter TTL de 7 dias; documentos e audios devem seguir politica definida no guia da sprint antes de implementacao.

### Supabase

- Antes de implementar migrations, verificar changelog/documentacao atual do Supabase quando a tarefa tocar Storage, RLS, Cron, Auth ou Data API.
- Criar migrations com `supabase migration new <nome>` durante execucao real; nao inventar nome de migration manualmente.
- Todo objeto exposto deve ter grants e RLS revisados. Nunca expor `service_role` no frontend.
- Storage com upsert exige permissao de `INSERT`, `SELECT` e `UPDATE` quando substituicao for permitida.
- Funcoes `SECURITY DEFINER` devem ser revisadas com cuidado e preferencialmente ficar fora de schemas publicamente expostos quando possivel.

### Meta e provedores WhatsApp

- Reaproveitar a base `meta` criada em migrations e servicos `meta-admin-service`, `meta-template-service`, `meta-webhook` e `meta-whatsapp-provider`.
- Integrar o provider registry ao fluxo real de envio antes de tratar Meta como canal operacional completo.
- Tratar modo `mock` e modo `live` como caminhos explicitos, com logs e criterios de aceite separados.

### IA e memoria

- Reaproveitar `crm.ai_agents`, `crm.ai_stage_rules`, `crm.ai_runs` e `crm.lead_ai_state`.
- Memoria de subfases deve ser uma camada versionada sobre o historico e runs existentes, nao uma substituicao do historico.
- Memoria vetorial, se adotada, deve ter isolamento por `aces_id`, trilha de origem e caminho de remocao/reindexacao.

## 5. Regras de implementacao para todas as sprints

- Ler arquivos relevantes antes de alterar qualquer codigo.
- Reaproveitar hooks, servicos e componentes existentes antes de criar novos.
- Nao criar duplicatas de estado, API client ou schema.
- Atualizar tipos TypeScript junto com qualquer contrato novo.
- Preservar permissoes multi-tenant por `aces_id`, `created_by`, instancia e role.
- Tratar erros com o padrao atual: `toast` no frontend, `HttpError`/respostas JSON no backend.
- Ao tocar Supabase, incluir migration, grants/RLS e teste de consulta.
- Ao tocar UI, validar responsividade e estados vazios/loading/erro.

## 6. Testes globais recomendados

- `npm run lint`
- `npm run build`
- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Teste manual do fluxo afetado em ambiente local.
- Para alteracoes Supabase: aplicar migration em ambiente de teste e validar consulta/RPC/policy.

## 7. Matriz de riscos

| Area | Risco | Mitigacao |
|---|---|---|
| Chat multimidia | Mudanca quebra historico e realtime | Versionar contrato e manter compatibilidade com texto |
| Storage | Arquivos publicos ou sem TTL | Bucket privado, signed URLs e limpeza automatizada |
| Meta | Rate limits e compliance Graph API | Modo mock, logs, retries e validacao por instancia |
| Automacao | Duplicidade de disparos | Idempotencia, locks, outbound echo registry e auditoria |
| IA | Alucinacao ou acao indevida | Thresholds, runs auditaveis, handoff e limites por etapa |
| RB | Contrato externo indefinido | Sprint 7 deve mapear contrato antes de Sprint 8 |
