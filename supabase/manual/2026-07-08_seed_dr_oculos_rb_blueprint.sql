DO $$
DECLARE
  v_user_id uuid;
  v_pipeline_id uuid;
  v_reply_stage_id uuid;
  v_stage_id uuid;
  v_funnel_id uuid;
  v_step_id uuid;
  v_due2 uuid;
  v_due_today uuid;
  v_overdue1 uuid;
  v_overdue4 uuid;
  v_overdue10 uuid;
  v_overdue15 uuid;
  v_attendance uuid;
  v_completed uuid;
BEGIN
  SELECT u.id
  INTO v_user_id
  FROM crm.users u
  WHERE u.aces_id = 5
    AND u.role = 'ADMIN'
  ORDER BY u.created_at
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel localizar o usuario ADMIN do aces_id 5';
  END IF;

  SELECT p.id
  INTO v_pipeline_id
  FROM crm.pipelines p
  WHERE p.aces_id = 5
    AND p.is_default IS TRUE
  ORDER BY p.created_at
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline padrao nao encontrado para o aces_id 5';
  END IF;

  SELECT s.id
  INTO v_reply_stage_id
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = 'atendimento'
  ORDER BY s.position
  LIMIT 1;

  IF v_reply_stage_id IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Atendimento',
      '#14b8a6',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads em conversa ativa com o time.',
      '["cliente aguardando atendimento","conversa em andamento","resposta humana ativa"]'::jsonb,
      '["titulo encerrado","cobranca concluida","fluxo de aviso automatizado"]'::jsonb,
      '["Leads que precisam de atendimento humano.","Fila operacional de contato ativo."]'::jsonb
    )
    RETURNING id INTO v_reply_stage_id;
  END IF;

  SELECT s.id
  INTO v_due2
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('A vencer (2 dias)')
  ORDER BY s.position
  LIMIT 1;

  IF v_due2 IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'A vencer (2 dias)',
      '#0ea5e9',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads com parcela vencendo em 2 dias e ainda dentro da janela de lembrete.',
      '["parcela vence em 2 dias","lembrete antes do vencimento","cliente ainda sem atraso"]'::jsonb,
      '["titulo ja venceu","cliente em atendimento humano","fluxo de encerramento"]'::jsonb,
      '["Cobrança preventiva antes do vencimento.","Lembrete de pagamento agendado para dois dias antes."]'::jsonb
    )
    RETURNING id INTO v_due2;
  END IF;

  SELECT s.id
  INTO v_due_today
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('Vence hoje')
  ORDER BY s.position
  LIMIT 1;

  IF v_due_today IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Vence hoje',
      '#22c55e',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads com titulo vencendo no dia corrente.',
      '["vencimento hoje","pagamento imediato","alerta de vencimento do dia"]'::jsonb,
      '["titulo atrasado","cliente ja respondeu","etapa de finalizacao"]'::jsonb,
      '["Aviso de vencimento para o mesmo dia.","Mensagem curta com Pix disponivel agora."]'::jsonb
    )
    RETURNING id INTO v_due_today;
  END IF;

  SELECT s.id
  INTO v_overdue1
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('Atrasado (1 dia)')
  ORDER BY s.position
  LIMIT 1;

  IF v_overdue1 IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Atrasado (1 dia)',
      '#f59e0b',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads com atraso recente de um dia.',
      '["um dia em atraso","cobranca recente","titulo vencido ontem"]'::jsonb,
      '["atraso longo","acordo finalizado","cliente sem saldo pendente"]'::jsonb,
      '["Primeiro toque apos um dia de atraso.","Mensagem leve para regularizacao rapida."]'::jsonb
    )
    RETURNING id INTO v_overdue1;
  END IF;

  SELECT s.id
  INTO v_overdue4
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('Cobranca suave (4 dias)')
  ORDER BY s.position
  LIMIT 1;

  IF v_overdue4 IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Cobranca suave (4 dias)',
      '#f97316',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads com atraso intermediario que ainda podem responder a uma cobranca mais suave.',
      '["quatro dias em atraso","cobranca suave","reativacao de contato"]'::jsonb,
      '["atendimento ativo","resolucao concluida","bloqueio de contato"]'::jsonb,
      '["Retomada com tom cordial.","Mensagem com foco em manter a conversa aberta."]'::jsonb
    )
    RETURNING id INTO v_overdue4;
  END IF;

  SELECT s.id
  INTO v_overdue10
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('Atrasado (10 dias)')
  ORDER BY s.position
  LIMIT 1;

  IF v_overdue10 IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Atrasado (10 dias)',
      '#ef4444',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads com atraso relevante de 10 dias.',
      '["dez dias em atraso","titulo em cobranca","alerta de inadimplencia"]'::jsonb,
      '["acordo ja ativo","mensagem de conclusao","cliente respondendo em atendimento"]'::jsonb,
      '["Cobranca mais firme com referencia ao vencimento.","Mensagem com foco em resolver pendencia longa."]'::jsonb
    )
    RETURNING id INTO v_overdue10;
  END IF;

  SELECT s.id
  INTO v_overdue15
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('Cobranca critica (15 dias)')
  ORDER BY s.position
  LIMIT 1;

  IF v_overdue15 IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Cobranca critica (15 dias)',
      '#7c3aed',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Aberto',
      false,
      'Leads com atraso alto que exigem cobranca critica e acompanhamento forte.',
      '["quinze dias em atraso","cobranca critica","necessidade de negociacao"]'::jsonb,
      '["finalizado","sem pendencia","atendimento concluido"]'::jsonb,
      '["Mensagem de recuperacao com maior urgencia.","Cobranca critica com linguagem objetiva."]'::jsonb
    )
    RETURNING id INTO v_overdue15;
  END IF;

  SELECT s.id
  INTO v_completed
  FROM crm.pipeline_stages s
  WHERE s.aces_id = 5
    AND s.pipeline_id = v_pipeline_id
    AND lower(s.name) = lower('Finalizado')
  ORDER BY s.position
  LIMIT 1;

  IF v_completed IS NULL THEN
    INSERT INTO crm.pipeline_stages (
      aces_id,
      pipeline_id,
      name,
      color,
      position,
      category,
      is_funnel_stage,
      classifier_description,
      classifier_positive_signals,
      classifier_negative_signals,
      classifier_examples
    )
    VALUES (
      5,
      v_pipeline_id,
      'Finalizado',
      '#64748b',
      COALESCE((SELECT max(position) + 1 FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id), 0),
      'Ganho',
      false,
      'Leads encerrados com sucesso ou cobranca resolvida.',
      '["pagamento concluido","acordo finalizado","cobranca encerrada"]'::jsonb,
      '["pendencia aberta","retorno pendente","cobranca em andamento"]'::jsonb,
      '["Pagamento confirmado.","Fluxo encerrado com sucesso."]'::jsonb
    )
    RETURNING id INTO v_completed;
  END IF;

  SELECT f.id
  INTO v_funnel_id
  FROM crm.automation_funnels f
  WHERE f.aces_id = 5
    AND f.name = 'RB Dr Oculos - A vencer (2 dias)'
  ORDER BY f.created_at DESC
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    INSERT INTO crm.automation_funnels (
      aces_id,
      name,
      trigger_stage_id,
      instance_name,
      is_active,
      created_by,
      created_at,
      updated_at,
      entry_rule,
      exit_rule,
      anchor_event,
      reentry_mode,
      reply_target_stage_id,
      builder_version,
      humanized_dispatch_enabled,
      dispatch_limit_per_hour,
      humanized_dispatch_window_start,
      humanized_dispatch_window_end,
      entry_source
    )
    VALUES (
      5,
      'RB Dr Oculos - A vencer (2 dias)',
      v_due2,
      'mamis',
      true,
      v_user_id,
      now(),
      now(),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'all',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'stage_is', 'value', v_due2),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'instance_is', 'value', 'mamis'),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_visible_is_true', 'value', true)
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'any',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_replied', 'value', true)
        )
      ),
      'stage_entered_at',
      'restart_on_match',
      v_reply_stage_id,
      2,
      false,
      40,
      '08:00:00',
      '19:00:00',
      'rb'
    )
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO crm.automation_steps (
    funnel_id,
    position,
    label,
    delay_minutes,
    message_template,
    channel,
    is_active,
    created_by,
    created_at,
    updated_at,
    step_rule,
    content_mode,
    media_asset_id,
    media_kind,
    media_caption,
    gupshup_template_id,
    gupshup_template_name,
    gupshup_template_language,
    gupshup_template_params,
    rb_message_kind,
    rb_days_offset,
    rb_payment_type_ids
  )
  SELECT
    v_funnel_id,
    0,
    'A vencer (2 dias)',
    0,
    'Oi {nome}, tudo bem? Seguimos acompanhando a parcela que vence em {vencimento} e deixamos tudo pronto para sua regularizacao.',
    'whatsapp',
    true,
    v_user_id,
    now(),
    now(),
    NULL,
    'text',
    NULL,
    NULL,
    NULL,
    'd2687393-bd72-4d1d-a652-d3e41d1830ed',
    'Dr Oculos | A vencer 2 dias',
    'pt_BR',
    '["nome","vencimento"]'::jsonb,
    'reminder',
    2,
    '["6"]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s WHERE s.funnel_id = v_funnel_id AND s.position = 0
  );

  SELECT f.id
  INTO v_funnel_id
  FROM crm.automation_funnels f
  WHERE f.aces_id = 5
    AND f.name = 'RB Dr Oculos - Vence hoje'
  ORDER BY f.created_at DESC
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    INSERT INTO crm.automation_funnels (
      aces_id,
      name,
      trigger_stage_id,
      instance_name,
      is_active,
      created_by,
      created_at,
      updated_at,
      entry_rule,
      exit_rule,
      anchor_event,
      reentry_mode,
      reply_target_stage_id,
      builder_version,
      humanized_dispatch_enabled,
      dispatch_limit_per_hour,
      humanized_dispatch_window_start,
      humanized_dispatch_window_end,
      entry_source
    )
    VALUES (
      5,
      'RB Dr Oculos - Vence hoje',
      v_due_today,
      'mamis',
      true,
      v_user_id,
      now(),
      now(),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'all',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'stage_is', 'value', v_due_today),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'instance_is', 'value', 'mamis'),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_visible_is_true', 'value', true)
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'any',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_replied', 'value', true)
        )
      ),
      'stage_entered_at',
      'restart_on_match',
      v_reply_stage_id,
      2,
      false,
      40,
      '08:00:00',
      '19:00:00',
      'rb'
    )
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO crm.automation_steps (
    funnel_id,
    position,
    label,
    delay_minutes,
    message_template,
    channel,
    is_active,
    created_by,
    created_at,
    updated_at,
    step_rule,
    content_mode,
    media_asset_id,
    media_kind,
    media_caption,
    gupshup_template_id,
    gupshup_template_name,
    gupshup_template_language,
    gupshup_template_params,
    rb_message_kind,
    rb_days_offset,
    rb_payment_type_ids
  )
  SELECT
    v_funnel_id,
    0,
    'Vence hoje',
    0,
    'Oi {nome}, passando para lembrar que o vencimento e hoje. Se preferir, voce pode usar o Pix {pix} e nos enviar o comprovante.',
    'whatsapp',
    true,
    v_user_id,
    now(),
    now(),
    NULL,
    'text',
    NULL,
    NULL,
    NULL,
    '5bb297eb-c1f4-4e03-8e62-7f7ed5821782',
    'Dr Oculos | Vence hoje',
    'pt_BR',
    '["nome","pix"]'::jsonb,
    'reminder',
    0,
    '["6"]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s WHERE s.funnel_id = v_funnel_id AND s.position = 0
  );

  SELECT f.id
  INTO v_funnel_id
  FROM crm.automation_funnels f
  WHERE f.aces_id = 5
    AND f.name = 'RB Dr Oculos - Atrasado 1 dia'
  ORDER BY f.created_at DESC
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    INSERT INTO crm.automation_funnels (
      aces_id,
      name,
      trigger_stage_id,
      instance_name,
      is_active,
      created_by,
      created_at,
      updated_at,
      entry_rule,
      exit_rule,
      anchor_event,
      reentry_mode,
      reply_target_stage_id,
      builder_version,
      humanized_dispatch_enabled,
      dispatch_limit_per_hour,
      humanized_dispatch_window_start,
      humanized_dispatch_window_end,
      entry_source
    )
    VALUES (
      5,
      'RB Dr Oculos - Atrasado 1 dia',
      v_overdue1,
      'mamis',
      true,
      v_user_id,
      now(),
      now(),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'all',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'stage_is', 'value', v_overdue1),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'instance_is', 'value', 'mamis'),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_visible_is_true', 'value', true)
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'any',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_replied', 'value', true)
        )
      ),
      'stage_entered_at',
      'restart_on_match',
      v_reply_stage_id,
      2,
      false,
      40,
      '08:00:00',
      '19:00:00',
      'rb'
    )
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO crm.automation_steps (
    funnel_id,
    position,
    label,
    delay_minutes,
    message_template,
    channel,
    is_active,
    created_by,
    created_at,
    updated_at,
    step_rule,
    content_mode,
    media_asset_id,
    media_kind,
    media_caption,
    gupshup_template_id,
    gupshup_template_name,
    gupshup_template_language,
    gupshup_template_params,
    rb_message_kind,
    rb_days_offset,
    rb_payment_type_ids
  )
  SELECT
    v_funnel_id,
    0,
    'Atrasado (1 dia)',
    0,
    'Oi {nome}, tudo bem? A parcela venceu em {vencimento}. Se quiser resolver agora, o Pix {pix} continua disponivel para facilitar.',
    'whatsapp',
    true,
    v_user_id,
    now(),
    now(),
    NULL,
    'text',
    NULL,
    NULL,
    NULL,
    '279e2b9e-523c-4e98-a2f0-059f71cc22a4',
    'Dr Oculos | Atrasado 1 dia',
    'pt_BR',
    '["nome","vencimento","pix"]'::jsonb,
    'charge',
    1,
    '["6"]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s WHERE s.funnel_id = v_funnel_id AND s.position = 0
  );

  SELECT f.id
  INTO v_funnel_id
  FROM crm.automation_funnels f
  WHERE f.aces_id = 5
    AND f.name = 'RB Dr Oculos - Cobranca suave 4 dias'
  ORDER BY f.created_at DESC
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    INSERT INTO crm.automation_funnels (
      aces_id,
      name,
      trigger_stage_id,
      instance_name,
      is_active,
      created_by,
      created_at,
      updated_at,
      entry_rule,
      exit_rule,
      anchor_event,
      reentry_mode,
      reply_target_stage_id,
      builder_version,
      humanized_dispatch_enabled,
      dispatch_limit_per_hour,
      humanized_dispatch_window_start,
      humanized_dispatch_window_end,
      entry_source
    )
    VALUES (
      5,
      'RB Dr Oculos - Cobranca suave 4 dias',
      v_overdue4,
      'mamis',
      true,
      v_user_id,
      now(),
      now(),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'all',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'stage_is', 'value', v_overdue4),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'instance_is', 'value', 'mamis'),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_visible_is_true', 'value', true)
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'any',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_replied', 'value', true)
        )
      ),
      'stage_entered_at',
      'restart_on_match',
      v_reply_stage_id,
      2,
      false,
      40,
      '08:00:00',
      '19:00:00',
      'rb'
    )
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO crm.automation_steps (
    funnel_id,
    position,
    label,
    delay_minutes,
    message_template,
    channel,
    is_active,
    created_by,
    created_at,
    updated_at,
    step_rule,
    content_mode,
    media_asset_id,
    media_kind,
    media_caption,
    gupshup_template_id,
    gupshup_template_name,
    gupshup_template_language,
    gupshup_template_params,
    rb_message_kind,
    rb_days_offset,
    rb_payment_type_ids
  )
  SELECT
    v_funnel_id,
    0,
    'Cobranca suave (4 dias)',
    0,
    'Oi {nome}, seguimos por aqui para te ajudar a regularizar a pendencia com tranquilidade. Se precisar de uma nova orientacao, estamos disponiveis.',
    'whatsapp',
    true,
    v_user_id,
    now(),
    now(),
    NULL,
    'text',
    NULL,
    NULL,
    NULL,
    'c77f81d7-660b-488c-ba66-8312d1a69784',
    'Dr Oculos | Cobranca suave 4 dias',
    'pt_BR',
    '["nome"]'::jsonb,
    'charge',
    4,
    '["6"]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s WHERE s.funnel_id = v_funnel_id AND s.position = 0
  );

  SELECT f.id
  INTO v_funnel_id
  FROM crm.automation_funnels f
  WHERE f.aces_id = 5
    AND f.name = 'RB Dr Oculos - Atrasado 10 dias'
  ORDER BY f.created_at DESC
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    INSERT INTO crm.automation_funnels (
      aces_id,
      name,
      trigger_stage_id,
      instance_name,
      is_active,
      created_by,
      created_at,
      updated_at,
      entry_rule,
      exit_rule,
      anchor_event,
      reentry_mode,
      reply_target_stage_id,
      builder_version,
      humanized_dispatch_enabled,
      dispatch_limit_per_hour,
      humanized_dispatch_window_start,
      humanized_dispatch_window_end,
      entry_source
    )
    VALUES (
      5,
      'RB Dr Oculos - Atrasado 10 dias',
      v_overdue10,
      'mamis',
      true,
      v_user_id,
      now(),
      now(),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'all',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'stage_is', 'value', v_overdue10),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'instance_is', 'value', 'mamis'),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_visible_is_true', 'value', true)
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'any',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_replied', 'value', true)
        )
      ),
      'stage_entered_at',
      'restart_on_match',
      v_reply_stage_id,
      2,
      false,
      40,
      '08:00:00',
      '19:00:00',
      'rb'
    )
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO crm.automation_steps (
    funnel_id,
    position,
    label,
    delay_minutes,
    message_template,
    channel,
    is_active,
    created_by,
    created_at,
    updated_at,
    step_rule,
    content_mode,
    media_asset_id,
    media_kind,
    media_caption,
    gupshup_template_id,
    gupshup_template_name,
    gupshup_template_language,
    gupshup_template_params,
    rb_message_kind,
    rb_days_offset,
    rb_payment_type_ids
  )
  SELECT
    v_funnel_id,
    0,
    'Atrasado (10 dias)',
    0,
    'Oi {nome}, retomando o contato sobre o titulo vencido em {DtVencimento}. O valor liquido segue em {Vl_liquido} para conferencia.',
    'whatsapp',
    true,
    v_user_id,
    now(),
    now(),
    NULL,
    'text',
    NULL,
    NULL,
    NULL,
    '2e7440ac-6133-4a7c-9bb0-5be887839435',
    'Dr Oculos | Atrasado 10 dias',
    'pt_BR',
    '["nome","DtVencimento","Vl_liquido"]'::jsonb,
    'charge',
    10,
    '["6"]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s WHERE s.funnel_id = v_funnel_id AND s.position = 0
  );

  SELECT f.id
  INTO v_funnel_id
  FROM crm.automation_funnels f
  WHERE f.aces_id = 5
    AND f.name = 'RB Dr Oculos - Cobranca critica 15 dias'
  ORDER BY f.created_at DESC
  LIMIT 1;

  IF v_funnel_id IS NULL THEN
    INSERT INTO crm.automation_funnels (
      aces_id,
      name,
      trigger_stage_id,
      instance_name,
      is_active,
      created_by,
      created_at,
      updated_at,
      entry_rule,
      exit_rule,
      anchor_event,
      reentry_mode,
      reply_target_stage_id,
      builder_version,
      humanized_dispatch_enabled,
      dispatch_limit_per_hour,
      humanized_dispatch_window_start,
      humanized_dispatch_window_end,
      entry_source
    )
    VALUES (
      5,
      'RB Dr Oculos - Cobranca critica 15 dias',
      v_overdue15,
      'mamis',
      true,
      v_user_id,
      now(),
      now(),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'all',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'stage_is', 'value', v_overdue15),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'instance_is', 'value', 'mamis'),
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_visible_is_true', 'value', true)
        )
      ),
      jsonb_build_object(
        'id', gen_random_uuid(),
        'type', 'group',
        'operator', 'any',
        'children', jsonb_build_array(
          jsonb_build_object('id', gen_random_uuid(), 'type', 'predicate', 'predicate', 'lead_replied', 'value', true)
        )
      ),
      'stage_entered_at',
      'restart_on_match',
      v_reply_stage_id,
      2,
      false,
      40,
      '08:00:00',
      '19:00:00',
      'rb'
    )
    RETURNING id INTO v_funnel_id;
  END IF;

  INSERT INTO crm.automation_steps (
    funnel_id,
    position,
    label,
    delay_minutes,
    message_template,
    channel,
    is_active,
    created_by,
    created_at,
    updated_at,
    step_rule,
    content_mode,
    media_asset_id,
    media_kind,
    media_caption,
    gupshup_template_id,
    gupshup_template_name,
    gupshup_template_language,
    gupshup_template_params,
    rb_message_kind,
    rb_days_offset,
    rb_payment_type_ids
  )
  SELECT
    v_funnel_id,
    0,
    'Cobranca critica (15 dias)',
    0,
    'Oi {nome}, seguimos com a cobranca em aberto e queremos ajudar a concluir a regularizacao. O valor liquido atualizado e {valor_liquido}.',
    'whatsapp',
    true,
    v_user_id,
    now(),
    now(),
    NULL,
    'text',
    NULL,
    NULL,
    NULL,
    '2f37cb6d-ae16-4861-80c6-156b7624e9f5',
    'Dr Oculos | Cobranca critica 15 dias',
    'pt_BR',
    '["nome","vencimento","valor_liquido"]'::jsonb,
    'charge',
    15,
    '["6"]'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.automation_steps s WHERE s.funnel_id = v_funnel_id AND s.position = 0
  );
END;
$$;
