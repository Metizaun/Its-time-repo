DO $$
DECLARE
  v_user_id uuid;
  v_pipeline_id uuid;
  v_stage_novo uuid;
  v_stage_atendimento uuid;
  v_stage_orcamento uuid;
  v_stage_vence_hoje uuid;
  v_stage_atrasado uuid;
  v_empresa_1 uuid;
  v_empresa_2 uuid;
  v_lead_1 uuid := '11111111-1111-1111-1111-111111111101';
  v_lead_2 uuid := '11111111-1111-1111-1111-111111111102';
  v_lead_3 uuid := '11111111-1111-1111-1111-111111111103';
  v_lead_4 uuid := '11111111-1111-1111-1111-111111111104';
  v_lead_5 uuid := '11111111-1111-1111-1111-111111111105';
BEGIN
  -- 1. Obter referências
  SELECT id INTO v_user_id FROM crm.users WHERE aces_id = 5 LIMIT 1;
  SELECT id INTO v_empresa_1 FROM crm.empresas WHERE aces_id = 5 AND name LIKE '%Matriz%' LIMIT 1;
  SELECT id INTO v_empresa_2 FROM crm.empresas WHERE aces_id = 5 AND name LIKE '%Filial%' LIMIT 1;
  
  SELECT id INTO v_pipeline_id FROM crm.pipelines WHERE aces_id = 5 ORDER BY is_default DESC, created_at LIMIT 1;

  SELECT id INTO v_stage_novo FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id AND lower(name) LIKE '%novo%' LIMIT 1;
  SELECT id INTO v_stage_atendimento FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id AND lower(name) LIKE '%atendimento%' LIMIT 1;
  SELECT id INTO v_stage_orcamento FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id AND (lower(name) LIKE '%orçamento%' OR lower(name) LIKE '%vencer%') LIMIT 1;
  SELECT id INTO v_stage_vence_hoje FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id AND lower(name) LIKE '%vence hoje%' LIMIT 1;
  SELECT id INTO v_stage_atrasado FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id AND lower(name) LIKE '%atrasado%' LIMIT 1;

  -- Fallbacks se estágios específicos do pipeline padrão não existirem
  IF v_stage_novo IS NULL THEN SELECT id INTO v_stage_novo FROM crm.pipeline_stages WHERE pipeline_id = v_pipeline_id ORDER BY position LIMIT 1; END IF;
  IF v_stage_atendimento IS NULL THEN v_stage_atendimento := v_stage_novo; END IF;
  IF v_stage_orcamento IS NULL THEN v_stage_orcamento := v_stage_novo; END IF;
  IF v_stage_vence_hoje IS NULL THEN v_stage_vence_hoje := v_stage_novo; END IF;
  IF v_stage_atrasado IS NULL THEN v_stage_atrasado := v_stage_novo; END IF;

  -- 2. Inserir Leads de Demonstração
  INSERT INTO crm.leads (
    id, aces_id, owner_id, name, contact_phone, status, stage_id,
    instancia, empresa_id, view, created_at, updated_at
  )
  VALUES
    (
      v_lead_1, 5, v_user_id, 'Carlos Silva', '5562999887766', 'Novo', v_stage_novo,
      'mamis', v_empresa_1, true, now() - interval '2 days', now()
    ),
    (
      v_lead_2, 5, v_user_id, 'Mariana Costa', '5562988776655', 'Atendimento', v_stage_atendimento,
      'mamis', v_empresa_1, true, now() - interval '1 day', now()
    ),
    (
      v_lead_3, 5, v_user_id, 'Roberto Alves', '5562977665544', 'Orçamento', v_stage_orcamento,
      'mamis', v_empresa_2, true, now() - interval '5 hours', now()
    ),
    (
      v_lead_4, 5, v_user_id, 'Fernanda Lima', '5562966554433', 'Atendimento', v_stage_vence_hoje,
      'mamis', v_empresa_2, true, now() - interval '3 days', now()
    ),
    (
      v_lead_5, 5, v_user_id, 'João Pedro Souza', '5562955443322', 'Atendimento', v_stage_atrasado,
      'mamis', v_empresa_1, true, now() - interval '4 days', now()
    )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, contact_phone = EXCLUDED.contact_phone, status = EXCLUDED.status,
    stage_id = EXCLUDED.stage_id, empresa_id = EXCLUDED.empresa_id;

  -- 3. Inserir Histórico de Mensagens simulado para o Chat
  INSERT INTO crm.message_history (
    aces_id, lead_id, instance, direction, source_type, provider, content, sent_at
  )
  VALUES
    -- Carlos Silva
    (5, v_lead_1, 'mamis', 'inbound', 'lead', 'evolution', 'Olá, gostaria de saber o valor das lentes multifocais.', now() - interval '2 hours'),
    (5, v_lead_1, 'mamis', 'outbound', 'ai', 'evolution', 'Olá Carlos! Tudo bem? Temos ótimas opções de lentes multifocais com tratamento antirreflexo.', now() - interval '1 hour 55 minutes'),
    -- Mariana Costa
    (5, v_lead_2, 'mamis', 'inbound', 'lead', 'evolution', 'Boa tarde! Qual o prazo de entrega dos meus óculos de grau?', now() - interval '3 hours'),
    (5, v_lead_2, 'mamis', 'outbound', 'human', 'evolution', 'Olá Mariana! Seu pedido está em fase final de montagem no laboratório.', now() - interval '2 hours 50 minutes'),
    (5, v_lead_2, 'mamis', 'inbound', 'lead', 'evolution', 'Perfeito, fico no aguardo!', now() - interval '2 hours 40 minutes'),
    -- Roberto Alves
    (5, v_lead_3, 'mamis', 'inbound', 'lead', 'evolution', 'Vocês fazem exame de vista na loja do Shopping?', now() - interval '30 minutes'),
    (5, v_lead_3, 'mamis', 'outbound', 'ai', 'evolution', 'Fazemos sim Roberto! Agendamos consultas com optometrista parceiro.', now() - interval '20 minutes');

END $$;
