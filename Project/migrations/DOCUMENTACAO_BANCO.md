# Documentação Técnica do Banco de Dados - Crm Arquem

Este documento descreve a arquitetura do banco de dados do Crm Arquem, abrangendo os schemas `Crm` e `public`, as políticas de segurança (RLS), funções automatizadas e a estrutura de multi-tenancy.

## 1. Visão Geral da Arquitetura

O sistema utiliza uma abordagem **Multi-tenant** baseada no campo `aces_id`. Cada empresa (account) possui um `aces_id` único que isola seus dados de Leads, Oportunidades, Configurações e Histórico.

### Schemas Principais:
- **`Crm`**: Contém as tabelas de negócio (Leads, Pipelines, Tarefas, Agendamentos).
- **`public`**: Contém tabelas de infraestrutura (Perfis de usuário, Billing, Configurações de LLM e Logs).
- **`auth`**: Gerido pelo Supabase, armazena as credenciais de acesso.

---

## 2. Estrutura de Negócio (Schema `Crm`)

### Tabelas Modulares
| Tabela | Descrição |
| :--- | :--- |
| `accounts` | Entidade mestra da empresa/tenancy. Controla o plano e limites. |
| `users` | Extensão do usuário auth dentro do Crm. Define o `role` (ADMIN/VENDEDOR). |
| `leads` | Coração do Crm. Armazena contatos, origem (`Fonte`), status e tags. |
| `pipeline_stages` | Define as etapas do funil de vendas por empresa. |
| `opportunities` | Registra valores financeiros e nível de conexão dos leads. |
| `message_history` | Log de interações (WhatsApp/Chat) vinculados a instâncias específicas. |
| `lead_remarketing`| Fila de mensagens automáticas para leads em status de remarketing. |
| `agendamentos` | Controle de compromissos com gatilhos automáticos de retorno. |

### Tipos Customizados (Enums)
- `Crm.user_role`: `ADMIN`, `VENDEDOR`, `NENHUM`.
- `Crm.lead_status`: `Novo`, `Atendimento`, `Orçamento`, `Fechado`, `Perdido`, `Remarketing`.

---

## 3. Infraestrutura e Billing (Schema `public`)

### Controle de Consumo
- **`billing_plans`**: Define limites de tokens e créditos mensais.
- **`billing_usage_cycles`**: Rastreia o consumo atual do usuário no ciclo vigente.
- **`llm_model_pricing`**: Tabela de referência para custos de entrada/saída de diferentes modelos (GPT-4o, Gemini, etc).

### Inteligência Artificial (Agentes)
- **`agents`**: Configurações de System Prompt e personas.
- **`agent_tables`**: Define quais tabelas o agente tem permissão para consultar.
- **`conversations` / `messages`**: Histórico de chat da interface do usuário.

---

## 4. Segurança e Isolamento (RLS)

O banco de dados implementa **Row Level Security (RLS)** em todas as tabelas críticas.

### Regras de Ouro:
1. **Isolamento por Empresa**: Quase todas as queries no schema `Crm` filtram por `aces_id` comparando o token do usuário logado.
2. **Propriedade de Dados**: No schema `public`, usuários só acessam suas próprias `conversations`, `llm_settings` e `user_profiles`.
3. **Controle Admin**: Apenas usuários com `role = 'ADMIN'` podem deletar leads ou gerenciar etapas do pipeline.

---

## 5. Automatizações (Gatilhos e Funções)

O banco é "vivo" e executa ações automáticas:

- **`sync_aces_id_to_jwt`**: Sempre que um usuário é vinculado a uma empresa no Crm, seu JWT (token de acesso) é atualizado com o `aces_id` para garantir que o RLS funcione instantaneamente no frontend.
- **`auto_add_to_remarketing`**: Quando um Lead é movido para o status "Remarketing", o sistema o insere automaticamente na tabela de agendamento de mensagens.
- **`billing_record_usage`**: Função central que calcula o custo de cada interação com IA e abate dos créditos do usuário.
- **`updated_at_column`**: Atualiza automaticamente o timestamp de modificação em todos os registros.

---

## 6. Como Aplicar

Para restaurar ou inicializar o ambiente:
1. Execute o arquivo `migrations/001_schema_completo.sql` no SQL Editor do seu projeto Supabase.
2. Certifique-se de que os Hooks de Auth estejam apontando para as funções de sincronização de perfil.

---
*Documentação gerada automaticamente para o Projeto Crm Arquem.*
