-- Alinha os templates da cobranca Opaulo ao kit de variaveis resolvido pelo worker.
-- {valor} e {data} nao fazem parte do contrato atual e causavam falha antes do envio.
UPDATE crm.automation_steps AS s
SET
  message_template = replace(
    replace(s.message_template, '{valor}', '{valor_liquido}'),
    '{data}',
    '{vencimento}'
  ),
  updated_at = now()
FROM crm.automation_funnels AS f
WHERE f.id = s.funnel_id
  AND f.aces_id = 10
  AND f.instance_name = 'cobranca_opaulo'
  AND (
    s.message_template LIKE '%{valor}%'
    OR s.message_template LIKE '%{data}%'
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM crm.automation_steps AS s
    JOIN crm.automation_funnels AS f ON f.id = s.funnel_id
    WHERE f.aces_id = 10
      AND f.instance_name = 'cobranca_opaulo'
      AND (
        s.message_template LIKE '%{valor}%'
        OR s.message_template LIKE '%{data}%'
      )
  ) THEN
    RAISE EXCEPTION 'Ainda existem placeholders incompativeis nos templates de cobranca_opaulo';
  END IF;
END $$;
