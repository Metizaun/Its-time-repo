# Diagnóstico de Não-Disparos

Período analisado: `29/04/2026` e `30/04/2026`  
Timezone de referência: `America/Sao_Paulo`

## Fonte de verdade usada

- `crm.automation_executions`
- `dispatch_meta.planned_at`
- `dispatch_meta.planned_dispatch_at`
- `crm.automation_enrollments`
- `crm.automation_holidays`

Observação: não encontrei uma tabela exposta como `crm.Logs` neste projeto. Para esta análise, os registros confiáveis vieram da fila de automação e dos enrollments.

## Regras confirmadas no banco

O comportamento de reagendamento é esperado pela lógica SQL atual:

- `crm.is_humanized_dispatch_window` só permite disparo entre `08:00` e `19:00`.
- `crm.resolve_humanized_dispatch_at`:
  - antes de `08:00`, agenda a partir de `08:00`;
  - a partir de `18:00`, já joga para o dia seguinte às `08:00`;
  - se a preparação terminar após `19:00`, empurra para o próximo dia útil;
  - se o dia for feriado nacional, pula o dia inteiro.
- `crm.rpc_plan_humanized_dispatch` serializa a fila por instância/funil e aplica cadência humanizada, o que empurra os próximos disparos cada vez mais para frente.

## Feriado confirmado

Em `crm.automation_holidays` existe:

- `2026-05-01`: `Dia do trabalho`

Isso confirma que o motor tinha motivo para pular `01/05/2026`.

## Reagendamentos esperados

### Evidência de 29/04/2026

Na instância `prospect`, encontrei `504` execuções cujo `dispatch_meta.planned_at` foi gravado em `29/04/2026`.

Distribuição do `planned_dispatch_at` dessas execuções:

- `30/04/2026`: `102`
- `02/05/2026`: `108`
- `03/05/2026`: `111`
- `04/05/2026`: `110`
- `05/05/2026`: `73`

Amostra real:

- planejado em `29/04/2026 16:49:33` -> disparo previsto para `30/04/2026 12:02:43`
- planejado em `29/04/2026 16:49:33` -> disparo previsto para `30/04/2026 12:07:43`
- planejado em `29/04/2026 16:49:33` -> disparo previsto para `30/04/2026 12:13:45`

Isso prova que já em `29/04/2026` o sistema empurrou parte da fila para `30/04/2026` e parte para depois do feriado.

### Evidência de 30/04/2026

Na leitura local do dia `30/04/2026`, encontrei:

- `DecolaSuperin`: `15` execuções `pending`
  - `10` com `planned_dispatch_at` em `04/05/2026`
  - `5` com `planned_dispatch_at` em `05/05/2026`
- `Juan`: `132` execuções `pending`
  - todas apontando majoritariamente para `03/05/2026`
- `prospect`: `38` execuções `pending`
  - espalhadas entre `30/04`, `02/05`, `03/05`, `04/05`, `05/05` e `06/05`

Conclusão operacional:

- o sistema não “travou” por si só;
- ele estava replanejando a fila para horários mais tardios;
- o feriado de `01/05/2026` agravou esse empurrão;
- a cadência sequencial por instância/funil fez o efeito cascata crescer ao longo do dia.

## Cancelamentos reais

### 30/04/2026 por instância

#### `DecolaSuperin`

- `15` execuções no recorte
- `15` permaneceram `pending`
- `0` cancelamentos no recorte analisado

#### `Juan`

- `151` execuções no recorte
- `132` ficaram `pending`
- `19` foram `cancelled`

Motivos:

- `18` x `Cancelado por alteracao do funil`
- `1` x `Lead respondeu inbound`

#### `prospect`

- `834` execuções no recorte
- `38` ficaram `pending`
- `796` foram `cancelled`

Motivos:

- `726` x `Cancelado por alteracao do funil`
- `46` x `Enrollment inativo`
- `24` x `replaced_by_latest_today`

## Caso manual: `pending -> processing -> cancelled`

Execução analisada:

- `automation_executions.id = c5aa2875-fabc-440a-8a59-e6e22c8d88da`
- `instance_snapshot = prospect`
- `funnel_name_snapshot = Disparo inicial`
- `last_error = Enrollment inativo`
- `completed_reason = Enrollment inativo`

Enrollment relacionado:

- `automation_enrollments.id = 8ec04974-fcc2-43f1-bbc4-3c817bbbd297`
- `status = cancelled`
- `stopped_reason = Automacao desativada`
- `updated_at = 29/04/2026 17:44:21`

Conclusão:

- quando a execução voltou para processamento, o enrollment já não estava mais ativo;
- portanto o cancelamento foi comportamento esperado da RPC `crm.rpc_claim_due_automation_executions_v2`;
- não foi falha do worker de envio.

## Causa do atraso progressivo

O atraso progressivo veio da soma de quatro fatores:

1. janela humanizada limitada a `08:00–19:00`;
2. corte prático já a partir de `18:00` para não estourar a preparação;
3. fila sequencial por instância/funil com espaçamento entre execuções;
4. salto obrigatório sobre o feriado de `01/05/2026`.

Em termos práticos:

- o que não coube em `29/04/2026` foi empurrado para `30/04/2026`;
- o que não coube em `30/04/2026` ou conflitou com a cadência foi empurrado para `02/05`, `03/05`, `04/05`, `05/05` e até `06/05`;
- parte da fila ainda foi destruída por mudança de funil ou perda de elegibilidade.

## Conclusão final

O problema não foi único. Houve dois fenômenos ao mesmo tempo:

- `Reagendamento esperado`: a política humanizada + fila sequencial + feriado empurrou execuções para horários e dias posteriores.
- `Cancelamento real`: muitas execuções deixaram de ser elegíveis e foram canceladas por `alteracao do funil`, `Enrollment inativo` ou resposta do lead.

Leitura objetiva:

- `DecolaSuperin` está com perfil majoritário de reagendamento.
- `Juan` está misto: bastante reagendamento, com uma parcela de cancelamento estrutural.
- `prospect` foi o caso mais crítico: além de reagendamento, sofreu cancelamento em massa por alteração do funil e por enrollments já inativos.
