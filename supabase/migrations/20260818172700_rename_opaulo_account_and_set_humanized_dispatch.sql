-- 1) Corrige o nome da conta
UPDATE crm.accounts
SET name = 'Óticas Paulo'
WHERE id = 10;

-- 2) Corrige as referências ao nome nos textos internos criados para a régua
UPDATE crm.pipelines
SET description = replace(description, 'Óticas Paula', 'Óticas Paulo')
WHERE aces_id = 10 AND name = 'Cobrança_Opaulo';

UPDATE crm.pipeline_stages
SET classifier_description = replace(classifier_description, 'Óticas Paula', 'Óticas Paulo')
WHERE aces_id = 10
  AND pipeline_id = (SELECT id FROM crm.pipelines WHERE aces_id = 10 AND name = 'Cobrança_Opaulo');

UPDATE crm.tags
SET usage_description = replace(usage_description, 'Óticas Paula', 'Óticas Paulo')
WHERE aces_id = 10 AND name = 'Negativação';

UPDATE crm.automation_funnels
SET name = replace(name, 'Óticas Paula', 'Óticas Paulo')
WHERE aces_id = 10 AND instance_name = 'cobranca_opaulo';

-- 3) Ativa disparo humanizado das 09h às 10h em todos os funis da régua
UPDATE crm.automation_funnels
SET humanized_dispatch_enabled = true,
    humanized_dispatch_window_start = '09:00:00',
    humanized_dispatch_window_end = '10:00:00'
WHERE aces_id = 10 AND instance_name = 'cobranca_opaulo';;
