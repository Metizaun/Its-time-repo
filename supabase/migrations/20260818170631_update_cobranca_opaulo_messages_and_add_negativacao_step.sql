-- 1) Atualiza os 4 textos de mensagem existentes com o novo conteúdo/estilo
UPDATE crm.automation_steps s
SET message_template = 'Olá, {nome}! Tudo bem? 😊
Passando para lembrar que hoje vence sua parcela da Óticas Paulo, no valor de R$ {valor}.
Se o pagamento já foi realizado, pode desconsiderar esta mensagem. Caso precise de ajuda com o pagamento, me avise por aqui.'
FROM crm.automation_funnels f
WHERE s.funnel_id = f.id
  AND f.aces_id = 10
  AND f.instance_name = 'cobranca_opaulo'
  AND s.rb_message_kind = 'reminder'
  AND s.rb_days_offset = 0;

UPDATE crm.automation_steps s
SET message_template = 'Olá, {nome}! Tudo bem?
Identificamos que a parcela de R$ {valor}, com vencimento em {data}, ainda consta em aberto.
Às vezes pode ser apenas um esquecimento. Posso te ajudar com as informações para regularizar o pagamento?'
FROM crm.automation_funnels f
WHERE s.funnel_id = f.id
  AND f.aces_id = 10
  AND f.instance_name = 'cobranca_opaulo'
  AND s.rb_message_kind = 'charge'
  AND s.rb_days_offset = 5;

UPDATE crm.automation_steps s
SET message_template = 'Olá, {nome}.
Sua parcela de R$ {valor}, vencida em {data}, continua pendente em nosso sistema.
Queremos te ajudar a regularizar isso da forma mais simples possível. Se precisar das informações para pagamento, posso encaminhar por aqui.'
FROM crm.automation_funnels f
WHERE s.funnel_id = f.id
  AND f.aces_id = 10
  AND f.instance_name = 'cobranca_opaulo'
  AND s.rb_message_kind = 'charge'
  AND s.rb_days_offset = 10;

UPDATE crm.automation_steps s
SET message_template = 'Olá, {nome}.
Ainda identificamos em aberto a parcela de R$ {valor}, vencida em {data}.
Pedimos, por gentileza, que regularize a pendência ou entre em contato conosco para verificarmos a situação.
Se o pagamento já foi feito, pode nos informar para que possamos conferir?'
FROM crm.automation_funnels f
WHERE s.funnel_id = f.id
  AND f.aces_id = 10
  AND f.instance_name = 'cobranca_opaulo'
  AND s.rb_message_kind = 'charge'
  AND s.rb_days_offset = 15;

-- 2) Atualiza a descrição do estágio de negativação para refletir que agora há aviso automático
UPDATE crm.pipeline_stages
SET classifier_description = 'Leads com 30 dias ou mais de atraso — recebem aviso automático de negativação e são encaminhados para tratamento manual da equipe (Serasa/SPC).'
WHERE aces_id = 10
  AND name = 'Negativação (30 dias)'
  AND pipeline_id = (SELECT id FROM crm.pipelines WHERE aces_id = 10 AND name = 'Cobrança_Opaulo');

-- 3) Cria o funil + passo de aviso automático para o dia 30 (negativação)
WITH stage_neg AS (
  SELECT id FROM crm.pipeline_stages
  WHERE aces_id = 10
    AND name = 'Negativação (30 dias)'
    AND pipeline_id = (SELECT id FROM crm.pipelines WHERE aces_id = 10 AND name = 'Cobrança_Opaulo')
),
funnel_30d AS (
  INSERT INTO crm.automation_funnels (aces_id, name, trigger_stage_id, instance_name, anchor_event, entry_source, entry_rule, reentry_mode, is_active)
  SELECT 10, 'RB Óticas Paula - Aviso de negativação (30 dias)', sn.id, 'cobranca_opaulo', 'stage_entered_at', 'rb',
    jsonb_build_object(
      'id', gen_random_uuid(), 'type','group', 'operator','all',
      'children', jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','stage_is','value', sn.id::text),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','instance_is','value','cobranca_opaulo'),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','lead_visible_is_true','value', true)
      )
    ), 'restart_on_match', true
  FROM stage_neg sn
  RETURNING id
)
INSERT INTO crm.automation_steps (funnel_id, position, label, delay_minutes, channel, content_mode, message_template, rb_message_kind, rb_days_offset)
SELECT id, 0, 'Aviso de negativação (30 dias)', 0, 'whatsapp', 'text',
  'Olá, {nome}.
A parcela de R$ {valor}, vencida em {data}, permanece em aberto após nossos contatos anteriores.
Com 30 dias de atraso, o débito entra no processo de negativação previsto pela empresa.
Caso o pagamento já tenha sido realizado, nos informe para conferência. Se ainda estiver pendente, entre em contato conosco para verificar a regularização antes do prosseguimento do processo.',
  'charge', 30
FROM funnel_30d
RETURNING id;;
