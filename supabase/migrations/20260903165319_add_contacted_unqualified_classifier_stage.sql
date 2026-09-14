-- Adiciona um destino seguro para conversas reais sem desfecho comercial e
-- impede que o classificador volte a usar a etapa de entrada Novo.

ALTER TABLE crm.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_classifier_semantic_key_check;

ALTER TABLE crm.pipeline_stages
  ADD CONSTRAINT pipeline_stages_classifier_semantic_key_check
  CHECK (
    classifier_semantic_key IS NULL
    OR classifier_semantic_key IN (
      'new',
      'active_service',
      'contacted_unqualified',
      'quote',
      'won',
      'lost',
      'remarketing'
    )
  );

UPDATE crm.pipeline_stages
SET classifier_is_destination = false,
    updated_at = now()
WHERE classifier_semantic_key = 'new'
  AND classifier_is_destination = true;

ALTER TABLE crm.pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_new_not_classifier_destination_check;

ALTER TABLE crm.pipeline_stages
  ADD CONSTRAINT pipeline_stages_new_not_classifier_destination_check
  CHECK (
    classifier_semantic_key IS DISTINCT FROM 'new'
    OR classifier_is_destination = false
  );

-- Abre uma posicao logo depois de Em atendimento em cada pipeline comercial.
WITH insertion_points AS (
  SELECT
    pipeline.id AS pipeline_id,
    COALESCE(active_stage.position + 1, new_stage.position + 1) AS contact_position
  FROM crm.pipelines AS pipeline
  JOIN crm.pipeline_stages AS new_stage
    ON new_stage.pipeline_id = pipeline.id
   AND new_stage.aces_id = pipeline.aces_id
   AND new_stage.classifier_semantic_key = 'new'
  LEFT JOIN crm.pipeline_stages AS active_stage
    ON active_stage.pipeline_id = pipeline.id
   AND active_stage.aces_id = pipeline.aces_id
   AND active_stage.classifier_semantic_key = 'active_service'
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages AS existing
    WHERE existing.pipeline_id = pipeline.id
      AND existing.classifier_semantic_key = 'contacted_unqualified'
  )
)
UPDATE crm.pipeline_stages AS stage
SET position = stage.position + 1,
    updated_at = now()
FROM insertion_points AS point
WHERE stage.pipeline_id = point.pipeline_id
  AND stage.position >= point.contact_position;

WITH insertion_points AS (
  SELECT
    pipeline.id AS pipeline_id,
    pipeline.aces_id,
    COALESCE(active_stage.position + 1, new_stage.position + 1) AS contact_position
  FROM crm.pipelines AS pipeline
  JOIN crm.pipeline_stages AS new_stage
    ON new_stage.pipeline_id = pipeline.id
   AND new_stage.aces_id = pipeline.aces_id
   AND new_stage.classifier_semantic_key = 'new'
  LEFT JOIN crm.pipeline_stages AS active_stage
    ON active_stage.pipeline_id = pipeline.id
   AND active_stage.aces_id = pipeline.aces_id
   AND active_stage.classifier_semantic_key = 'active_service'
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages AS existing
    WHERE existing.pipeline_id = pipeline.id
      AND existing.classifier_semantic_key = 'contacted_unqualified'
  )
)
INSERT INTO crm.pipeline_stages (
  aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
  classifier_semantic_key, classifier_is_destination,
  classifier_description, classifier_positive_signals,
  classifier_negative_signals, classifier_examples
)
SELECT
  point.aces_id,
  point.pipeline_id,
  'Contato realizado',
  '#3b82f6',
  point.contact_position,
  'Aberto',
  false,
  'contacted_unqualified',
  true,
  'Contato interno, administrativo ou operacional sem jornada comercial do consumidor, ou troca real encerrada sem desfecho comercial. Nao usar para encaminhamento a loja, rejeicao, orcamento ou interesse recuperavel.',
  jsonb_build_array(
    'consulta entre funcionarios ou lojas',
    'consulta de estoque para outra cliente',
    'fechamento de caixa',
    'preenchimento de dados no sistema',
    'troca real sem qualquer desfecho comercial'
  ),
  jsonb_build_array(
    'lead encaminhado concretamente para a loja',
    'endereco solicitado e fornecido',
    'recusa ou desistencia explicita',
    'pedido ou envio de orcamento',
    'interesse comercial recuperavel'
  ),
  jsonb_build_array(
    'Funcionario de outra unidade consulta uma armacao em estoque para uma cliente',
    'Loja pede ajuda sobre fechamento de caixa',
    'Equipe solicita orientacao para preencher um nome no sistema'
  )
FROM insertion_points AS point;

CREATE OR REPLACE FUNCTION crm.fn_create_default_pipeline_stages(p_aces_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  v_pipeline_id := crm.ensure_default_pipeline(p_aces_id);

  INSERT INTO crm.pipeline_stages (
    aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
    classifier_semantic_key, classifier_is_destination
  )
  SELECT
    p_aces_id, v_pipeline_id, item.stage_name, item.stage_color,
    item.stage_position, item.stage_category, item.is_funnel_stage,
    item.semantic_key, item.is_destination
  FROM (VALUES
    ('new', 'Novo', '#64748b', 0, 'Aberto', true, false),
    ('active_service', 'Em atendimento', '#0ea5e9', 1, 'Aberto', true, false),
    ('contacted_unqualified', 'Contato realizado', '#3b82f6', 2, 'Aberto', false, true),
    ('quote', 'Orcamento', '#f59e0b', 3, 'Aberto', true, true),
    ('won', 'Fechado', '#22c55e', 4, 'Ganho', true, true),
    ('lost', 'Perdido', '#ef4444', 5, 'Perdido', true, true),
    ('remarketing', 'Remarketing', '#a855f7', 6, 'Aberto', false, true)
  ) AS item(
    semantic_key, stage_name, stage_color, stage_position, stage_category,
    is_funnel_stage, is_destination
  )
  WHERE NOT EXISTS (
    SELECT 1 FROM crm.pipeline_stages AS existing
    WHERE existing.pipeline_id = v_pipeline_id
      AND existing.classifier_semantic_key = item.semantic_key
  );

  UPDATE crm.pipeline_stages AS stage
  SET
    name = CASE stage.classifier_semantic_key
      WHEN 'new' THEN 'Novo'
      WHEN 'active_service' THEN 'Em atendimento'
      WHEN 'contacted_unqualified' THEN 'Contato realizado'
      WHEN 'quote' THEN 'Orcamento'
      WHEN 'won' THEN 'Fechado'
      WHEN 'lost' THEN 'Perdido'
      WHEN 'remarketing' THEN 'Remarketing'
    END,
    position = CASE stage.classifier_semantic_key
      WHEN 'new' THEN 0 WHEN 'active_service' THEN 1
      WHEN 'contacted_unqualified' THEN 2 WHEN 'quote' THEN 3
      WHEN 'won' THEN 4 WHEN 'lost' THEN 5 WHEN 'remarketing' THEN 6
    END,
    category = CASE stage.classifier_semantic_key
      WHEN 'won' THEN 'Ganho' WHEN 'lost' THEN 'Perdido' ELSE 'Aberto'
    END,
    is_funnel_stage = stage.classifier_semantic_key IN (
      'new', 'active_service', 'quote', 'won', 'lost'
    ),
    classifier_is_destination = stage.classifier_semantic_key NOT IN ('new', 'active_service'),
    classifier_description = CASE stage.classifier_semantic_key
      WHEN 'new' THEN 'Lead cadastrado sem conversa. Etapa de entrada manual e nunca destino do classificador pos-conversa.'
      WHEN 'active_service' THEN 'Etapa operacional temporaria para conversa ativa. Nunca e destino do classificador pos-conversa.'
      WHEN 'contacted_unqualified' THEN 'Contato interno, administrativo ou operacional sem jornada comercial do consumidor, ou troca real encerrada sem desfecho comercial.'
      WHEN 'quote' THEN 'Conversa encerrada com preco, orcamento, parcelas ou condicoes como foco e sem compromisso claro de avancar.'
      WHEN 'won' THEN 'Lead encaminhado concretamente para a loja ou com compromisso explicito de comprar, visitar, agendar, reservar, aceitar orcamento ou avancar.'
      WHEN 'lost' THEN 'Lead recusou explicitamente, pediu encerramento, informou impossibilidade definitiva ou desistiu. Silencio isolado nunca significa perda.'
      WHEN 'remarketing' THEN 'Houve interesse comercial, mas a conversa encerrou sem decisao, sem foco principal em preco e sem rejeicao explicita.'
    END,
    classifier_positive_signals = CASE stage.classifier_semantic_key
      WHEN 'new' THEN jsonb_build_array('lead cadastrado sem conversa')
      WHEN 'active_service' THEN jsonb_build_array('dialogo acontecendo agora')
      WHEN 'contacted_unqualified' THEN jsonb_build_array('consulta interna de estoque', 'fechamento de caixa', 'preenchimento de dados no sistema', 'troca sem desfecho comercial')
      WHEN 'quote' THEN jsonb_build_array('pediu preco ou orcamento', 'recebeu valores e nao avancou', 'perguntou parcelas')
      WHEN 'won' THEN jsonb_build_array('endereco solicitado e fornecido', 'confirmou compra', 'confirmou visita ou agendamento', 'aceitou orcamento')
      WHEN 'lost' THEN jsonb_build_array('recusou explicitamente', 'nao quer o atendimento ou a oferta', 'comprou em outro lugar', 'desistiu')
      WHEN 'remarketing' THEN jsonb_build_array('demonstrou interesse e parou', 'disse que vai pensar', 'adiou sem compromisso')
    END,
    classifier_negative_signals = CASE stage.classifier_semantic_key
      WHEN 'new' THEN jsonb_build_array('qualquer conversa concluida')
      WHEN 'active_service' THEN jsonb_build_array('conversa encerrada por inatividade')
      WHEN 'contacted_unqualified' THEN jsonb_build_array('encaminhamento para loja', 'rejeicao explicita', 'orcamento', 'interesse comercial recuperavel')
      WHEN 'quote' THEN jsonb_build_array('compromisso claro de avancar', 'recusa definitiva')
      WHEN 'won' THEN jsonb_build_array('interesse vago', 'talvez', 'vou pensar', 'pedido de preco sem aceite')
      WHEN 'lost' THEN jsonb_build_array('silencio', 'vou pensar', 'negociacao aberta')
      WHEN 'remarketing' THEN jsonb_build_array('foco em orcamento', 'compromisso confirmado', 'recusa explicita')
    END,
    classifier_examples = CASE stage.classifier_semantic_key
      WHEN 'new' THEN jsonb_build_array('Lead cadastrado sem conversa')
      WHEN 'active_service' THEN jsonb_build_array('Conversa ativa')
      WHEN 'contacted_unqualified' THEN jsonb_build_array('Consulta interna de estoque', 'Ajuda no fechamento de caixa', 'Orientacao de cadastro no sistema')
      WHEN 'quote' THEN jsonb_build_array('Quanto fica?', 'Voces parcelam?')
      WHEN 'won' THEN jsonb_build_array('Qual o endereco? - endereco fornecido', 'Vou passar ai hoje', 'Pode marcar para amanha')
      WHEN 'lost' THEN jsonb_build_array('Nao quero saber de endereco', 'Achei que era de graca e nao quero', 'Nao tenho interesse')
      WHEN 'remarketing' THEN jsonb_build_array('Vou pensar e te aviso', 'Talvez no proximo mes')
    END,
    updated_at = now()
  WHERE stage.pipeline_id = v_pipeline_id
    AND stage.aces_id = p_aces_id
    AND stage.classifier_semantic_key IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION crm.fn_create_default_pipeline_stages(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.fn_create_default_pipeline_stages(integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION crm.rpc_create_pipeline(
  p_name text,
  p_description text DEFAULT '',
  p_ai_classification_enabled boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pipeline crm.pipelines%ROWTYPE;
  v_entry_stage_id uuid;
  v_attendance_stage_id uuid;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem criar pipelines';
  END IF;
  IF NULLIF(btrim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do pipeline';
  END IF;

  INSERT INTO crm.pipelines (
    aces_id, name, description, classifier_key, is_default, is_active,
    ai_classification_enabled, created_by
  ) VALUES (
    public.current_aces_id(), btrim(p_name), btrim(COALESCE(p_description, '')),
    'crm_pipeline_classifier', false, true,
    COALESCE(p_ai_classification_enabled, true), public.current_crm_user_id()
  ) RETURNING * INTO v_pipeline;

  INSERT INTO crm.pipeline_stages (
    aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
    classifier_semantic_key, classifier_is_destination, classifier_description
  ) VALUES (
    v_pipeline.aces_id, v_pipeline.id, 'Entrada', '#64748b', 0, 'Aberto', false,
    'new', false, 'Lead cadastrado sem conversa. Etapa de entrada manual e nunca destino do classificador pos-conversa.'
  ) RETURNING id INTO v_entry_stage_id;

  INSERT INTO crm.pipeline_stages (
    aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
    classifier_semantic_key, classifier_is_destination, classifier_description
  ) VALUES (
    v_pipeline.aces_id, v_pipeline.id, 'Em atendimento', '#0ea5e9', 1, 'Aberto', false,
    'active_service', false, 'Etapa operacional temporaria para conversa ativa. Nao e destino do classificador pos-conversa.'
  ) RETURNING id INTO v_attendance_stage_id;

  INSERT INTO crm.pipeline_stages (
    aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
    classifier_semantic_key, classifier_is_destination, classifier_description,
    classifier_positive_signals, classifier_negative_signals, classifier_examples
  ) VALUES (
    v_pipeline.aces_id, v_pipeline.id, 'Contato realizado', '#3b82f6', 2, 'Aberto', false,
    'contacted_unqualified', true,
    'Contato interno, administrativo ou operacional sem jornada comercial do consumidor, ou troca real encerrada sem desfecho comercial.',
    jsonb_build_array('consulta interna de estoque', 'fechamento de caixa', 'preenchimento de dados no sistema'),
    jsonb_build_array('encaminhamento para loja', 'rejeicao explicita', 'orcamento', 'interesse comercial recuperavel'),
    jsonb_build_array('Consulta de estoque para outra cliente', 'Ajuda no fechamento de caixa', 'Orientacao de cadastro no sistema')
  );

  RETURN jsonb_build_object(
    'id', v_pipeline.id,
    'aces_id', v_pipeline.aces_id,
    'name', v_pipeline.name,
    'description', v_pipeline.description,
    'classifier_key', v_pipeline.classifier_key,
    'is_default', v_pipeline.is_default,
    'is_active', v_pipeline.is_active,
    'ai_reply_enabled', v_pipeline.ai_reply_enabled,
    'ai_classification_enabled', v_pipeline.ai_classification_enabled,
    'classification_auto_apply_threshold', v_pipeline.classification_auto_apply_threshold,
    'created_by', v_pipeline.created_by,
    'created_at', v_pipeline.created_at,
    'updated_at', v_pipeline.updated_at,
    'entry_stage_id', v_entry_stage_id,
    'attendance_stage_id', v_attendance_stage_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION crm.rpc_create_pipeline(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_create_pipeline(text, text, boolean) TO authenticated, service_role;

-- Corrige somente entradas em Novo comprovadamente feitas pelo classificador.
-- now() e estavel por transacao no PostgreSQL; portanto o evento de entrada e
-- o pipeline_analysis_run criados pela mesma aplicacao compartilham o instante.
WITH classifier_moves_to_new AS (
  SELECT DISTINCT ON (lead.id)
    lead.id AS lead_id,
    contact_stage.id AS contact_stage_id
  FROM crm.leads AS lead
  JOIN crm.pipeline_stages AS new_stage
    ON new_stage.id = lead.stage_id
   AND new_stage.aces_id = lead.aces_id
   AND new_stage.classifier_semantic_key = 'new'
  JOIN crm.pipeline_stages AS contact_stage
    ON contact_stage.pipeline_id = new_stage.pipeline_id
   AND contact_stage.aces_id = lead.aces_id
   AND contact_stage.classifier_semantic_key = 'contacted_unqualified'
  JOIN crm.pipeline_analysis_runs AS run
    ON run.lead_id = lead.id
   AND run.aces_id = lead.aces_id
   AND run.pipeline_id = new_stage.pipeline_id
   AND run.applied_stage_id = new_stage.id
   AND run.observed_stage_id IS DISTINCT FROM new_stage.id
   AND run.status = 'succeeded'
  JOIN crm.lead_stage_events AS entered
    ON entered.lead_id = lead.id
   AND entered.aces_id = lead.aces_id
   AND entered.stage_id = new_stage.id
   AND entered.event_type = 'entered'
   AND entered.occurred_at = run.created_at
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.lead_stage_events AS later_event
    WHERE later_event.lead_id = lead.id
      AND later_event.aces_id = lead.aces_id
      AND later_event.occurred_at > entered.occurred_at
  )
  ORDER BY lead.id, run.created_at DESC
)
UPDATE crm.leads AS lead
SET stage_id = move.contact_stage_id,
    status = 'Contato realizado',
    pre_attendance_stage_id = NULL,
    attendance_cycle_started_at = NULL,
    updated_at = now()
FROM classifier_moves_to_new AS move
WHERE lead.id = move.lead_id;
