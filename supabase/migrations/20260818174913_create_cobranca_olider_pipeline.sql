WITH new_pipeline AS (
  INSERT INTO crm.pipelines (aces_id, name, description, is_active)
  VALUES (9, 'Cobrança_OLider', 'Pipeline dedicado à etapa de cobrança e automação RB da Ótica Líder.', true)
  RETURNING id
),
stage_atendimento AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_semantic_key, classifier_is_destination)
  SELECT 9, np.id, 'Atendimento', 0, 'Aberto', '#0ea5e9', 'active_service', false
  FROM new_pipeline np
  RETURNING id
),
stage_5d AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 9, np.id, 'Atraso (5 dias)', 1, 'Aberto', '#f59e0b', 'Leads com atraso de 5 dias no pagamento — cobrança automática enviada.'
  FROM new_pipeline np
  RETURNING id
),
stage_finalizado AS (
  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, position, category, color, classifier_description)
  SELECT 9, np.id, 'Finalizado', 2, 'Ganho', '#64748b', 'Leads com cobrança resolvida ou pagamento regularizado.'
  FROM new_pipeline np
  RETURNING id
),
funnel_5d AS (
  INSERT INTO crm.automation_funnels (aces_id, name, trigger_stage_id, instance_name, anchor_event, entry_source, entry_rule, reentry_mode, is_active, humanized_dispatch_enabled, humanized_dispatch_window_start, humanized_dispatch_window_end, reply_target_stage_id)
  SELECT 9, 'RB Ótica Líder - Cobrança (5 dias)', s5.id, 'Oticas_Lider', 'stage_entered_at', 'rb',
    jsonb_build_object(
      'id', gen_random_uuid(), 'type','group', 'operator','all',
      'children', jsonb_build_array(
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','stage_is','value', s5.id::text),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','instance_is','value','Oticas_Lider'),
        jsonb_build_object('id',gen_random_uuid(),'type','predicate','predicate','lead_visible_is_true','value', true)
      )
    ), 'restart_on_match', true, true, '09:00:00', '10:00:00', sa.id
  FROM stage_5d s5, stage_atendimento sa
  RETURNING id
)
INSERT INTO crm.automation_steps (funnel_id, position, label, delay_minutes, channel, content_mode, message_template, rb_message_kind, rb_days_offset)
SELECT id, 0, 'Cobrança (5 dias)', 0, 'whatsapp', 'text',
  'Oi, {nome}! Tudo bem? 😊
Identificamos que o pagamento de R$ {valor}, com vencimento em {data}, ainda consta em aberto para nós.
Pode ter sido apenas um imprevisto ou passado despercebido. Se precisar, posso te enviar os dados para regularização por aqui.',
  'charge', 5
FROM funnel_5d
RETURNING id;;
