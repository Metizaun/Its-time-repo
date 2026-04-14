# Guia de Refatoração — Automação

> Plano técnico para corrigir o módulo `Automação` respeitando o desenho já existente no repositório.

---

## 1. Base real do projeto

Esta refatoração deve partir do que já existe hoje no código e no banco.

### 1.1 O que já existe

- `src/pages/Automacao.tsx` já faz CRUD de automações
- `src/hooks/useAutomation.ts` já conversa com `crm.automation_funnels`, `crm.automation_steps` e `crm.automation_executions`
- a migration `supabase/migrations/20260411190000_add_automation_v1.sql` já criou o motor V1
- `Project/IA/automation-worker.ts` já processa execuções pendentes
- `src/hooks/usePipelineStages.ts` já entrega as etapas do CRM
- `src/hooks/useInstances.ts` já entrega as instâncias disponíveis
- `crm.ai_agents` já guarda o prompt do agente em `system_prompt`
- `Project/IA/api-server.ts` já expõe `GET /api/agents` e `PATCH /api/agents/:id`

### 1.2 O que não pode ser assumido

- não existe tabela `automations`
- não existe `delay_unit` no schema atual
- não existe `agent_prompt` em `crm.instance`
- a automação atual não depende de `crm.agendamentos`
- o worker atual envia apenas texto

Esses pontos precisam ser corrigidos na documentação para não desalinhar a implementação.

---

## 2. Escopo correto da correção

O que precisa entrar nesta refatoração:

1. modal para editar o agente de IA da instância, alterando apenas o prompt atual
2. tela de automação em formato Kanban por etapa do pipeline
3. criação de mais de uma mensagem dentro da mesma automação
4. opção de enviar imagem junto da mensagem
5. aviso de uso futuro com tags, sem implementar tags agora

O que deve ficar fora:

- automações baseadas em `crm.agendamentos`
- regras de envio “antes de evento”
- filtros reais por tag no motor
- mudanças amplas no módulo Admin

O documento `Project/Automação/USO_FUTURO_AGENDAMENTOS.md` já define que `crm.agendamentos` fica para V2. A refatoração precisa respeitar isso.

---

## 3. Mapeamento funcional no modelo atual

Para evitar reinventar o produto, o mapeamento da interface deve seguir o schema existente:

- **coluna do Kanban** = etapa do pipeline (`crm.pipeline_stages`)
- **cartão do Kanban** = automação (`crm.automation_funnels`)
- **mensagens dentro da automação** = disparos (`crm.automation_steps`)

Esse desenho resolve o pedido do usuário sem trocar a arquitetura:

- uma etapa pode ter várias automações
- cada automação pode ter várias mensagens
- o motor de execução continua igual: entrada do lead na etapa gera execuções

---

## 4. Função 1 — Edição de instância

### 4.1 Regra correta

A edição do agente não deve escrever em `crm.instance`.

O prompt atual está em:

- `crm.ai_agents.system_prompt`

O vínculo com a instância acontece por:

- `crm.ai_agents.instance_name`

### 4.2 Integração correta

Não usar `instanceService` para atualizar prompt, porque ele trata ciclo de vida da instância, não configuração do agente.

O caminho correto é criar um serviço específico, por exemplo:

- `src/services/agentService.ts`

Esse serviço deve:

- listar agentes via `GET /api/agents`
- localizar o agente da instância pelo `instanceName`
- criar agente via `POST /api/agents` (somente quando o usuário solicitar)
- salvar o prompt via `PATCH /api/agents/:id`

### 4.3 Componente sugerido

Criar:

- `src/components/modals/EditInstanceAgentModal.tsx`

Responsabilidades:

- receber `instanceName`
- permitir selecionar a instância quando o filtro da página estiver em `Todas`
- carregar o agente vinculado
- criar agente via ação explícita do usuário
- liberar a edição do prompt somente após a criação do agente
- salvar somente `systemPrompt`

### 4.4 Comportamento esperado

- a primeira etapa do modal é `Criar agente`
- o agente deve ser criado já vinculado à instância escolhida
- se existir agente para a instância, o modal entra direto na etapa de configuração
- se não existir agente, mostrar a criação e liberar o prompt somente após o vínculo
- não criar agente automaticamente nesta entrega (somente via ação do usuário)
- substituir checklist genérico por etapas reais do template de `Project/IA/Prompt.md`, marcando o que é obrigatório e opcional

Isso mantém o comportamento previsível e não adiciona efeitos colaterais.

---

## 5. Função 2 — Pipeline de mensagens

### 5.1 Problema atual

A página atual trabalha em duas áreas:

- lista de funis à esquerda
- edição e disparos à direita

Funciona para V1, mas não entrega a leitura operacional pedida pelo usuário.

### 5.2 Refatoração da página

`src/pages/Automacao.tsx` deve ser reorganizada para:

- carregar etapas com `usePipelineStages()`
- carregar automações com `useAutomation()`
- montar um board horizontal agrupado por `trigger_stage_id`

Fluxo visual:

- coluna = etapa
- botão `+` da coluna cria automação naquela etapa
- cartão da automação abre modal para gerenciar mensagens

### 5.3 Estrutura recomendada

Separar a página em poucos componentes, sem exagerar:

- `src/pages/Automacao.tsx`
- `src/components/automation/AutomationBoard.tsx`
- `src/components/automation/AutomationColumn.tsx`
- `src/components/automation/AutomationCard.tsx`
- `src/components/modals/AutomationMessageModal.tsx`

O board não precisa reusar o Kanban de leads, porque a interação aqui é outra. A semelhança deve ser visual, não estrutural.

---

## 6. Regra temporal desta entrega

Para respeitar o motor já implementado no banco, a automação continua baseada apenas na entrada do lead na etapa.

### 6.1 Campo `Quando`

No formulário da mensagem:

- `Na entrada do funil`
- `Depois de`

Mapeamento no banco:

- `Na entrada do funil` = `delay_minutes = 0`
- `Depois de` = `delay_minutes > 0`

### 6.2 Validação

- não aceitar valor negativo
- se `Depois de`, exigir inteiro maior que zero
- se `Na entrada`, salvar `0`

Como a referência temporal é a entrada na etapa, o sistema já evita o problema de enviar em horário passado.

### 6.3 O que não entra agora

Não adicionar nesta refatoração:

- antes do agendamento
- depois do agendamento
- regras baseadas em data externa

Essas regras só entram quando a V2 com `crm.agendamentos` for oficialmente ativada.

---

## 7. Várias mensagens na mesma automação

O projeto já suporta isso naturalmente via `crm.automation_steps`.

Logo, a interface deve permitir:

- criar a automação
- entrar nela
- adicionar várias mensagens ordenadas por tempo

O alerta de produto deve existir no modal:

`Esta estrutura permite múltiplas automações na mesma etapa para uso futuro com tags. Tags não fazem parte desta implementação.`

Esse texto entra apenas como orientação. Nenhuma lógica de tag deve ser criada agora.

---

## 8. Suporte a imagem

### 8.1 Situação atual

Hoje:

- `crm.automation_steps` não guarda imagem
- `Project/IA/automation-worker.ts` só envia texto por `sendText`

### 8.2 Mudança mínima necessária

Criar uma migration nova e aditiva:

```sql
ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS image_url text;
```

Essa é a menor alteração possível para cumprir o pedido sem desmontar o modelo atual.

### 8.3 Regra de envio

Quando `image_url` estiver preenchido:

- o worker deve enviar imagem
- `message_template` continua sendo a legenda renderizada

Quando `image_url` estiver vazio:

- o worker mantém o envio de texto atual

### 8.4 Frontend

O modal de mensagem deve permitir:

- upload opcional de imagem
- preview simples
- remoção da imagem antes de salvar

### 8.5 Persistência

`src/hooks/useAutomation.ts` precisa aceitar `image_url` no payload de criação e edição de `automation_steps`.

---

## 9. Ajustes no hook de automação

`src/hooks/useAutomation.ts` deve ser ajustado para o novo formato de tela.

### 9.1 Tipos

Adicionar em `AutomationStep`:

- `image_url: string | null`

### 9.2 Payloads

Atualizar `StepPayload` para incluir:

- `image_url?: string | null`

### 9.3 Leitura para o board

O hook precisa continuar servindo CRUD, mas também precisa facilitar o agrupamento do board:

- funis por etapa
- quantidade de mensagens por automação
- resumo do primeiro disparo

Se isso puder ser resolvido no `useMemo` da página, melhor do que criar uma camada desnecessária.

---

## 10. Arquivos impactados

### 10.1 Frontend

- `src/pages/Automacao.tsx`
- `src/hooks/useAutomation.ts`
- `src/services/agentService.ts` novo
- `src/components/modals/EditInstanceAgentModal.tsx` novo
- `src/components/modals/AutomationMessageModal.tsx` novo
- `src/components/automation/AutomationBoard.tsx` novo
- `src/components/automation/AutomationColumn.tsx` novo
- `src/components/automation/AutomationCard.tsx` novo

### 10.2 Backend / worker

- `Project/IA/automation-worker.ts`

### 10.3 Banco

- nova migration versionada para `crm.automation_steps.image_url`

---

## 11. Regras de implementação

Para manter consistência com o repositório:

- continuar usando `Card`, `Dialog`, `Select`, `Textarea`, `Alert`, `Badge`, `Switch`
- continuar tratando a página como acesso exclusivo de `ADMIN`
- não trocar o motor atual de execução
- não mover a lógica para um sistema paralelo
- não adicionar dependências novas sem necessidade
- não duplicar serviço de instância para editar agente

---

## 12. Critérios de aceite

- [ ] o board exibe uma coluna por etapa do pipeline
- [ ] cada coluna mostra as automações ligadas à etapa
- [ ] cada automação permite múltiplas mensagens
- [ ] o modal da instância edita apenas o prompt do agente já vinculado
- [ ] o campo `Quando` suporta `Na entrada` e `Depois de`
- [ ] `delay_minutes = 0` representa envio imediato
- [ ] valores negativos são bloqueados
- [ ] a mensagem pode ter imagem opcional
- [ ] o worker envia texto quando não há imagem
- [ ] o worker envia imagem com legenda quando `image_url` existir
- [ ] o aviso de uso futuro com tags aparece na interface
- [ ] nenhuma regra nova depende de `crm.agendamentos`
