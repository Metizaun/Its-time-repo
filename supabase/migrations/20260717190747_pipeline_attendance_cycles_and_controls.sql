-- Pipeline attendance cycles, transactional controls and fair classifier claims.
-- This migration intentionally runs after the classifier standardization and RLS hardening.

ALTER TABLE crm.leads
  ADD COLUMN IF NOT EXISTS pre_attendance_stage_id uuid
    REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attendance_cycle_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_leads_pre_attendance_stage
  ON crm.leads(pre_attendance_stage_id)
  WHERE pre_attendance_stage_id IS NOT NULL;

COMMENT ON COLUMN crm.leads.pre_attendance_stage_id IS
  'Etapa do mesmo pipeline em que o lead estava antes do ciclo atual de atendimento.';
COMMENT ON COLUMN crm.leads.attendance_cycle_started_at IS
  'Inicio do ciclo de atendimento aberto pela primeira mensagem inbound ainda pendente de classificacao.';

ALTER TABLE crm.pipelines
  ALTER COLUMN ai_classification_enabled SET DEFAULT true;

UPDATE crm.pipelines
SET ai_classification_enabled = true,
    updated_at = now()
WHERE is_active = true
  AND ai_classification_enabled IS DISTINCT FROM true;

-- Every active pipeline receives one operational stage. Prefer an existing stage
-- with the expected name; create one only when the pipeline has no candidate.
WITH ranked_candidates AS (
  SELECT
    stage.id,
    stage.pipeline_id,
    row_number() OVER (
      PARTITION BY stage.pipeline_id
      ORDER BY
        CASE lower(btrim(stage.name)) WHEN 'em atendimento' THEN 0 ELSE 1 END,
        stage.position,
        stage.created_at,
        stage.id
    ) AS candidate_rank
  FROM crm.pipeline_stages AS stage
  JOIN crm.pipelines AS pipeline
    ON pipeline.id = stage.pipeline_id
   AND pipeline.aces_id = stage.aces_id
  WHERE pipeline.is_active = true
    AND lower(btrim(stage.name)) IN ('atendimento', 'em atendimento')
    AND NOT EXISTS (
      SELECT 1
      FROM crm.pipeline_stages AS operational
      WHERE operational.pipeline_id = stage.pipeline_id
        AND operational.classifier_semantic_key = 'active_service'
    )
)
UPDATE crm.pipeline_stages AS stage
SET classifier_semantic_key = 'active_service',
    classifier_is_destination = false,
    updated_at = now()
FROM ranked_candidates AS candidate
WHERE candidate.id = stage.id
  AND candidate.candidate_rank = 1;

INSERT INTO crm.pipeline_stages (
  aces_id,
  pipeline_id,
  name,
  color,
  position,
  category,
  is_funnel_stage,
  classifier_semantic_key,
  classifier_is_destination,
  classifier_description
)
SELECT
  pipeline.aces_id,
  pipeline.id,
  'Em atendimento',
  '#0ea5e9',
  COALESCE((SELECT max(stage.position) + 1 FROM crm.pipeline_stages AS stage WHERE stage.pipeline_id = pipeline.id), 0),
  'Aberto',
  false,
  'active_service',
  false,
  'Etapa operacional temporaria para conversa ativa. Nao e destino do classificador pos-conversa.'
FROM crm.pipelines AS pipeline
WHERE pipeline.is_active = true
  AND NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages AS stage
    WHERE stage.pipeline_id = pipeline.id
      AND stage.classifier_semantic_key = 'active_service'
  );

UPDATE crm.pipeline_stages
SET classifier_is_destination = false,
    updated_at = now()
WHERE classifier_semantic_key = 'active_service'
  AND classifier_is_destination IS DISTINCT FROM false;

-- Deferred invariant: active pipelines commit with exactly one attendance stage.
CREATE OR REPLACE FUNCTION crm.enforce_pipeline_attendance_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'pipelines' THEN
    v_pipeline_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_pipeline_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.pipeline_id ELSE NEW.pipeline_id END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.pipelines AS pipeline
    WHERE pipeline.id = v_pipeline_id
      AND pipeline.is_active = true
  ) AND (
    SELECT count(*)
    FROM crm.pipeline_stages AS stage
    WHERE stage.pipeline_id = v_pipeline_id
      AND stage.classifier_semantic_key = 'active_service'
  ) <> 1 THEN
    RAISE EXCEPTION 'Pipeline ativo deve possuir exatamente uma etapa de Atendimento';
  END IF;

  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pipeline_attendance_invariant_on_pipeline ON crm.pipelines;
CREATE CONSTRAINT TRIGGER trg_pipeline_attendance_invariant_on_pipeline
AFTER INSERT OR UPDATE OF is_active ON crm.pipelines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION crm.enforce_pipeline_attendance_stage();

DROP TRIGGER IF EXISTS trg_pipeline_attendance_invariant_on_stage ON crm.pipeline_stages;
CREATE CONSTRAINT TRIGGER trg_pipeline_attendance_invariant_on_stage
AFTER INSERT OR DELETE OR UPDATE OF pipeline_id, classifier_semantic_key ON crm.pipeline_stages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION crm.enforce_pipeline_attendance_stage();

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
  )
  RETURNING * INTO v_pipeline;

  INSERT INTO crm.pipeline_stages (
    aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
    classifier_semantic_key, classifier_is_destination, classifier_description
  ) VALUES (
    v_pipeline.aces_id, v_pipeline.id, 'Entrada', '#64748b', 0, 'Aberto', false,
    'new', true, 'Lead novo ou ainda sem contexto suficiente para classificacao.'
  ) RETURNING id INTO v_entry_stage_id;

  INSERT INTO crm.pipeline_stages (
    aces_id, pipeline_id, name, color, position, category, is_funnel_stage,
    classifier_semantic_key, classifier_is_destination, classifier_description
  ) VALUES (
    v_pipeline.aces_id, v_pipeline.id, 'Em atendimento', '#0ea5e9', 1, 'Aberto', false,
    'active_service', false,
    'Etapa operacional temporaria para conversa ativa. Nao e destino do classificador pos-conversa.'
  ) RETURNING id INTO v_attendance_stage_id;

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

CREATE OR REPLACE FUNCTION crm.rpc_set_pipeline_classification(
  p_pipeline_id uuid,
  p_enabled boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pipeline crm.pipelines%ROWTYPE;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem alterar a classificacao automatica';
  END IF;

  UPDATE crm.pipelines
  SET ai_classification_enabled = COALESCE(p_enabled, false), updated_at = now()
  WHERE id = p_pipeline_id
    AND aces_id = public.current_aces_id()
    AND is_active = true
  RETURNING * INTO v_pipeline;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline nao encontrado para a conta atual';
  END IF;

  RETURN jsonb_build_object(
    'id', v_pipeline.id,
    'ai_classification_enabled', v_pipeline.ai_classification_enabled,
    'updated_at', v_pipeline.updated_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_designate_attendance_stage(
  p_pipeline_id uuid,
  p_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_aces_id integer;
  v_previous_stage_id uuid;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem transferir a etapa de Atendimento';
  END IF;

  SELECT pipeline.aces_id INTO v_aces_id
  FROM crm.pipelines AS pipeline
  WHERE pipeline.id = p_pipeline_id
    AND pipeline.aces_id = public.current_aces_id()
    AND pipeline.is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline nao encontrado para a conta atual';
  END IF;

  PERFORM 1 FROM crm.pipeline_stages AS stage
  WHERE stage.id = p_stage_id
    AND stage.pipeline_id = p_pipeline_id
    AND stage.aces_id = v_aces_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa nao pertence ao pipeline informado';
  END IF;

  SELECT stage.id INTO v_previous_stage_id
  FROM crm.pipeline_stages AS stage
  WHERE stage.pipeline_id = p_pipeline_id
    AND stage.classifier_semantic_key = 'active_service'
  FOR UPDATE;

  IF v_previous_stage_id IS DISTINCT FROM p_stage_id THEN
    UPDATE crm.pipeline_stages AS stage
    SET
      classifier_semantic_key = CASE WHEN stage.id = p_stage_id THEN 'active_service' ELSE NULL END,
      classifier_is_destination = stage.id <> p_stage_id,
      updated_at = now()
    WHERE stage.pipeline_id = p_pipeline_id
      AND stage.id IN (p_stage_id, v_previous_stage_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pipeline_id', p_pipeline_id,
    'stage_id', p_stage_id,
    'previous_stage_id', v_previous_stage_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION crm.rpc_create_pipeline(text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.rpc_set_pipeline_classification(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.rpc_designate_attendance_stage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_create_pipeline(text, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_set_pipeline_classification(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_designate_attendance_stage(uuid, uuid) TO authenticated, service_role;

-- Inbound is scoped by the lead's current pipeline and starts one cycle only.
CREATE OR REPLACE FUNCTION crm.promote_inbound_lead_to_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_current_stage_id uuid;
  v_pipeline_id uuid;
  v_attendance_stage_id uuid;
  v_attendance_status text;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'inbound' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT lead.stage_id, current_stage.pipeline_id
  INTO v_current_stage_id, v_pipeline_id
  FROM crm.leads AS lead
  JOIN crm.pipeline_stages AS current_stage
    ON current_stage.id = lead.stage_id
   AND current_stage.aces_id = lead.aces_id
  WHERE lead.id = NEW.lead_id
    AND lead.aces_id = NEW.aces_id
  FOR UPDATE OF lead;

  IF v_pipeline_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT stage.id, stage.name
  INTO v_attendance_stage_id, v_attendance_status
  FROM crm.pipeline_stages AS stage
  WHERE stage.pipeline_id = v_pipeline_id
    AND stage.aces_id = NEW.aces_id
    AND stage.classifier_semantic_key = 'active_service'
  LIMIT 1;

  IF v_attendance_stage_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline do lead nao possui etapa de Atendimento';
  END IF;

  UPDATE crm.leads
  SET
    pre_attendance_stage_id = CASE
      WHEN v_current_stage_id IS DISTINCT FROM v_attendance_stage_id THEN v_current_stage_id
      ELSE pre_attendance_stage_id
    END,
    attendance_cycle_started_at = CASE
      WHEN v_current_stage_id IS DISTINCT FROM v_attendance_stage_id
        OR attendance_cycle_started_at IS NULL THEN NEW.sent_at
      ELSE attendance_cycle_started_at
    END,
    stage_id = v_attendance_stage_id,
    status = v_attendance_status,
    updated_at = now()
  WHERE id = NEW.lead_id
    AND aces_id = NEW.aces_id;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_promote_inbound_lead_to_attendance ON crm.message_history;
CREATE TRIGGER trg_promote_inbound_lead_to_attendance
AFTER INSERT ON crm.message_history
FOR EACH ROW
WHEN (NEW.direction = 'inbound')
EXECUTE FUNCTION crm.promote_inbound_lead_to_attendance();

-- Manual moves cannot cross pipelines and close any pending attendance cycle.
CREATE OR REPLACE FUNCTION crm.rpc_move_lead_to_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_stage crm.pipeline_stages%ROWTYPE;
  v_current_pipeline_id uuid;
BEGIN
  IF NOT crm.current_user_can_edit_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Lead nao encontrado ou sem permissao de edicao';
  END IF;

  SELECT current_stage.pipeline_id INTO v_current_pipeline_id
  FROM crm.leads AS lead
  LEFT JOIN crm.pipeline_stages AS current_stage ON current_stage.id = lead.stage_id
  WHERE lead.id = p_lead_id
    AND lead.aces_id = public.current_aces_id()
  FOR UPDATE OF lead;

  SELECT * INTO v_stage
  FROM crm.pipeline_stages
  WHERE id = p_stage_id
    AND aces_id = public.current_aces_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa nao encontrada para a conta atual';
  END IF;
  IF v_current_pipeline_id IS NOT NULL AND v_stage.pipeline_id IS DISTINCT FROM v_current_pipeline_id THEN
    RAISE EXCEPTION 'Movimento entre pipelines nao e permitido';
  END IF;

  UPDATE crm.leads
  SET
    stage_id = p_stage_id,
    status = CASE
      WHEN v_stage.category = 'Ganho' THEN 'Fechado'
      WHEN v_stage.category = 'Perdido' THEN 'Perdido'
      ELSE v_stage.name
    END,
    pre_attendance_stage_id = CASE WHEN v_stage.classifier_semantic_key = 'active_service' THEN pre_attendance_stage_id ELSE NULL END,
    attendance_cycle_started_at = CASE WHEN v_stage.classifier_semantic_key = 'active_service' THEN attendance_cycle_started_at ELSE NULL END,
    updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = public.current_aces_id();

  RETURN jsonb_build_object('success', true, 'pipeline_id', v_stage.pipeline_id, 'stage_id', v_stage.id);
END;
$function$;

REVOKE ALL ON FUNCTION crm.rpc_move_lead_to_stage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_move_lead_to_stage(uuid, uuid) TO authenticated;

-- The legacy status synchronizer searched stages account-wide and overwrote an
-- explicit stage during INSERT. Preserve explicit placement and scope status
-- changes to the lead's current pipeline.
CREATE OR REPLACE FUNCTION crm.sync_status_and_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
  v_stage crm.pipeline_stages%ROWTYPE;
  v_pipeline_id uuid;
BEGIN
  IF NEW.stage_id IS NOT NULL AND (
    TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND NEW.stage_id IS DISTINCT FROM OLD.stage_id)
  ) THEN
    SELECT * INTO v_stage
    FROM crm.pipeline_stages AS stage
    WHERE stage.id = NEW.stage_id
      AND stage.aces_id = NEW.aces_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Etapa informada nao pertence a conta do lead';
    END IF;
    NEW.status := CASE
      WHEN v_stage.category = 'Ganho' THEN 'Fechado'
      WHEN v_stage.category = 'Perdido' THEN 'Perdido'
      ELSE v_stage.name
    END;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    SELECT stage.pipeline_id INTO v_pipeline_id
    FROM crm.pipeline_stages AS stage
    WHERE stage.id = OLD.stage_id
      AND stage.aces_id = NEW.aces_id;

    SELECT * INTO v_stage
    FROM crm.pipeline_stages AS stage
    WHERE stage.pipeline_id = v_pipeline_id
      AND stage.aces_id = NEW.aces_id
      AND (
        lower(stage.name) = lower(COALESCE(NEW.status::text, ''))
        OR (lower(COALESCE(NEW.status::text, '')) IN ('ganho', 'fechado', 'sucesso', 'won', 'closed', 'vendido') AND stage.category = 'Ganho')
        OR (lower(COALESCE(NEW.status::text, '')) IN ('perdido', 'lost', 'cancelado', 'descartado') AND stage.category = 'Perdido')
      )
    ORDER BY
      CASE WHEN lower(stage.name) = lower(COALESCE(NEW.status::text, '')) THEN 0 ELSE 1 END,
      stage.position,
      stage.id
    LIMIT 1;

    IF FOUND THEN
      NEW.stage_id := v_stage.id;
      NEW.status := CASE
        WHEN v_stage.category = 'Ganho' THEN 'Fechado'
        WHEN v_stage.category = 'Perdido' THEN 'Perdido'
        ELSE v_stage.name
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Add a fair claim overload. The two-argument foundation function remains for
-- backwards compatibility; the worker uses this account-capped overload.
CREATE OR REPLACE FUNCTION crm.service_claim_pipeline_analyses(
  p_limit integer,
  p_lease_seconds integer,
  p_per_account_limit integer
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
  claim_token uuid,
  origin_stage_id uuid,
  origin_stage_name text,
  attendance_cycle_started_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  RETURN QUERY
  WITH eligible AS (
    SELECT
      lead.id AS lead_id,
      lead.aces_id,
      stage.pipeline_id,
      lead.stage_id,
      lead.name::text AS lead_name,
      lead.instancia::text AS instance_name,
      lead."check" AS check_at,
      latest.cutoff_at,
      lead.last_pipeline_activity_at,
      COALESCE(agent.unanswered_followup_enabled, false) AS followup_enabled,
      lead.pre_attendance_stage_id AS origin_stage_id,
      origin_stage.name::text AS origin_stage_name,
      lead.attendance_cycle_started_at,
      row_number() OVER (
        PARTITION BY lead.aces_id
        ORDER BY lead.last_pipeline_activity_at, lead.id
      ) AS account_rank
    FROM crm.leads AS lead
    JOIN crm.pipeline_stages AS stage
      ON stage.id = lead.stage_id AND stage.aces_id = lead.aces_id
    JOIN crm.pipelines AS pipeline
      ON pipeline.id = stage.pipeline_id AND pipeline.aces_id = lead.aces_id
    LEFT JOIN crm.pipeline_stages AS origin_stage
      ON origin_stage.id = lead.pre_attendance_stage_id
     AND origin_stage.pipeline_id = stage.pipeline_id
     AND origin_stage.aces_id = lead.aces_id
    LEFT JOIN LATERAL (
      SELECT bool_or(candidate_agent.unanswered_followup_enabled) AS unanswered_followup_enabled
      FROM agents.ai_agents AS candidate_agent
      WHERE candidate_agent.aces_id = lead.aces_id
        AND candidate_agent.instance_name = lead.instancia
    ) AS agent ON true
    LEFT JOIN crm.lead_pipeline_analysis AS current_state ON current_state.lead_id = lead.id
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
      AND now() >= lead.last_pipeline_activity_at + CASE
        WHEN COALESCE(agent.unanswered_followup_enabled, false) THEN interval '4 hours'
        ELSE interval '2 hours'
      END
      AND (lead."check" IS NULL OR lead.last_pipeline_activity_at > lead."check")
      AND (current_state.claimed_until IS NULL OR current_state.claimed_until < now())
      AND (current_state.retry_at IS NULL OR current_state.retry_at <= now())
  ),
  candidates AS (
    SELECT eligible.*, gen_random_uuid() AS next_claim_token
    FROM eligible
    JOIN crm.leads AS locked_lead ON locked_lead.id = eligible.lead_id
    WHERE eligible.account_rank <= GREATEST(1, LEAST(COALESCE(p_per_account_limit, 2), 100))
    ORDER BY eligible.last_pipeline_activity_at, eligible.lead_id
    FOR UPDATE OF locked_lead SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
  ),
  claimed AS (
    INSERT INTO crm.lead_pipeline_analysis (
      lead_id, aces_id, pipeline_id, claim_token, claimed_until, attempt_count, updated_at
    )
    SELECT
      candidate.lead_id, candidate.aces_id, candidate.pipeline_id, candidate.next_claim_token,
      now() + make_interval(secs => GREATEST(30, LEAST(COALESCE(p_lease_seconds, 300), 1800))),
      1, now()
    FROM candidates AS candidate
    ON CONFLICT ON CONSTRAINT lead_pipeline_analysis_pkey DO UPDATE SET
      aces_id = EXCLUDED.aces_id,
      pipeline_id = EXCLUDED.pipeline_id,
      claim_token = EXCLUDED.claim_token,
      claimed_until = EXCLUDED.claimed_until,
      attempt_count = crm.lead_pipeline_analysis.attempt_count + 1,
      last_error = NULL,
      updated_at = now()
    RETURNING crm.lead_pipeline_analysis.lead_id,
      crm.lead_pipeline_analysis.summary,
      crm.lead_pipeline_analysis.last_confidence,
      crm.lead_pipeline_analysis.claim_token
  )
  SELECT
    candidate.lead_id, candidate.aces_id, candidate.pipeline_id, candidate.stage_id,
    candidate.lead_name, candidate.instance_name, candidate.check_at, candidate.cutoff_at,
    candidate.last_pipeline_activity_at, claimed.summary, claimed.last_confidence,
    candidate.followup_enabled, claimed.claim_token, candidate.origin_stage_id,
    candidate.origin_stage_name, candidate.attendance_cycle_started_at
  FROM candidates AS candidate
  JOIN claimed ON claimed.lead_id = candidate.lead_id;
END;
$function$;

REVOKE ALL ON FUNCTION crm.service_claim_pipeline_analyses(integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.service_claim_pipeline_analyses(integer, integer, integer) TO service_role;

-- Replace completion with an observed activity watermark. A newer inbound or a
-- human stage move makes the result stale and leaves it for the next cycle.
DROP FUNCTION IF EXISTS crm.service_complete_pipeline_analysis(
  uuid, uuid, timestamptz, uuid, uuid, boolean, text, numeric, text, text, integer, integer, jsonb
);

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
  p_decision jsonb DEFAULT '{}'::jsonb,
  p_observed_pipeline_activity_at timestamptz DEFAULT NULL
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
  v_is_stale boolean := false;
BEGIN
  SELECT * INTO v_state FROM crm.lead_pipeline_analysis
  WHERE lead_id = p_lead_id AND claim_token = p_claim_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Claim de classificacao invalido ou expirado'; END IF;

  SELECT * INTO v_lead FROM crm.leads
  WHERE id = p_lead_id AND aces_id = v_state.aces_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead nao encontrado para concluir classificacao'; END IF;

  SELECT * INTO v_pipeline FROM crm.pipelines
  WHERE id = v_state.pipeline_id AND aces_id = v_state.aces_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pipeline nao encontrado para concluir classificacao'; END IF;

  v_mode := CASE WHEN v_lead."check" IS NULL THEN 'full' ELSE 'incremental' END;
  v_is_stale := v_lead.stage_id IS DISTINCT FROM p_observed_stage_id
    OR (p_observed_pipeline_activity_at IS NOT NULL
      AND v_lead.last_pipeline_activity_at > p_observed_pipeline_activity_at);

  IF p_suggested_stage_id IS NOT NULL THEN
    PERFORM 1 FROM crm.pipeline_stages
    WHERE id = p_suggested_stage_id
      AND aces_id = v_state.aces_id
      AND pipeline_id = v_state.pipeline_id
      AND classifier_is_destination = true;
    IF NOT FOUND THEN
      v_skip_reason := 'suggested_stage_outside_pipeline';
      p_suggested_stage_id := NULL;
    END IF;
  END IF;

  IF v_is_stale THEN
    v_skip_reason := CASE
      WHEN v_lead.stage_id IS DISTINCT FROM p_observed_stage_id THEN 'stage_changed_during_run'
      ELSE 'activity_changed_during_run'
    END;
  ELSIF p_should_apply_stage AND p_suggested_stage_id IS NOT NULL
    AND COALESCE(p_confidence, 0) >= v_pipeline.classification_auto_apply_threshold THEN
    IF v_lead.stage_id = p_suggested_stage_id THEN
      v_applied_stage_id := v_lead.stage_id;
      v_skip_reason := 'already_in_stage';
    ELSE
      PERFORM crm.service_move_lead_to_stage(p_lead_id, p_suggested_stage_id, v_state.aces_id);
      UPDATE crm.leads SET pre_attendance_stage_id = NULL, attendance_cycle_started_at = NULL
      WHERE id = p_lead_id AND aces_id = v_state.aces_id;
      v_applied_stage_id := p_suggested_stage_id;
      v_status := 'succeeded';
    END IF;
  ELSIF p_should_apply_stage AND COALESCE(p_confidence, 0) < v_pipeline.classification_auto_apply_threshold THEN
    v_skip_reason := 'below_threshold';
  ELSE
    v_skip_reason := 'stage_not_requested';
  END IF;

  INSERT INTO crm.pipeline_analysis_runs (
    idempotency_key, aces_id, lead_id, pipeline_id, mode, cutoff_at,
    observed_stage_id, suggested_stage_id, applied_stage_id, confidence,
    summary, reason, model_name, tokens_input, tokens_output, status, decision
  ) VALUES (
    'pipeline_classifier:' || p_lead_id::text || ':' || p_cutoff_at::text,
    v_state.aces_id, p_lead_id, v_state.pipeline_id, v_mode, p_cutoff_at,
    p_observed_stage_id, p_suggested_stage_id, v_applied_stage_id, p_confidence,
    COALESCE(p_summary, ''), COALESCE(p_reason, ''), p_model_name,
    p_tokens_input, p_tokens_output, v_status,
    COALESCE(p_decision, '{}'::jsonb) || jsonb_build_object('skip_reason', v_skip_reason)
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
  RETURNING id INTO v_run_id;

  UPDATE crm.lead_pipeline_analysis SET
    pipeline_id = v_state.pipeline_id,
    summary = CASE WHEN v_is_stale THEN summary ELSE COALESCE(p_summary, '') END,
    last_stage_id = COALESCE(v_applied_stage_id, v_lead.stage_id),
    last_confidence = CASE WHEN v_is_stale THEN last_confidence ELSE p_confidence END,
    last_check_at = CASE WHEN v_is_stale THEN last_check_at ELSE p_cutoff_at END,
    last_run_id = v_run_id,
    claim_token = NULL,
    claimed_until = NULL,
    retry_at = NULL,
    last_error = NULL,
    updated_at = now()
  WHERE lead_id = p_lead_id AND claim_token = p_claim_token;

  IF NOT v_is_stale THEN
    UPDATE crm.leads SET "check" = p_cutoff_at
    WHERE id = p_lead_id AND aces_id = v_state.aces_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'run_id', v_run_id, 'mode', v_mode,
    'applied_stage_id', v_applied_stage_id, 'skip_reason', v_skip_reason,
    'check_at', CASE WHEN v_is_stale THEN v_lead."check" ELSE p_cutoff_at END
  );
END;
$function$;

REVOKE ALL ON FUNCTION crm.service_complete_pipeline_analysis(
  uuid, uuid, timestamptz, uuid, uuid, boolean, text, numeric, text, text,
  integer, integer, jsonb, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.service_complete_pipeline_analysis(
  uuid, uuid, timestamptz, uuid, uuid, boolean, text, numeric, text, text,
  integer, integer, jsonb, timestamptz
) TO service_role;

REVOKE ALL ON FUNCTION crm.enforce_pipeline_attendance_stage() FROM PUBLIC, anon, authenticated;
