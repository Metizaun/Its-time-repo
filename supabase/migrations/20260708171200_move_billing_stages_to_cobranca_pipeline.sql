-- =============================================================================
-- Correção: Mover etapas de cobranca do "Pipeline principal" para um
-- pipeline dedicado "Cobranca" na conta Dr. Óculos (aces_id = 5).
--
-- O handleSeedRbBlueprint criava as etapas no pipeline selecionado na UI
-- ao invés de criar um pipeline separado como o bootstrapRbBilling faz.
-- =============================================================================

DO $$
DECLARE
  v_aces_id       integer := 5;
  v_main_pipeline uuid;
  v_new_pipeline  uuid;
  v_stage_names   text[] := ARRAY[
    'A vencer (2 dias)',
    'Vence hoje',
    'Atrasado (1 dia)',
    'Cobranca suave (4 dias)',
    'Atrasado (10 dias)',
    'Cobranca critica (15 dias)',
    'Atendimento',
    'Finalizado'
  ];
BEGIN
  -- Localizar o pipeline principal da conta 5
  SELECT id INTO v_main_pipeline
  FROM crm.pipelines
  WHERE aces_id = v_aces_id
    AND is_default = TRUE
  LIMIT 1;

  IF v_main_pipeline IS NULL THEN
    RAISE NOTICE 'Pipeline principal da conta % nao encontrado; nada a fazer.', v_aces_id;
    RETURN;
  END IF;

  -- Verificar se já existe um pipeline "Cobranca" (ou variantes)
  SELECT id INTO v_new_pipeline
  FROM crm.pipelines
  WHERE aces_id = v_aces_id
    AND (
      name = 'Cobranca'
      OR name ILIKE 'Cobranca - Dr%'
      OR name ILIKE 'Cobrança%'
    )
  LIMIT 1;

  -- Se não existe, criar o pipeline "Cobranca"
  IF v_new_pipeline IS NULL THEN
    INSERT INTO crm.pipelines (aces_id, name, description, classifier_key, is_default, is_active)
    VALUES (
      v_aces_id,
      'Cobranca',
      'Pipeline dedicado para etapas de cobranca e automacoes RB.',
      'crm_pipeline_classifier',
      FALSE,
      TRUE
    )
    RETURNING id INTO v_new_pipeline;

    RAISE NOTICE 'Pipeline "Cobranca" criado: %', v_new_pipeline;
  ELSE
    RAISE NOTICE 'Pipeline de cobranca ja existe: %', v_new_pipeline;
  END IF;

  -- Mover as etapas de cobranca do pipeline principal para o novo pipeline.
  -- Apenas move etapas que pertencem ao pipeline principal (não move duplicatas).
  UPDATE crm.pipeline_stages
  SET pipeline_id = v_new_pipeline
  WHERE pipeline_id = v_main_pipeline
    AND aces_id = v_aces_id
    AND name = ANY(v_stage_names);

  RAISE NOTICE 'Etapas de cobranca movidas para o pipeline "Cobranca".';

  -- Reindexar posições no pipeline principal (preencher buracos)
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_pos
    FROM crm.pipeline_stages
    WHERE pipeline_id = v_main_pipeline
  )
  UPDATE crm.pipeline_stages ps
  SET position = ranked.new_pos
  FROM ranked
  WHERE ps.id = ranked.id
    AND ps.position IS DISTINCT FROM ranked.new_pos;

  -- Reindexar posições no pipeline de cobranca
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) - 1 AS new_pos
    FROM crm.pipeline_stages
    WHERE pipeline_id = v_new_pipeline
  )
  UPDATE crm.pipeline_stages ps
  SET position = ranked.new_pos
  FROM ranked
  WHERE ps.id = ranked.id
    AND ps.position IS DISTINCT FROM ranked.new_pos;

  RAISE NOTICE 'Posicoes reindexadas em ambos pipelines.';
END
$$;
