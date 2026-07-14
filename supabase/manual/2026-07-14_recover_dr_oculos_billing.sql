-- Recuperacao controlada do lote RB da conta 5 em 14/07/2026.
-- Execute somente depois do deploy do automation-worker com os aliases corrigidos.
-- Este arquivo termina em ROLLBACK de proposito: valide o resultado e troque a
-- ultima instrucao por COMMIT apenas na janela aprovada para os reenvios.

BEGIN;

DO $$
DECLARE
  v_owner_id uuid;
  v_invalid_funnels integer;
BEGIN
  SELECT NULLIF(tool.config->>'default_owner_id', '')::uuid
  INTO v_owner_id
  FROM agents.agent_tools tool
  WHERE tool.aces_id = 5
    AND tool.tool_key = 'rb_billing'
    AND tool.is_enabled IS TRUE
  LIMIT 1;

  IF v_owner_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM crm.users crm_user
    WHERE crm_user.id = v_owner_id
      AND crm_user.aces_id = 5
      AND crm_user.role <> 'NENHUM'
  ) THEN
    RAISE EXCEPTION 'Responsavel RB valido nao encontrado na configuracao da conta 5';
  END IF;

  SELECT count(*)
  INTO v_invalid_funnels
  FROM crm.automation_funnels
  WHERE aces_id = 5
    AND entry_source = 'rb'
    AND created_by IS DISTINCT FROM v_owner_id;

  IF v_invalid_funnels > 0 THEN
    RAISE EXCEPTION 'Ainda existem funis RB vinculados a outro responsavel';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM rb.lead_metadata metadata
    JOIN crm.leads lead ON lead.id = metadata.lead_id
    WHERE metadata.aces_id = 5
      AND (metadata.last_sync_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-07-14'
      AND lead.owner_id IS DISTINCT FROM v_owner_id
  ) THEN
    RAISE EXCEPTION 'Ainda existem leads do lote vinculados a outro responsavel';
  END IF;
END;
$$;

-- Reabre somente as duas execucoes que falharam pelas variaveis corrigidas.
UPDATE crm.automation_executions execution
SET
  status = 'pending',
  scheduled_at = now(),
  last_error = NULL,
  claimed_by = NULL,
  provider_error_code = NULL,
  provider_error_message = NULL,
  updated_at = now()
WHERE execution.aces_id = 5
  AND execution.sent_at IS NULL
  AND execution.status = 'failed'
  AND (execution.created_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-07-14'
  AND execution.last_error IN (
    'Mensagem contem variavel nao resolvida: {DtVencimento}',
    'Mensagem contem variavel nao resolvida: {valor_liquido}'
  );

-- Reavalia somente contatos sincronizados no lote que nao ganharam execucao no dia.
DO $$
DECLARE
  v_lead_id uuid;
BEGIN
  FOR v_lead_id IN
    SELECT lead.id
    FROM rb.lead_metadata metadata
    JOIN crm.leads lead ON lead.id = metadata.lead_id
    WHERE metadata.aces_id = 5
      AND (metadata.last_sync_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-07-14'
      AND NOT EXISTS (
        SELECT 1
        FROM crm.automation_executions execution
        WHERE execution.lead_id = lead.id
          AND (execution.created_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-07-14'
      )
  LOOP
    PERFORM crm.handle_entry_event(v_lead_id, 'stage_entered_at');
  END LOOP;
END;
$$;

SELECT
  lead.name,
  execution.status,
  execution.scheduled_at,
  funnel.name AS funnel_name,
  execution.last_error
FROM crm.automation_executions execution
JOIN crm.leads lead ON lead.id = execution.lead_id
JOIN crm.automation_funnels funnel ON funnel.id = execution.funnel_id
WHERE execution.aces_id = 5
  AND (execution.updated_at AT TIME ZONE 'America/Sao_Paulo')::date = DATE '2026-07-14'
ORDER BY execution.scheduled_at, lead.name;

ROLLBACK;
