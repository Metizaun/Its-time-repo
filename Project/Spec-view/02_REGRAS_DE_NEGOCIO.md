# Regras de Negócio — Crm Arquem

> Este documento define todas as regras, restrições e políticas operacionais que governam o comportamento do software. Qualquer desenvolvedor que alterar uma funcionalidade deve verificar se as regras aqui documentadas foram respeitadas.

---

## 1. Regras de Acesso e Permissões

### RN-01 — Autenticação Obrigatória
Todas as rotas da aplicação (exceto `/auth`) exigem sessão ativa. Usuários não autenticados são redirecionados automaticamente para `/auth`.

### RN-02 — Isolamento por Empresa (Multi-Tenancy)
Um usuário **só pode ver e manipular dados da sua própria empresa** (`aces_id`). Essa restrição é implementada no banco de dados via RLS. Não existe contorno via frontend — qualquer tentativa de acessar dados de outro `aces_id` é rejeitada pelo Supabase.

### RN-03 — Bloqueio de Usuários sem Aprovação
Usuários com `role = NENHUM` ficam com acesso bloqueado por um modal em todas as páginas (exceto `/auth`). O desbloqueio **só pode ser feito por um ADMIN** alterando o campo `role` para `VENDEDOR` ou `ADMIN`.

### RN-04 — Restrição de Acesso ao Módulo Admin
A rota `/admin` é **exclusiva para usuários com `role = ADMIN`**. Qualquer outro role é redirecionado para `/` sem exposição de mensagem de erro.

### RN-05 — Convites com Prazo de Validade
Convites enviados por ADMIN expiram automaticamente em **7 dias**. Após a expiração, o convite passa para status `expired` e não pode ser aceito.

---

## 2. Regras de Gestão de Leads

### RN-06 — Nunca Deletar Leads
Leads **jamais devem ser deletados fisicamente**. O arquivamento é feito setando `view = false`. Isso preserva o histórico de mensagens, oportunidades e agendamentos vinculados.

### RN-07 — Campo `view` como Controle de Visibilidade
- `view = true`: Lead ativo, aparece em todas as listagens.
- `view = false`: Lead arquivado, invisível para o usuário final.
- A query de carregamento de leads **sempre** filtra por `view = true`.

### RN-08 — Ordenação de Leads por Atividade Recente
A lista de leads é ordenada pela seguinte prioridade:
1. Leads com `last_message_at` preenchido aparecem antes dos sem mensagem.
2. Entre os com mensagem: mais recente primeiro (`last_message_at DESC`).
3. Em caso de empate: `created_at DESC`.

### RN-09 — Criação de Lead com Oportunidade Vinculada
Se ao criar um lead forem fornecidos `value` (valor) ou `connection_level` (nível de conexão), uma **oportunidade é criada automaticamente** e vinculada ao lead no mesmo fluxo de criação.

### RN-10 — Atribuição de Etapa ao Criar Lead
Se um `stage_id` for fornecido durante a criação, o lead é inserido e em seguida a RPC `rpc_move_lead_to_stage` é chamada para garantir a consistência entre `stage_id` e `status` no banco.

---

## 3. Regras do Pipeline (Funil de Vendas)

### RN-11 — Movimentação via RPC
A movimentação de um lead entre etapas **obrigatoriamente** passa pela função `rpc_move_lead_to_stage`. Um UPDATE direto em `Crm.leads.stage_id` é proibido no contexto da aplicação, pois ignora as sincronizações de status implementadas no banco.

### RN-12 — Categoria da Etapa como Classificação de KPI
Cada etapa do pipeline pertence a uma de três categorias:

| Categoria | Significado para KPIs |
| :--- | :--- |
| `Aberto` | Lead em andamento, negociação ativa |
| `Ganho` | Negócio fechado (equivale ao status "Fechado") |
| `Perdido` | Lead desqualificado ou perdido |

O funil e as métricas do Dashboard usam essa categorização para calcular taxas de conversão.

### RN-13 — Impedimento de Exclusão de Etapa com Leads Ativos
Uma etapa **não pode ser excluída** se houver leads com `view = true` nela, a menos que o usuário selecione uma outra etapa para onde os leads serão migrados automaticamente.

### RN-14 — Autoincremento de Posição
Ao criar uma nova etapa, sua `position` é automaticamente definida como `max(position) + 1`, garantindo que apareça no final do kanban.

### RN-15 — Reordenação em Lote
Ao arrastar e soltar etapas no kanban, todas as posições são atualizadas em paralelo. Em caso de erro em qualquer atualização, o estado visual é revertido e os dados são recarregados do banco.

---

## 4. Regras do Dashboard e Métricas

### RN-16 — Filtro de Período é Global
O filtro de período selecionado no Dashboard (Hoje, 7 dias, 30 dias, Total) é armazenado no `AppContext` e afeta todos os gráficos e KPIs simultaneamente.

### RN-17 — Filtro de Instância é Local
O filtro por instância WhatsApp é exclusivo do Dashboard e não persiste entre sessões ou navegações.

### RN-18 — Receita Total considera apenas leads "Fechado"
O KPI de **Receita Total** soma `value` apenas dos leads cujo status seja `"Fechado"`. Leads em outras etapas, mesmo com valor cadastrado, não entram no cálculo.

### RN-19 — Taxa de Conversão com base no período filtrado
A **Taxa de Conversão** é calculada como `(leads Ganhos / total de leads no período) × 100`. Alterar o filtro de período altera o denominador e, portanto, a taxa exibida.

---

## 5. Regras do Sistema de Chat (IA)

### RN-20 — Autenticação Obrigatória na Edge Function
Toda chamada para `/functions/v1/chat` deve incluir o **JWT do usuário** no header `Authorization: Bearer <token>`. Chamadas sem token são rejeitadas com HTTP 401.

### RN-21 — Contabilização de Tokens
Cada interação com o LLM registra automaticamente o consumo de tokens em `billing_usage_events` e atualiza o acumulado em `billing_usage_cycles`. Não existe interação gratuita fora do plano.

### RN-22 — Limite de Créditos por Ciclo
O sistema verifica `remaining_credits` antes de processar uma nova mensagem. Se o limite do plano for atingido, a interação é bloqueada. O ciclo de billing é baseado no `billing_anchor_day` configurado no perfil do usuário.

### RN-23 — Histórico de Conversa por Usuário
Cada usuário vê apenas suas próprias conversas (`conversations.user_id = auth.uid()`). Não existe chat compartilhado entre usuários da mesma empresa.

---

## 6. Regras do Módulo Remarketing

### RN-24 — Auto-inscrição no Remarketing
Quando um lead tem seu status alterado para `"Remarketing"`, o banco de dados **automaticamente** o insere na tabela `Crm.lead_remarketing` via trigger. O frontend não precisa fazer nenhuma operação adicional.

### RN-25 — Auto-remoção do Remarketing
Quando o status de um lead é alterado de `"Remarketing"` para qualquer outro status, o banco **automaticamente** cancela a entrada ativa em `Crm.lead_remarketing` (status muda para `cancelled`).

### RN-26 — Proteção contra Duplicatas
A coluna `lead_id` em `Crm.lead_remarketing` é `UNIQUE`. Se o lead já estiver na fila e for reinserido, a operação faz um `ON CONFLICT DO UPDATE`, reiniciando o ciclo de remarketing sem criar duplicatas.

---

## 7. Regras de Agendamentos

### RN-27 — Colunas de Retorno Geradas Automaticamente
Ao inserir um agendamento com `data_agendamento`, o banco calcula automaticamente as colunas de alerta:
- `retorno_3d`: 3 dias antes
- `retorno_2d`: 2 dias antes
- `retorno_1d`: 1 dia antes
- `retorno_1h`: 1 hora antes

Essas colunas são `GENERATED ALWAYS` — **nunca as atualize manualmente**.

---

## 8. Regras de Dados e Integridade

### RN-28 — Timestamps Automáticos
Todas as tabelas relevantes possuem triggers automáticos para atualizar `updated_at` em qualquer UPDATE. Nunca é necessário passar `updated_at` manualmente em operações de escrita.

### RN-29 — Constraint de Username
O campo `username` em `user_profiles` deve seguir o padrão `^[a-z0-9_]{3,30}$` (minúsculas, números e underscore, 3 a 30 caracteres). Qualquer violação é rejeitada pelo banco.

### RN-30 — Queries no Chat: Somente Schema Public
A função `app_execute_safe_query` aceita apenas queries `SELECT` no schema `public`. Tentativas de acessar schemas como `Crm`, `auth`, ou de executar DML (`INSERT`, `UPDATE`, `DELETE`) são **bloqueadas** com exceção.

---

## 9. Regras de Nomenclatura e Convenções de Código

### RN-31 — Fontes de dados no Frontend
| O que | Onde buscar |
| :--- | :--- |
| Lista de leads | Hook `useLeads` → view `v_lead_details` |
| Etapas do pipeline | Hook `usePipelineStages` → tabela `Crm.pipeline_stages` |
| Usuários da empresa | Hook `useCrmUsers` → `Crm.users` + `Crm.user_invitations` |
| Instâncias WhatsApp | Hook `useInstances` → `Crm.instance` |

### RN-32 — Notificação de Atualização entre Hooks
Para forçar um refetch de leads após uma operação (ex: mover lead), use:
```typescript
import { notifyLeadsUpdated } from "@/hooks/useLeads";
notifyLeadsUpdated(); // dispara Custom Event global
```
Isso evita prop drilling e mantém os hooks desacoplados.

### RN-33 — Operações de Pipeline via RPC
| Operação | RPC/Método correto |
| :--- | :--- |
| Mover lead de etapa | `rpc_move_lead_to_stage` |
| Atualizar status do lead | `rpc_update_lead_status` |
| Criar oportunidade | `rpc_create_opportunity` |

Nunca substitua RPCs por updates diretos — as RPCs encapsulam lógica de validação e sincronização que não existe no frontend.
