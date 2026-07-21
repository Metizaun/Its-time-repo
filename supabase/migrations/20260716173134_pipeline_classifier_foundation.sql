-- Autonomous, incremental CRM pipeline classifier foundation.
-- The worker is service-role only. No pipeline is enabled automatically.

DO $$
DECLARE
  v_check_type text;
BEGIN
  SELECT data_type
  INTO v_check_type
  FROM information_schema.columns
  WHERE table_schema = 'crm'
    AND table_name = 'leads'
    AND column_name = 'check';

  IF v_check_type = 'timestamp without time zone' THEN
    -- Existing values were written from ISO UTC strings by the backend.
    ALTER TABLE crm.leads
      ALTER COLUMN "check" TYPE timestamptz
      USING "check" AT TIME ZONE 'UTC';
  END IF;
END;
$$;

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS last_pipeline_activity_at timestamptz;

COMMENT ON COLUMN crm.leads."check" IS
  'Watermark: maior message_history.sent_at incluído na última classificação de pipeline concluída.';

COMMENT ON COLUMN crm.leads.last_pipeline_activity_at IS
  'Última interação que reinicia a janela de classificação; follow-ups automáticos e mensagens técnicas não alteram este campo.';

ALTER TABLE crm.pipelines
  ADD COLUMN IF NOT EXISTS ai_reply_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_classification_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS classification_auto_apply_threshold numeric(4,3) NOT NULL DEFAULT 0.850;

ALTER TABLE crm.pipelines
  DROP CONSTRAINT IF EXISTS pipelines_classification_threshold_check;

ALTER TABLE crm.pipelines
  ADD CONSTRAINT pipelines_classification_threshold_check
  CHECK (
    classification_auto_apply_threshold >= 0
    AND classification_auto_apply_threshold <= 1
  );

COMMENT ON COLUMN crm.pipelines.ai_reply_enabled IS
  'Permite respostas automáticas do agente para leads posicionados neste pipeline.';

COMMENT ON COLUMN crm.pipelines.ai_classification_enabled IS
  'Habilita a consolidação/classificação autônoma após a janela de inatividade.';

ALTER TABLE agents.ai_agents
  ADD COLUMN IF NOT EXISTS unanswered_followup_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS last_lead_inbound_at timestamptz;

UPDATE crm.leads AS lead
SET last_pipeline_activity_at = activity.last_activity_at
FROM (
  SELECT
    history.lead_id,
    max(history.sent_at) AS last_activity_at
  FROM crm.message_history AS history
  WHERE history.source_type IN ('lead', 'human')
     OR (
       history.source_type = 'ai'
       AND COALESCE(history.conversation_id, '') !~
         '^(agent_followup|calendar_followup|unanswered_followup):'
     )
  GROUP BY history.lead_id
) AS activity
WHERE lead.id = activity.lead_id
  AND lead.last_pipeline_activity_at IS NULL;

CREATE OR REPLACE FUNCTION crm.set_lead_pipeline_activity_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.source_type IN ('lead', 'human')
     OR (
       NEW.source_type = 'ai'
       AND COALESCE(NEW.conversation_id, '') !~
         '^(agent_followup|calendar_followup|unanswered_followup):'
     ) THEN
    UPDATE crm.leads
    SET
      last_pipeline_activity_at = GREATEST(
        COALESCE(last_pipeline_activity_at, '-infinity'::timestamptz),
        NEW.sent_at
      ),
      updated_at = now()
    WHERE id = NEW.lead_id
      AND aces_id = NEW.aces_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_message_history_pipeline_activity ON crm.message_history;
CREATE TRIGGER trg_message_history_pipeline_activity
AFTER INSERT ON crm.message_history
FOR EACH ROW
EXECUTE FUNCTION crm.set_lead_pipeline_activity_from_message();

CREATE TABLE IF NOT EXISTS crm.pipeline_analysis_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES crm.pipelines(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('full', 'incremental')),
  cutoff_at timestamptz NOT NULL,
  observed_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  suggested_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  applied_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  confidence numeric(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  summary text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  model_name text NOT NULL,
  tokens_input integer CHECK (tokens_input IS NULL OR tokens_input >= 0),
  tokens_output integer CHECK (tokens_output IS NULL OR tokens_output >= 0),
  status text NOT NULL CHECK (status IN ('succeeded', 'failed', 'suggestion_only')),
  decision jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(decision) = 'object'),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_analysis_runs_lead_created
  ON crm.pipeline_analysis_runs(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_analysis_runs_account_created
  ON crm.pipeline_analysis_runs(aces_id, created_at DESC);

CREATE TABLE IF NOT EXISTS crm.lead_pipeline_analysis (
  lead_id uuid PRIMARY KEY REFERENCES crm.leads(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  pipeline_id uuid NOT NULL REFERENCES crm.pipelines(id) ON DELETE CASCADE,
  summary text NOT NULL DEFAULT '',
  qualification_score numeric,
  last_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  last_confidence numeric(4,3) CHECK (
    last_confidence IS NULL OR (last_confidence >= 0 AND last_confidence <= 1)
  ),
  last_check_at timestamptz,
  last_run_id uuid REFERENCES crm.pipeline_analysis_runs(id) ON DELETE SET NULL,
  claim_token uuid,
  claimed_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  retry_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_pipeline_analysis_claim
  ON crm.lead_pipeline_analysis(claimed_until, retry_at);

CREATE INDEX IF NOT EXISTS idx_leads_pipeline_activity_due
  ON crm.leads(last_pipeline_activity_at, "check")
  WHERE view = true;

CREATE INDEX IF NOT EXISTS idx_message_history_pipeline_cutoff
  ON crm.message_history(lead_id, sent_at)
  INCLUDE (aces_id, source_type);

ALTER TABLE crm.pipeline_analysis_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_pipeline_analysis ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON crm.pipeline_analysis_runs FROM PUBLIC, anon, authenticated;
REVOKE ALL ON crm.lead_pipeline_analysis FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.pipeline_analysis_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_pipeline_analysis TO service_role;

CREATE OR REPLACE FUNCTION crm.service_claim_pipeline_analyses(
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 300
)
RETURNS TABLE (
  lead_id uuid,
  aces_id integer,
  pipeline_id uuid,
  stage_id uuid,
  lead_name text,
  instance_name text,
  check_at timestamptz,
  cutoff_at timestamptz,
  last_pipeline_activity_at timestamptz,
  previous_summary text,
  previous_confidence numeric,
  followup_enabled boolean,
  claim_token uuid
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      lead.id AS lead_id,
      lead.aces_id,
      stage.pipeline_id,
      lead.stage_id,
      lead.name::text AS name,
      lead.instancia::text AS instancia,
      lead."check" AS check_at,
      latest.cutoff_at,
      lead.last_pipeline_activity_at,
      COALESCE(agent.unanswered_followup_enabled, false) AS followup_enabled,
      gen_random_uuid() AS next_claim_token
    FROM crm.leads AS lead
    JOIN crm.pipeline_stages AS stage
      ON stage.id = lead.stage_id
     AND stage.aces_id = lead.aces_id
    JOIN crm.pipelines AS pipeline
      ON pipeline.id = stage.pipeline_id
     AND pipeline.aces_id = lead.aces_id
    LEFT JOIN LATERAL (
      SELECT bool_or(candidate_agent.unanswered_followup_enabled) AS unanswered_followup_enabled
      FROM agents.ai_agents AS candidate_agent
      WHERE candidate_agent.aces_id = lead.aces_id
        AND candidate_agent.instance_name = lead.instancia
    ) AS agent ON true
    LEFT JOIN crm.lead_pipeline_analysis AS current_state
      ON current_state.lead_id = lead.id
    CROSS JOIN LATERAL (
      SELECT max(history.sent_at) AS cutoff_at
      FROM crm.message_history AS history
      WHERE history.lead_id = lead.id
        AND history.aces_id = lead.aces_id
        AND history.source_type <> 'system'
    ) AS latest
    WHERE pipeline.is_active = true
      AND pipeline.ai_classification_enabled = true
      AND lead.view = true
      AND lead.last_pipeline_activity_at IS NOT NULL
      AND latest.cutoff_at IS NOT NULL
      AND now() >= lead.last_pipeline_activity_at
        + CASE
            WHEN COALESCE(agent.unanswered_followup_enabled, false)
              THEN interval '4 hours'
            ELSE interval '2 hours'
          END
      AND (
        lead."check" IS NULL
        OR lead.last_pipeline_activity_at > lead."check"
      )
      AND (
        current_state.claimed_until IS NULL
        OR current_state.claimed_until < now()
      )
      AND (
        current_state.retry_at IS NULL
        OR current_state.retry_at <= now()
      )
    ORDER BY lead.last_pipeline_activity_at ASC, lead.id
    FOR UPDATE OF lead SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  ),
  claimed AS (
    INSERT INTO crm.lead_pipeline_analysis (
      lead_id,
      aces_id,
      pipeline_id,
      claim_token,
      claimed_until,
      attempt_count,
      updated_at
    )
    SELECT
      candidate.lead_id,
      candidate.aces_id,
      candidate.pipeline_id,
      candidate.next_claim_token,
      now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 1800))),
      1,
      now()
    FROM candidates AS candidate
    ON CONFLICT ON CONSTRAINT lead_pipeline_analysis_pkey DO UPDATE
    SET
      aces_id = EXCLUDED.aces_id,
      pipeline_id = EXCLUDED.pipeline_id,
      claim_token = EXCLUDED.claim_token,
      claimed_until = EXCLUDED.claimed_until,
      attempt_count = crm.lead_pipeline_analysis.attempt_count + 1,
      last_error = NULL,
      updated_at = now()
    RETURNING
      crm.lead_pipeline_analysis.lead_id,
      crm.lead_pipeline_analysis.summary,
      crm.lead_pipeline_analysis.last_confidence,
      crm.lead_pipeline_analysis.claim_token
  )
  SELECT
    candidate.lead_id,
    candidate.aces_id,
    candidate.pipeline_id,
    candidate.stage_id,
    candidate.name,
    candidate.instancia,
    candidate.check_at,
    candidate.cutoff_at,
    candidate.last_pipeline_activity_at,
    claimed.summary,
    claimed.last_confidence,
    candidate.followup_enabled,
    claimed.claim_token
  FROM candidates AS candidate
  JOIN claimed ON claimed.lead_id = candidate.lead_id;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.service_complete_pipeline_analysis(
  p_lead_id uuid,
  p_claim_token uuid,
  p_cutoff_at timestamptz,
  p_observed_stage_id uuid,
  p_suggested_stage_id uuid,
  p_should_apply_stage boolean,
  p_summary text,
  p_confidence numeric,
  p_reason text,
  p_model_name text,
  p_tokens_input integer DEFAULT NULL,
  p_tokens_output integer DEFAULT NULL,
  p_decision jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_state crm.lead_pipeline_analysis%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_pipeline crm.pipelines%ROWTYPE;
  v_run_id uuid;
  v_mode text;
  v_applied_stage_id uuid;
  v_status text := 'suggestion_only';
  v_skip_reason text;
BEGIN
  SELECT *
  INTO v_state
  FROM crm.lead_pipeline_analysis
  WHERE lead_id = p_lead_id
    AND claim_token = p_claim_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Claim de classificação inválido ou expirado';
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
    AND aces_id = v_state.aces_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead não encontrado para concluir classificação';
  END IF;

  SELECT * INTO v_pipeline
  FROM crm.pipelines
  WHERE id = v_state.pipeline_id
    AND aces_id = v_state.aces_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline não encontrado para concluir classificação';
  END IF;

  v_mode := CASE WHEN v_lead."check" IS NULL THEN 'full' ELSE 'incremental' END;

  IF p_suggested_stage_id IS NOT NULL THEN
    PERFORM 1
    FROM crm.pipeline_stages
    WHERE id = p_suggested_stage_id
      AND aces_id = v_state.aces_id
      AND pipeline_id = v_state.pipeline_id;

    IF NOT FOUND THEN
      v_skip_reason := 'suggested_stage_outside_pipeline';
      p_suggested_stage_id := NULL;
    END IF;
  END IF;

  IF p_should_apply_stage
     AND p_suggested_stage_id IS NOT NULL
     AND COALESCE(p_confidence, 0) >= v_pipeline.classification_auto_apply_threshold THEN
    IF v_lead.stage_id IS DISTINCT FROM p_observed_stage_id THEN
      v_skip_reason := 'stage_changed_during_run';
    ELSIF v_lead.stage_id = p_suggested_stage_id THEN
      v_applied_stage_id := v_lead.stage_id;
      v_skip_reason := 'already_in_stage';
    ELSE
      PERFORM crm.service_move_lead_to_stage(
        p_lead_id,
        p_suggested_stage_id,
        v_state.aces_id
      );
      v_applied_stage_id := p_suggested_stage_id;
      v_status := 'succeeded';
    END IF;
  ELSIF p_should_apply_stage AND COALESCE(p_confidence, 0) < v_pipeline.classification_auto_apply_threshold THEN
    v_skip_reason := 'below_threshold';
  ELSE
    v_skip_reason := 'stage_not_requested';
  END IF;

  INSERT INTO crm.pipeline_analysis_runs (
    idempotency_key,
    aces_id,
    lead_id,
    pipeline_id,
    mode,
    cutoff_at,
    observed_stage_id,
    suggested_stage_id,
    applied_stage_id,
    confidence,
    summary,
    reason,
    model_name,
    tokens_input,
    tokens_output,
    status,
    decision
  ) VALUES (
    'pipeline_classifier:' || p_lead_id::text || ':' || p_cutoff_at::text,
    v_state.aces_id,
    p_lead_id,
    v_state.pipeline_id,
    v_mode,
    p_cutoff_at,
    p_observed_stage_id,
    p_suggested_stage_id,
    v_applied_stage_id,
    p_confidence,
    COALESCE(p_summary, ''),
    COALESCE(p_reason, ''),
    p_model_name,
    p_tokens_input,
    p_tokens_output,
    v_status,
    COALESCE(p_decision, '{}'::jsonb) || jsonb_build_object('skip_reason', v_skip_reason)
  )
  ON CONFLICT (idempotency_key) DO UPDATE
  SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_run_id;

  UPDATE crm.lead_pipeline_analysis
  SET
    pipeline_id = v_state.pipeline_id,
    summary = COALESCE(p_summary, ''),
    last_stage_id = COALESCE(v_applied_stage_id, v_lead.stage_id),
    last_confidence = p_confidence,
    last_check_at = p_cutoff_at,
    last_run_id = v_run_id,
    claim_token = NULL,
    claimed_until = NULL,
    retry_at = NULL,
    last_error = NULL,
    updated_at = now()
  WHERE lead_id = p_lead_id
    AND claim_token = p_claim_token;

  UPDATE crm.leads
  SET "check" = p_cutoff_at
  WHERE id = p_lead_id
    AND aces_id = v_state.aces_id;

  RETURN jsonb_build_object(
    'success', true,
    'run_id', v_run_id,
    'mode', v_mode,
    'applied_stage_id', v_applied_stage_id,
    'skip_reason', v_skip_reason,
    'check_at', p_cutoff_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.service_fail_pipeline_analysis(
  p_lead_id uuid,
  p_claim_token uuid,
  p_error text,
  p_retry_seconds integer DEFAULT 300
)
RETURNS boolean
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $function$
  UPDATE crm.lead_pipeline_analysis
  SET
    claim_token = NULL,
    claimed_until = NULL,
    last_error = left(COALESCE(p_error, 'Falha desconhecida'), 2000),
    retry_at = now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_retry_seconds, 300), 86400))),
    updated_at = now()
  WHERE lead_id = p_lead_id
    AND claim_token = p_claim_token
  RETURNING true;
$function$;

REVOKE ALL ON FUNCTION crm.set_lead_pipeline_activity_from_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.service_claim_pipeline_analyses(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.service_complete_pipeline_analysis(
  uuid, uuid, timestamptz, uuid, uuid, boolean, text, numeric, text, text, integer, integer, jsonb
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.service_fail_pipeline_analysis(uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION crm.service_claim_pipeline_analyses(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.service_complete_pipeline_analysis(
  uuid, uuid, timestamptz, uuid, uuid, boolean, text, numeric, text, text, integer, integer, jsonb
) TO service_role;
GRANT EXECUTE ON FUNCTION crm.service_fail_pipeline_analysis(uuid, uuid, text, integer) TO service_role;

-- Conservative defaults. Existing customized instructions are never overwritten.
UPDATE crm.pipeline_stages AS stage
SET classifier_description = CASE lower(stage.name)
  WHEN 'entrada' THEN 'Lead em primeiro contato ou ainda sem contexto suficiente. Mantenha nesta etapa quando não houver evidência segura de avanço.'
  WHEN 'atendimento' THEN 'Lead em atendimento ativo ou com necessidade ainda sendo compreendida. Silêncio isolado não significa perda.'
  WHEN 'negociacao' THEN 'Lead avaliando proposta, preço, prazo ou condição comercial, com interesse concreto ainda não convertido.'
  WHEN 'negociação' THEN 'Lead avaliando proposta, preço, prazo ou condição comercial, com interesse concreto ainda não convertido.'
  WHEN 'ganho' THEN 'Conversão confirmada por evidência explícita de compra, pagamento, contrato ou conclusão definida pelo negócio.'
  WHEN 'perdido' THEN 'Perda confirmada por recusa ou encerramento explícito. Não classifique como perdido apenas por ausência de resposta.'
  ELSE stage.classifier_description
END
FROM crm.pipelines AS pipeline
WHERE pipeline.id = stage.pipeline_id
  AND pipeline.is_default = true
  AND btrim(stage.classifier_description) = ''
  AND lower(stage.name) IN ('entrada', 'atendimento', 'negociacao', 'negociação', 'ganho', 'perdido');
