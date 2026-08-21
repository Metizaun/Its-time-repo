WITH new_pipeline AS (
  INSERT INTO crm.pipelines (aces_id, name, description, is_active)
  VALUES (10, 'Cobrança_Opaulo', 'Pipeline dedicado às etapas de cobrança e automações RB da Óticas Paula.', true)
  RETURNING id
),
stage_atendimento AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_semantic_key, classifier_is_destination)
  SELECT 10, np.id, 'Atendimento', 0, 'Aberto', '#0ea5e9', 'active_service', false
  FROM new_pipeline np
  RETURNING id
),
stage_vencimento AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 10, np.id, 'Vencimento (aviso)', 1, 'Aberto', '#22c55e', 'Leads com parcela vencendo hoje na Óticas Paula, ainda dentro da janela de aviso amigável.'
  FROM new_pipeline np
  RETURNING id
),
stage_5d AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 10, np.id, 'Atraso (5 dias)', 2, 'Aberto', '#f59e0b', 'Leads com atraso de 5 dias no pagamento — primeira cobrança enviada.'
  FROM new_pipeline np
  RETURNING id
),
stage_10d AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 10, np.id, 'Atraso (10 dias)', 3, 'Aberto', '#f97316', 'Leads com atraso de 10 dias no pagamento — segunda cobrança enviada.'
  FROM new_pipeline np
  RETURNING id
),
stage_15d AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 10, np.id, 'Atraso (15 dias)', 4, 'Aberto', '#ef4444', 'Leads com atraso de 15 dias no pagamento — terceira e última cobrança automática enviada.'
  FROM new_pipeline np
  RETURNING id
),
stage_negativacao AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 10, np.id, 'Negativação (30 dias)', 5, 'Perdido', '#7c3aed', 'Leads com 30 dias ou mais de atraso, encaminhados para o processo manual de negativação (Serasa/SPC). Tratamento manual pela equipe de cobrança.'
  FROM new_pipeline np
  RETURNING id
),
stage_finalizado AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 10, np.id, 'Finalizado', 6, 'Ganho', '#64748b', 'Leads com cobrança resolvida ou pagamento regularizado.'
  FROM new_pipeline np
  RETURNING id
),
new_instance AS (
  INSERT INTO crm.instance (instancia, aces_id, color, status, setup_status)
  VALUES ('cobranca_opaulo', 10, '#dc2626', 'disconnected', 'pending_qr')
  RETURNING instancia
),
new_tag AS (
  INSERT INTO crm.tags (aces_id, name, usage_description)
  VALUES (10, 'Negativação', 'Aplicar manualmente em leads encaminhados ao processo de negativação (30+ dias de atraso) na régua de cobrança da Óticas Paula.')
  RETURNING id
),
funnel_vencimento AS (
  INSERT INTO crm.automation_funnels (aces_id, name, trigger_stage_id, instance_name, anchor_event, entry_source, entry_rule, reentry_mode, is_active)
  SELECT 10, 'RB Óticas Paula - Aviso de vencimento', sv.id, ni.instancia, 'stage_entered_at', 'rb',
    jsonb_build_object(
      'id', gen_random_uuid(), 'type','group', 'operator','all',
      'children', jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','stage_is','value', sv.id::text),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','instance_is','value', ni.instancia),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','lead_visible_is_true','value', true)
      )
    ), 'restart_on_match', true
  FROM stage_vencimento sv, new_instance ni
  RETURNING id
),
step_vencimento AS (
  INSERT INTO crm.automation_steps (funnel_id, position, label, delay_minutes, channel, content_mode, message_template, rb_message_kind, rb_days_offset)
  SELECT id, 0, 'Aviso de vencimento', 0, 'whatsapp', 'text',
    'Oi {nome}, tudo bem? Passando para lembrar que o vencimento da sua parcela na Óticas Paula é hoje ({vencimento}). Se preferir, você pode usar o Pix {pix} e nos enviar o comprovante.',
    'reminder', 0
  FROM funnel_vencimento
  RETURNING id
),
funnel_5d AS (
  INSERT INTO crm.automation_funnels (aces_id, name, trigger_stage_id, instance_name, anchor_event, entry_source, entry_rule, reentry_mode, is_active)
  SELECT 10, 'RB Óticas Paula - 1ª cobrança (5 dias)', s5.id, ni.instancia, 'stage_entered_at', 'rb',
    jsonb_build_object(
      'id', gen_random_uuid(), 'type','group', 'operator','all',
      'children', jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','stage_is','value', s5.id::text),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','instance_is','value', ni.instancia),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','lead_visible_is_true','value', true)
      )
    ), 'restart_on_match', true
  FROM stage_5d s5, new_instance ni
  RETURNING id
),
step_5d AS (
  INSERT INTO crm.automation_steps (funnel_id, position, label, delay_minutes, channel, content_mode, message_template, rb_message_kind, rb_days_offset)
  SELECT id, 0, '1ª cobrança (5 dias)', 0, 'whatsapp', 'text',
    'Oi {nome}, tudo bem? Identificamos que a parcela da Óticas Paula venceu em {vencimento} e ainda não recebemos o pagamento. O Pix {pix} continua disponível para regularizar.',
    'charge', 5
  FROM funnel_5d
  RETURNING id
),
funnel_10d AS (
  INSERT INTO crm.automation_funnels (aces_id, name, trigger_stage_id, instance_name, anchor_event, entry_source, entry_rule, reentry_mode, is_active)
  SELECT 10, 'RB Óticas Paula - 2ª cobrança (10 dias)', s10.id, ni.instancia, 'stage_entered_at', 'rb',
    jsonb_build_object(
      'id', gen_random_uuid(), 'type','group', 'operator','all',
      'children', jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','stage_is','value', s10.id::text),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','instance_is','value', ni.instancia),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','lead_visible_is_true','value', true)
      )
    ), 'restart_on_match', true
  FROM stage_10d s10, new_instance ni
  RETURNING id
),
step_10d AS (
  INSERT INTO crm.automation_steps (funnel_id, position, label, delay_minutes, channel, content_mode, message_template, rb_message_kind, rb_days_offset)
  SELECT id, 0, '2ª cobrança (10 dias)', 0, 'whatsapp', 'text',
    'Oi {nome}, retomando o contato sobre o título em aberto na Óticas Paula, vencido em {vencimento}. O valor atualizado é {valor}. Podemos te ajudar a regularizar?',
    'charge', 10
  FROM funnel_10d
  RETURNING id
),
funnel_15d AS (
  INSERT INTO crm.automation_funnels (aces_id, name, trigger_stage_id, instance_name, anchor_event, entry_source, entry_rule, reentry_mode, is_active)
  SELECT 10, 'RB Óticas Paula - 3ª cobrança (15 dias)', s15.id, ni.instancia, 'stage_entered_at', 'rb',
    jsonb_build_object(
      'id', gen_random_uuid(), 'type','group', 'operator','all',
      'children', jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','stage_is','value', s15.id::text),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','instance_is','value', ni.instancia),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','lead_visible_is_true','value', true)
      )
    ), 'restart_on_match', true
  FROM stage_15d s15, new_instance ni
  RETURNING id
),
step_15d AS (
  INSERT INTO crm.automation_steps (funnel_id, position, label, delay_minutes, channel, content_mode, message_template, rb_message_kind, rb_days_offset)
  SELECT id, 0, '3ª cobrança (15 dias)', 0, 'whatsapp', 'text',
    'Oi {nome}, este é nosso último contato antes de seguirmos com os próximos passos de cobrança. O débito na Óticas Paula, vencido em {vencimento}, segue em aberto no valor de {valor}. Entre em contato para evitar a negativação do seu nome.',
    'charge', 15
  FROM funnel_15d
  RETURNING id
)
SELECT
  (SELECT id FROM new_pipeline) AS pipeline_id,
  (SELECT id FROM stage_atendimento) AS stage_atendimento_id,
  (SELECT id FROM stage_vencimento) AS stage_vencimento_id,
  (SELECT id FROM stage_5d) AS stage_5d_id,
  (SELECT id FROM stage_10d) AS stage_10d_id,
  (SELECT id FROM stage_15d) AS stage_15d_id,
  (SELECT id FROM stage_negativacao) AS stage_negativacao_id,
  (SELECT id FROM stage_finalizado) AS stage_finalizado_id,
  (SELECT instancia FROM new_instance) AS instance_name,
  (SELECT id FROM new_tag) AS tag_id,
  (SELECT id FROM funnel_vencimento) AS funnel_vencimento_id,
  (SELECT id FROM funnel_5d) AS funnel_5d_id,
  (SELECT id FROM funnel_10d) AS funnel_10d_id,
  (SELECT id FROM funnel_15d) AS funnel_15d_id,
  (SELECT id FROM step_vencimento) AS step_vencimento_id,
  (SELECT id FROM step_5d) AS step_5d_id,
  (SELECT id FROM step_10d) AS step_10d_id,
  (SELECT id FROM step_15d) AS step_15d_id;;
