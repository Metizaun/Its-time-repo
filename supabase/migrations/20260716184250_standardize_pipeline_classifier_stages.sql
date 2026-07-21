-- Padroniza o pipeline principal sem apagar etapas personalizadas e separa
-- etapas operacionais das etapas que podem ser destino do classificador.

ALTER TABLE crm.pipeline_stages
  ADD COLUMN IF NOT EXISTS classifier_semantic_key text,
  ADD COLUMN IF NOT EXISTS classifier_is_destination boolean NOT NULL DEFAULT true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_stages_classifier_semantic_key_check'
      AND conrelid = 'crm.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE crm.pipeline_stages
      ADD CONSTRAINT pipeline_stages_classifier_semantic_key_check
      CHECK (
        classifier_semantic_key IS NULL
        OR classifier_semantic_key IN (
          'new',
          'active_service',
          'quote',
          'won',
          'lost',
          'remarketing'
        )
      );
  END IF;
END;
$$;

-- Vincula apenas uma etapa equivalente a cada papel semantico por pipeline
-- principal. Etapas extras, como "Agendado", continuam intactas e configuraveis.
WITH candidates AS (
  SELECT
    stage.id,
    CASE
      WHEN lower(btrim(stage.name)) IN ('novo', 'entrada') THEN 'new'
      WHEN lower(btrim(stage.name)) IN ('atendimento', 'em atendimento') THEN 'active_service'
      WHEN lower(btrim(stage.name)) IN ('orçamento', 'orcamento', 'negociação', 'negociacao') THEN 'quote'
      WHEN lower(btrim(stage.name)) IN ('fechado', 'finalizado', 'ganho') THEN 'won'
      WHEN lower(btrim(stage.name)) = 'perdido' THEN 'lost'
      WHEN lower(btrim(stage.name)) = 'remarketing' THEN 'remarketing'
      ELSE NULL
    END AS semantic_key,
    row_number() OVER (
      PARTITION BY
        stage.pipeline_id,
        CASE
          WHEN lower(btrim(stage.name)) IN ('novo', 'entrada') THEN 'new'
          WHEN lower(btrim(stage.name)) IN ('atendimento', 'em atendimento') THEN 'active_service'
          WHEN lower(btrim(stage.name)) IN ('orçamento', 'orcamento', 'negociação', 'negociacao') THEN 'quote'
          WHEN lower(btrim(stage.name)) IN ('fechado', 'finalizado', 'ganho') THEN 'won'
          WHEN lower(btrim(stage.name)) = 'perdido' THEN 'lost'
          WHEN lower(btrim(stage.name)) = 'remarketing' THEN 'remarketing'
          ELSE NULL
        END
      ORDER BY stage.position, stage.created_at, stage.id
    ) AS semantic_rank
  FROM crm.pipeline_stages AS stage
  JOIN crm.pipelines AS pipeline
    ON pipeline.id = stage.pipeline_id
   AND pipeline.aces_id = stage.aces_id
  WHERE pipeline.is_default = true
)
UPDATE crm.pipeline_stages AS stage
SET classifier_semantic_key = candidates.semantic_key
FROM candidates
WHERE candidates.id = stage.id
  AND candidates.semantic_key IS NOT NULL
  AND candidates.semantic_rank = 1
  AND stage.classifier_semantic_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_stages_semantic_unique
  ON crm.pipeline_stages(pipeline_id, classifier_semantic_key)
  WHERE classifier_semantic_key IS NOT NULL;

-- Inclui somente as etapas padrao ausentes. Ao inserir no meio do fluxo,
-- desloca as posteriores sem alterar a ordem relativa das etapas customizadas.
DO $$
DECLARE
  v_pipeline record;
  v_item record;
  v_position integer;
BEGIN
  FOR v_pipeline IN
    SELECT id, aces_id
    FROM crm.pipelines
    WHERE is_default = true
    ORDER BY aces_id, id
  LOOP
    FOR v_item IN
      SELECT *
      FROM (VALUES
        ('new', 0, 'Novo', '#64748b', 'Aberto', true),
        ('active_service', 1, 'Em atendimento', '#0ea5e9', 'Aberto', false),
        ('quote', 2, 'Orçamento', '#f59e0b', 'Aberto', true),
        ('won', 3, 'Fechado', '#22c55e', 'Ganho', true),
        ('lost', 4, 'Perdido', '#ef4444', 'Perdido', true),
        ('remarketing', 5, 'Remarketing', '#a855f7', 'Aberto', true)
      ) AS standard_stage(
        semantic_key,
        semantic_order,
        stage_name,
        stage_color,
        stage_category,
        is_destination
      )
      ORDER BY semantic_order
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM crm.pipeline_stages
        WHERE pipeline_id = v_pipeline.id
          AND classifier_semantic_key = v_item.semantic_key
      ) THEN
        SELECT min(stage.position)
        INTO v_position
        FROM crm.pipeline_stages AS stage
        WHERE stage.pipeline_id = v_pipeline.id
          AND CASE stage.classifier_semantic_key
            WHEN 'new' THEN 0
            WHEN 'active_service' THEN 1
            WHEN 'quote' THEN 2
            WHEN 'won' THEN 3
            WHEN 'lost' THEN 4
            WHEN 'remarketing' THEN 5
            ELSE -1
          END > v_item.semantic_order;

        IF v_position IS NULL THEN
          SELECT COALESCE(max(position) + 1, 0)
          INTO v_position
          FROM crm.pipeline_stages
          WHERE pipeline_id = v_pipeline.id;
        ELSE
          UPDATE crm.pipeline_stages
          SET position = position + 1
          WHERE pipeline_id = v_pipeline.id
            AND position >= v_position;
        END IF;

        INSERT INTO crm.pipeline_stages (
          aces_id,
          pipeline_id,
          name,
          color,
          position,
          category,
          is_funnel_stage,
          classifier_semantic_key,
          classifier_is_destination
        ) VALUES (
          v_pipeline.aces_id,
          v_pipeline.id,
          v_item.stage_name,
          v_item.stage_color,
          v_position,
          v_item.stage_category,
          false,
          v_item.semantic_key,
          v_item.is_destination
        );
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- Os nomes ficam previsiveis para todos os clientes atuais. Cores e etapas
-- adicionais sao preservadas.
UPDATE crm.pipeline_stages AS stage
SET
  name = CASE stage.classifier_semantic_key
    WHEN 'new' THEN 'Novo'
    WHEN 'active_service' THEN 'Em atendimento'
    WHEN 'quote' THEN 'Orçamento'
    WHEN 'won' THEN 'Fechado'
    WHEN 'lost' THEN 'Perdido'
    WHEN 'remarketing' THEN 'Remarketing'
  END,
  category = CASE stage.classifier_semantic_key
    WHEN 'won' THEN 'Ganho'
    WHEN 'lost' THEN 'Perdido'
    ELSE 'Aberto'
  END,
  classifier_is_destination = stage.classifier_semantic_key <> 'active_service',
  classifier_description = CASE stage.classifier_semantic_key
    WHEN 'new' THEN
      'Lead sem qualquer mensagem ou tentativa de contato registrada. Se existe mensagem no histórico, esta etapa não é válida.'
    WHEN 'active_service' THEN
      'Etapa operacional temporária para conversa ativa. O classificador pós-inatividade nunca pode escolher esta etapa como destino.'
    WHEN 'quote' THEN
      'A conversa encerrada teve preço, orçamento, parcelas ou condições comerciais como foco e não houve compromisso claro de avançar.'
    WHEN 'won' THEN
      'O lead confirmou de forma explícita compra, visita, agendamento, reserva, aceite do orçamento ou outro compromisso concreto de avançar.'
    WHEN 'lost' THEN
      'O lead recusou explicitamente, pediu encerramento, informou impossibilidade definitiva ou desistiu. Silêncio isolado nunca significa perda.'
    WHEN 'remarketing' THEN
      'Houve interesse comercial, mas a conversa encerrou sem decisão, sem foco principal em preço e sem rejeição explícita. É uma oportunidade recuperável.'
  END,
  classifier_positive_signals = CASE stage.classifier_semantic_key
    WHEN 'new' THEN jsonb_build_array('histórico completamente vazio', 'nenhuma tentativa de contato')
    WHEN 'active_service' THEN jsonb_build_array('diálogo acontecendo agora', 'pergunta ainda aguardando resposta imediata')
    WHEN 'quote' THEN jsonb_build_array('pediu preço ou orçamento', 'recebeu valores e não avançou', 'perguntou parcelas ou condição de pagamento')
    WHEN 'won' THEN jsonb_build_array('confirmou compra', 'confirmou visita ou agendamento', 'aceitou orçamento', 'pediu pagamento ou reserva')
    WHEN 'lost' THEN jsonb_build_array('recusou explicitamente', 'pediu para não receber contato', 'comprou em outro lugar', 'desistiu de forma definitiva')
    WHEN 'remarketing' THEN jsonb_build_array('demonstrou interesse e parou', 'disse que vai pensar', 'adiou sem compromisso', 'pediu informações gerais e não continuou')
  END,
  classifier_negative_signals = CASE stage.classifier_semantic_key
    WHEN 'new' THEN jsonb_build_array('qualquer mensagem no histórico')
    WHEN 'active_service' THEN jsonb_build_array('conversa encerrada por inatividade', 'classificação executada após a janela de espera')
    WHEN 'quote' THEN jsonb_build_array('compromisso claro de avançar', 'recusa definitiva', 'interesse sem foco em preço')
    WHEN 'won' THEN jsonb_build_array('interesse vago', 'talvez', 'vou pensar', 'pedido de preço sem aceite')
    WHEN 'lost' THEN jsonb_build_array('silêncio', 'vou pensar', 'pedido para falar depois', 'negociação ainda aberta')
    WHEN 'remarketing' THEN jsonb_build_array('foco principal em orçamento', 'compromisso confirmado', 'recusa explícita', 'conversa ativa')
  END,
  classifier_examples = CASE stage.classifier_semantic_key
    WHEN 'new' THEN jsonb_build_array('Lead cadastrado sem mensagens')
    WHEN 'active_service' THEN jsonb_build_array('Conversa ativa; etapa usada pelo atendimento, não pelo classificador pós-conversa')
    WHEN 'quote' THEN jsonb_build_array('Quanto fica?', 'Vocês parcelam?', 'Recebeu o valor e não respondeu')
    WHEN 'won' THEN jsonb_build_array('Pode marcar para amanhã', 'Aceito o orçamento', 'Vou passar aí hoje', 'Pode separar para mim')
    WHEN 'lost' THEN jsonb_build_array('Não tenho interesse', 'Já comprei em outro lugar', 'Não quero mais', 'Pode tirar meu número da lista')
    WHEN 'remarketing' THEN jsonb_build_array('Vou pensar e te aviso', 'Talvez no próximo mês', 'Pediu informações e depois não respondeu')
  END,
  updated_at = now()
FROM crm.pipelines AS pipeline
WHERE pipeline.id = stage.pipeline_id
  AND pipeline.aces_id = stage.aces_id
  AND pipeline.is_default = true
  AND stage.classifier_semantic_key IS NOT NULL;

-- Mesmo fora do pipeline principal, uma coluna de atendimento continua sendo
-- operacional e nunca deve ser oferecida como destino pós-conversa.
UPDATE crm.pipeline_stages
SET classifier_is_destination = false,
    updated_at = now()
WHERE lower(btrim(name)) IN ('atendimento', 'em atendimento');

-- Mantem o campo legado status coerente sem mover nenhum lead de coluna.
UPDATE crm.leads AS lead
SET status = CASE stage.classifier_semantic_key
  WHEN 'new' THEN 'Novo'
  WHEN 'active_service' THEN 'Em atendimento'
  WHEN 'quote' THEN 'Orçamento'
  WHEN 'won' THEN 'Fechado'
  WHEN 'lost' THEN 'Perdido'
  WHEN 'remarketing' THEN 'Remarketing'
END
FROM crm.pipeline_stages AS stage
JOIN crm.pipelines AS pipeline
  ON pipeline.id = stage.pipeline_id
 AND pipeline.is_default = true
WHERE lead.stage_id = stage.id
  AND lead.aces_id = stage.aces_id
  -- Registros legados com responsavel ausente ou de outra conta precisam ser
  -- saneados separadamente. Atualiza-los aqui acionaria a validacao de tenant
  -- do trigger e abortaria todo o backfill de classificacao.
  AND (
    lead.owner_id IS NULL
    OR EXISTS (
      SELECT 1
      FROM crm.users AS owner_user
      WHERE owner_user.id = lead.owner_id
        AND owner_user.aces_id = lead.aces_id
    )
  )
  AND stage.classifier_semantic_key IS NOT NULL
  AND lead.status IS DISTINCT FROM CASE stage.classifier_semantic_key
    WHEN 'new' THEN 'Novo'
    WHEN 'active_service' THEN 'Em atendimento'
    WHEN 'quote' THEN 'Orçamento'
    WHEN 'won' THEN 'Fechado'
    WHEN 'lost' THEN 'Perdido'
    WHEN 'remarketing' THEN 'Remarketing'
  END;

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
    aces_id,
    pipeline_id,
    name,
    color,
    position,
    category,
    is_funnel_stage,
    classifier_semantic_key,
    classifier_is_destination
  )
  SELECT
    p_aces_id,
    v_pipeline_id,
    item.stage_name,
    item.stage_color,
    item.stage_position,
    item.stage_category,
    item.is_funnel_stage,
    item.semantic_key,
    item.is_destination
  FROM (VALUES
    ('new', 'Novo', '#64748b', 0, 'Aberto', true, true),
    ('active_service', 'Em atendimento', '#0ea5e9', 1, 'Aberto', true, false),
    ('quote', 'Orçamento', '#f59e0b', 2, 'Aberto', true, true),
    ('won', 'Fechado', '#22c55e', 3, 'Ganho', true, true),
    ('lost', 'Perdido', '#ef4444', 4, 'Perdido', true, true),
    ('remarketing', 'Remarketing', '#a855f7', 5, 'Aberto', false, true)
  ) AS item(
    semantic_key,
    stage_name,
    stage_color,
    stage_position,
    stage_category,
    is_funnel_stage,
    is_destination
  )
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages AS existing
    WHERE existing.pipeline_id = v_pipeline_id
      AND existing.classifier_semantic_key = item.semantic_key
  );

  UPDATE crm.pipeline_stages AS stage
  SET
    name = CASE stage.classifier_semantic_key
      WHEN 'new' THEN 'Novo'
      WHEN 'active_service' THEN 'Em atendimento'
      WHEN 'quote' THEN 'Orçamento'
      WHEN 'won' THEN 'Fechado'
      WHEN 'lost' THEN 'Perdido'
      WHEN 'remarketing' THEN 'Remarketing'
    END,
    category = CASE stage.classifier_semantic_key
      WHEN 'won' THEN 'Ganho'
      WHEN 'lost' THEN 'Perdido'
      ELSE 'Aberto'
    END,
    classifier_is_destination = stage.classifier_semantic_key <> 'active_service',
    classifier_description = CASE stage.classifier_semantic_key
      WHEN 'new' THEN 'Lead sem qualquer mensagem ou tentativa de contato registrada. Se existe mensagem no histórico, esta etapa não é válida.'
      WHEN 'active_service' THEN 'Etapa operacional temporária para conversa ativa. O classificador pós-inatividade nunca pode escolher esta etapa como destino.'
      WHEN 'quote' THEN 'A conversa encerrada teve preço, orçamento, parcelas ou condições comerciais como foco e não houve compromisso claro de avançar.'
      WHEN 'won' THEN 'O lead confirmou de forma explícita compra, visita, agendamento, reserva, aceite do orçamento ou outro compromisso concreto de avançar.'
      WHEN 'lost' THEN 'O lead recusou explicitamente, pediu encerramento, informou impossibilidade definitiva ou desistiu. Silêncio isolado nunca significa perda.'
      WHEN 'remarketing' THEN 'Houve interesse comercial, mas a conversa encerrou sem decisão, sem foco principal em preço e sem rejeição explícita. É uma oportunidade recuperável.'
    END,
    classifier_positive_signals = CASE stage.classifier_semantic_key
      WHEN 'new' THEN jsonb_build_array('histórico completamente vazio', 'nenhuma tentativa de contato')
      WHEN 'active_service' THEN jsonb_build_array('diálogo acontecendo agora', 'pergunta ainda aguardando resposta imediata')
      WHEN 'quote' THEN jsonb_build_array('pediu preço ou orçamento', 'recebeu valores e não avançou', 'perguntou parcelas ou condição de pagamento')
      WHEN 'won' THEN jsonb_build_array('confirmou compra', 'confirmou visita ou agendamento', 'aceitou orçamento', 'pediu pagamento ou reserva')
      WHEN 'lost' THEN jsonb_build_array('recusou explicitamente', 'pediu para não receber contato', 'comprou em outro lugar', 'desistiu de forma definitiva')
      WHEN 'remarketing' THEN jsonb_build_array('demonstrou interesse e parou', 'disse que vai pensar', 'adiou sem compromisso', 'pediu informações gerais e não continuou')
    END,
    classifier_negative_signals = CASE stage.classifier_semantic_key
      WHEN 'new' THEN jsonb_build_array('qualquer mensagem no histórico')
      WHEN 'active_service' THEN jsonb_build_array('conversa encerrada por inatividade', 'classificação executada após a janela de espera')
      WHEN 'quote' THEN jsonb_build_array('compromisso claro de avançar', 'recusa definitiva', 'interesse sem foco em preço')
      WHEN 'won' THEN jsonb_build_array('interesse vago', 'talvez', 'vou pensar', 'pedido de preço sem aceite')
      WHEN 'lost' THEN jsonb_build_array('silêncio', 'vou pensar', 'pedido para falar depois', 'negociação ainda aberta')
      WHEN 'remarketing' THEN jsonb_build_array('foco principal em orçamento', 'compromisso confirmado', 'recusa explícita', 'conversa ativa')
    END,
    classifier_examples = CASE stage.classifier_semantic_key
      WHEN 'new' THEN jsonb_build_array('Lead cadastrado sem mensagens')
      WHEN 'active_service' THEN jsonb_build_array('Conversa ativa; etapa usada pelo atendimento, não pelo classificador pós-conversa')
      WHEN 'quote' THEN jsonb_build_array('Quanto fica?', 'Vocês parcelam?', 'Recebeu o valor e não respondeu')
      WHEN 'won' THEN jsonb_build_array('Pode marcar para amanhã', 'Aceito o orçamento', 'Vou passar aí hoje', 'Pode separar para mim')
      WHEN 'lost' THEN jsonb_build_array('Não tenho interesse', 'Já comprei em outro lugar', 'Não quero mais', 'Pode tirar meu número da lista')
      WHEN 'remarketing' THEN jsonb_build_array('Vou pensar e te aviso', 'Talvez no próximo mês', 'Pediu informações e depois não respondeu')
    END,
    updated_at = now()
  WHERE stage.pipeline_id = v_pipeline_id
    AND stage.aces_id = p_aces_id
    AND stage.classifier_semantic_key IS NOT NULL;
END;
$function$;

REVOKE ALL ON FUNCTION crm.fn_create_default_pipeline_stages(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.fn_create_default_pipeline_stages(integer) TO authenticated, service_role;
