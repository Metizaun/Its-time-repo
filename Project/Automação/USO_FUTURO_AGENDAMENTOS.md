# Uso Futuro de `crm.agendamentos`

## Resumo

Na V1 da automação, **`crm.agendamentos` não participa do motor de disparo**.

A automação atual é baseada apenas em:

- entrada do lead em uma etapa do funil
- delays relativos a essa entrada
- geração de execuções em `crm.automation_executions`

`crm.agendamentos` continua existindo no banco porque ela representa outro conceito de negócio.

## O que `crm.agendamentos` representa

`crm.agendamentos` guarda o **compromisso real do lead**:

- consulta
- visita
- retorno
- reunião
- atendimento agendado

Ou seja:

- `data_agendamento` = quando o evento do lead vai acontecer
- `retorno_3d`, `retorno_2d`, `retorno_1d`, `retorno_1h` = marcos derivados desse compromisso

Ela **não é** a tabela de agendamento da mensagem automática.

## Onde a mensagem agendada vive

Na arquitetura da automação:

- `crm.pipeline_stages` define a etapa do lead
- `crm.automation_funnels` define o gatilho do funil
- `crm.automation_steps` define os disparos
- `crm.automation_executions` guarda cada mensagem programada

Então:

- compromisso do lead = `crm.agendamentos`
- mensagem programada = `crm.automation_executions`

## Por que `crm.agendamentos` ficou fora da V1

Hoje não existe uma origem operacional confiável alimentando essa tabela.

Contexto atual:

- o fluxo antigo do n8n não está mais em uso
- a IA futura ainda não está preenchendo `crm.agendamentos`
- depender dela agora deixaria a automação inconsistente

Se a V1 dependesse dessa tabela, o sistema poderia ter:

- automações sem data de referência
- lembretes órfãos
- follow-ups não disparados
- comportamento diferente entre contas

## Regra adotada para a V1

Na V1:

- manter `crm.agendamentos`
- não remover a tabela
- não usar a tabela como dependência da automação
- basear a automação apenas em entrada em etapa do pipeline

Essa decisão reduz risco e permite colocar a automação em produção com previsibilidade.

## Quando `crm.agendamentos` entra no produto

`crm.agendamentos` volta para a automação em uma V2, quando existir um produtor confiável dessa informação.

Exemplos válidos:

- IA criando o agendamento ao marcar reunião
- backend próprio criando e atualizando agendamentos
- integração externa substituindo o antigo n8n

## Pré-condições para ativar a V2

Antes de usar `crm.agendamentos` na automação, o projeto precisa garantir:

1. Existe um fluxo estável criando agendamentos.
2. Existe tratamento para atualização de horário.
3. Existe tratamento para cancelamento do compromisso.
4. A tabela está protegida por RLS.
5. O sistema sabe reagendar ou cancelar execuções pendentes quando o compromisso mudar.

## Desenho esperado para a V2

Quando a V2 for implementada, os gatilhos passam a incluir eventos de compromisso, por exemplo:

- `appointment_created`
- `appointment_updated`
- `appointment_cancelled`

E os tipos de disparo podem incluir:

- X minutos antes da reunião
- X horas antes da reunião
- X minutos após a reunião
- X horas após a reunião

Nesse cenário:

- `crm.agendamentos` fornece a referência temporal do compromisso
- `crm.automation_executions` continua sendo a fila real de mensagens

## Nota importante

Mesmo na V2, a regra continua:

**`crm.agendamentos` agenda o evento do lead.**

**`crm.automation_executions` agenda a mensagem.**
