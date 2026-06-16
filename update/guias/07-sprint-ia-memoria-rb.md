# Sprint 7 - IA Fase 1 e Preparacao RB

## 1. Contexto

Sprint focada em evoluir a memoria dos agentes e preparar a integracao com RB. Esta sprint deve priorizar contrato, auditoria e seguranca antes de recursos avancados.

Tarefas de referencia:

- 7.1 Estruturar sistema para memoria de agente em subfases.
- 7.2 Mapear endpoints e iniciar desenvolvimento da integracao principal com RB.

## 2. Diagnostico do codigo atual

### O que ja existe

- `crm.ai_agents` guarda configuracao do agente por instancia.
- `crm.ai_stage_rules` guarda regras por etapa.
- `crm.ai_runs` registra execucoes, snapshots, tokens, confianca e acoes.
- `crm.lead_ai_state` controla estado por lead, freeze, pausa e ultimo processamento.
- `Project/IA/sdr-agent-gemini.ts` classifica conversa, aplica etapa, responde, congela e faz handoff.
- `src/components/modals/AgentConfigModal.tsx` permite configurar prompt, tom, handoff e teste.
- `src/lib/aiPrompt.ts` tem secoes de prompt e menciona memoria/ChatMemory como conceito.

### Lacunas

- Nao ha memoria vetorial ou tabela dedicada de memoria semantica.
- Nao ha conceito persistente de "subfase" alem de etapas/regras.
- Nao ha contrato RB no repo.
- Nao ha endpoints RB, cliente RB ou envs RB identificados.
- Nao ha politica de retencao/reindexacao de memoria.

## 3. Arquivos provaveis

| Arquivo | Motivo | Risco |
|---|---|---|
| `Project/IA/sdr-agent-gemini.ts` | Consumir memoria/subfase na classificacao | Alto |
| `Project/IA/api-server.ts` | Endpoints de configuracao/diagnostico | Medio |
| `src/components/modals/AgentConfigModal.tsx` | UI para subfases/memoria se exposta ao Admin | Medio |
| `src/hooks/useAgents.ts` | Persistir novos campos/configs | Medio |
| `src/lib/aiPrompt.ts` | Orientar prompt com memoria/subfase | Baixo |
| `supabase/migrations/*` | Tabelas de memoria/subfase/RB mapping | Alto |
| Novo `Project/IA/rb-*.ts` | Cliente e contrato RB | Alto |

## 4. Proposta tecnica

### Memoria de agente em subfases

Definir "subfase" como estado cognitivo dentro de uma etapa do funil, sem substituir `pipeline_stages`.

Exemplos:

- `descoberta`: coletar necessidade.
- `qualificacao`: entender potencial.
- `proposta`: apresentar solucao.
- `objecao`: responder duvidas.
- `handoff`: transferir para humano.

Contrato recomendado:

```sql
crm.ai_agent_subphases (
  id uuid primary key,
  agent_id uuid not null references crm.ai_agents(id) on delete cascade,
  name text not null,
  description text not null,
  entry_signals jsonb not null default '[]',
  exit_signals jsonb not null default '[]',
  priority integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
)
```

Estado por lead:

```sql
crm.ai_lead_memory_state (
  agent_id uuid not null,
  lead_id uuid not null,
  current_subphase_id uuid,
  summary text,
  facts jsonb not null default '{}',
  last_refreshed_at timestamptz,
  primary key (agent_id, lead_id)
)
```

### Memoria semantica

- V1 pode usar resumo estruturado em Postgres antes de adotar vetor.
- Se vetor for necessario, usar pgvector/Supabase Vector com isolamento por `aces_id`, `agent_id` e `lead_id`.
- Toda memoria deve ter fonte: mensagem, run, importacao manual ou sistema.

### Preparacao RB

- Criar documento/contrato antes do cliente:
  - base URL;
  - auth;
  - endpoints;
  - idempotency key;
  - timeouts;
  - retries;
  - payloads de cobranca/cliente/status;
  - webhooks de retorno.
- Criar cliente RB apenas apos contrato minimo.
- Nao acoplar agente de cobranca ao RB nesta sprint; preparar adaptador.

## 5. Ordem de execucao

1. Definir semanticamente o que e subfase para o produto.
2. Criar migration de subfases e estado de memoria, com RLS/grants.
3. Atualizar preflight do backend.
4. Ajustar prompt/classificacao para considerar subfase atual e sugerida.
5. Registrar mudancas de subfase em `ai_runs`.
6. Criar UI Admin simples para visualizar/configurar subfases, se necessario.
7. Mapear contrato RB em Markdown ou tipos TypeScript.
8. Criar cliente RB em modo mock apenas se contrato estiver definido.

## 6. Criterios de aceite

- Agente pode ter subfases configuradas por instancia/agente.
- Lead pode manter estado de subfase e resumo/fatos.
- Classificacao registra subfase sugerida/aplicada em run auditavel.
- Memoria nao vaza entre contas, instancias ou leads.
- Contrato RB esta documentado com auth, endpoints, payloads, erros e idempotencia.
- Nenhuma chamada real RB acontece sem flag/env explicita.

## 7. Riscos e mitigacoes

| Risco | Probabilidade | Mitigacao |
|---|---|---|
| Subfase conflitar com etapa do funil | Media | Subfase e estado cognitivo, etapa continua operacional |
| Memoria guardar dado sensivel sem controle | Alta | Fonte, escopo, retencao e remocao |
| Vetor aumentar custo/complexidade cedo | Media | Comecar com resumo estruturado |
| RB sem contrato real | Alta | Travar integracao real ate contrato documentado |

## 8. Testes

- `npm --prefix Project/IA run build`
- `npm --prefix Project/IA run schema:check`
- Teste de RLS para memoria/subfases.
- Teste de classificacao com e sem subfase atual.
- Teste de run registrando decisao de subfase.
- Teste mock de cliente RB, se criado.

## 9. Pontos de atencao

- Nao chamar isso de "memoria vetorial" se v1 for resumo Postgres.
- Nao misturar contrato RB com logica de cobranca final.
- Garantir capacidade de apagar/recriar memoria por lead/agente.

