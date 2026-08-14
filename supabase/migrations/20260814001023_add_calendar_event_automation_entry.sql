-- Adiciona o calendario como origem de entrada do motor de Automacao/Funis.
--
-- Ate aqui o calendario so sabia disparar o lembrete "1h antes" (followup_1h_*),
-- um pipeline sob medida. Esta migration ensina o motor generico de jornadas a
-- reagir a mudancas de status de um evento (done, cancelled, no_show, ...),
-- reaproveitando todo o restante do fluxo (steps, midia, templates, worker).
--
-- Tudo aqui e aditivo: funis com entry_source 'conditions' e 'rb' mantem
-- exatamente o comportamento atual.

-- ---------------------------------------------------------------------------
-- 1. calendar.events: quando o status mudou pela ultima vez.
-- ---------------------------------------------------------------------------

ALTER TABLE calendar.events
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION calendar.trg_set_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, now());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_events_status_changed_at ON calendar.events;
CREATE TRIGGER trg_calendar_events_status_changed_at
  BEFORE INSERT OR UPDATE OF status ON calendar.events
  FOR EACH ROW
  EXECUTE FUNCTION calendar.trg_set_status_changed_at();

-- ---------------------------------------------------------------------------
-- 2. crm.automation_funnels: nova origem e nova ancora de tempo.
-- ---------------------------------------------------------------------------

ALTER TABLE crm.automation_funnels
  ADD COLUMN IF NOT EXISTS trigger_event_status text;

ALTER TABLE crm.automation_funnels
  ALTER COLUMN trigger_stage_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_entry_source_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels DROP CONSTRAINT automation_funnels_entry_source_check;
  END IF;

  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_entry_source_check
    CHECK (entry_source IN ('conditions', 'rb', 'calendar_event'));

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_anchor_event_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels DROP CONSTRAINT automation_funnels_anchor_event_check;
  END IF;

  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_anchor_event_check
    CHECK (anchor_event IN (
      'stage_entered_at',
      'last_outbound',
      'last_inbound',
      'event_start_time',
      'event_end_time',
      'event_status_changed_at'
    ));

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_trigger_event_status_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels DROP CONSTRAINT automation_funnels_trigger_event_status_check;
  END IF;

  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_trigger_event_status_check
    CHECK (
      trigger_event_status IS NULL
      OR trigger_event_status IN ('scheduled', 'confirmed', 'cancelled', 'done', 'no_show')
    );

  -- Cada origem exige o seu proprio gatilho: estagio do funil para 'conditions',
  -- status do evento para 'calendar_event'.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_funnels_entry_shape_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels DROP CONSTRAINT automation_funnels_entry_shape_check;
  END IF;

  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_entry_shape_check
    CHECK (
      (entry_source = 'calendar_event' AND trigger_event_status IS NOT NULL)
      OR (entry_source <> 'calendar_event' AND trigger_stage_id IS NOT NULL)
    );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_automation_funnels_calendar_entry
  ON crm.automation_funnels(aces_id, instance_name, trigger_event_status)
  WHERE entry_source = 'calendar_event' AND is_active IS TRUE;

-- ---------------------------------------------------------------------------
-- 3. crm.automation_enrollments: rastreia o evento que originou a inscricao.
-- ---------------------------------------------------------------------------

ALTER TABLE crm.automation_enrollments
  ADD COLUMN IF NOT EXISTS source_calendar_event_id uuid
    REFERENCES calendar.events(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'automation_enrollments_anchor_event_check'
      AND conrelid = 'crm.automation_enrollments'::regclass
  ) THEN
    ALTER TABLE crm.automation_enrollments DROP CONSTRAINT automation_enrollments_anchor_event_check;
  END IF;

  ALTER TABLE crm.automation_enrollments
    ADD CONSTRAINT automation_enrollments_anchor_event_check
    CHECK (anchor_event IN (
      'stage_entered_at',
      'last_outbound',
      'last_inbound',
      'event_start_time',
      'event_end_time',
      'event_status_changed_at'
    ));
END;
$$;

CREATE INDEX IF NOT EXISTS idx_automation_enrollments_calendar_event
  ON crm.automation_enrollments(funnel_id, source_calendar_event_id)
  WHERE source_calendar_event_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Progresso e fila passam a ser por inscricao quando a origem e o calendario.
--
--    O motor atual e "uma vez por lead por funil" (unique em funnel+lead+step),
--    o que esta correto para jornadas de estagio. Para o calendario isso quebra
--    o caso principal: o mesmo paciente tem varias consultas ao longo do tempo e
--    precisa receber a mensagem de pos-consulta depois de cada uma. Para funis de
--    calendario o escopo passa a ser a inscricao (ou seja, o evento).
-- ---------------------------------------------------------------------------

ALTER TABLE crm.automation_step_progress
  ADD COLUMN IF NOT EXISTS enrollment_id uuid
    REFERENCES crm.automation_enrollments(id) ON DELETE CASCADE;

-- automation_step_progress_unique nasceu como UNIQUE CONSTRAINT; para virar
-- parcial precisa deixar de ser constraint e passar a ser indice.
ALTER TABLE crm.automation_step_progress
  DROP CONSTRAINT IF EXISTS automation_step_progress_unique;
DROP INDEX IF EXISTS crm.automation_step_progress_unique;
CREATE UNIQUE INDEX IF NOT EXISTS automation_step_progress_unique
  ON crm.automation_step_progress(funnel_id, lead_id, step_id)
  WHERE enrollment_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS automation_step_progress_enrollment_unique
  ON crm.automation_step_progress(enrollment_id, step_id)
  WHERE enrollment_id IS NOT NULL;

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS source_calendar_event_id uuid
    REFERENCES calendar.events(id) ON DELETE SET NULL;

-- A unicidade de execucao pendente por funil+lead+step impediria dois eventos do
-- mesmo lead de agendarem o mesmo step. Para execucoes vindas do calendario a
-- protecao equivalente ja existe em idx_automation_execution_pending_enrollment_step.
DROP INDEX IF EXISTS crm.idx_automation_execution_pending_funnel_lead_step;
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_execution_pending_funnel_lead_step
  ON crm.automation_executions(funnel_id, lead_id, step_id)
  WHERE status IN ('pending', 'processing')
    AND funnel_id IS NOT NULL
    AND lead_id IS NOT NULL
    AND step_id IS NOT NULL
    AND source_calendar_event_id IS NULL;

-- ---------------------------------------------------------------------------
-- 5. Contexto de automacao a partir de um evento do calendario.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.get_automation_context_for_calendar_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event calendar.events%ROWTYPE;
  v_context jsonb;
BEGIN
  SELECT * INTO v_event
  FROM calendar.events
  WHERE id = p_event_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_event.lead_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_context := crm.get_automation_context(v_event.lead_id);

  IF v_context IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN v_context || jsonb_build_object(
    'calendar', jsonb_build_object(
      'event_id', v_event.id,
      'status', v_event.status,
      'title', v_event.title,
      'all_day', v_event.all_day,
      'location', v_event.location,
      'start_time', v_event.start_time,
      'end_time', v_event.end_time,
      'status_changed_at', v_event.status_changed_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION crm.get_automation_context_for_calendar_event(uuid)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.get_automation_context_for_calendar_event(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Ancoras de tempo baseadas no evento.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.get_anchor_details_from_context(p_context jsonb, p_anchor_event text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_state jsonb := COALESCE(p_context->'state', '{}'::jsonb);
  v_calendar jsonb := COALESCE(p_context->'calendar', '{}'::jsonb);
BEGIN
  IF p_anchor_event = 'last_outbound' THEN
    RETURN jsonb_build_object(
      'anchor_at', v_state->>'last_outbound_at',
      'anchor_message_id', v_state->>'last_outbound_message_id'
    );
  END IF;

  IF p_anchor_event = 'last_inbound' THEN
    RETURN jsonb_build_object(
      'anchor_at', v_state->>'last_inbound_at',
      'anchor_message_id', v_state->>'last_inbound_message_id'
    );
  END IF;

  IF p_anchor_event = 'event_start_time' THEN
    RETURN jsonb_build_object(
      'anchor_at', v_calendar->>'start_time',
      'anchor_message_id', NULL
    );
  END IF;

  IF p_anchor_event = 'event_end_time' THEN
    RETURN jsonb_build_object(
      'anchor_at', v_calendar->>'end_time',
      'anchor_message_id', NULL
    );
  END IF;

  IF p_anchor_event = 'event_status_changed_at' THEN
    RETURN jsonb_build_object(
      'anchor_at', v_calendar->>'status_changed_at',
      'anchor_message_id', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'anchor_at', v_state->>'stage_entered_at',
    'anchor_message_id', NULL
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Inscricao: aceita contexto de calendario.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.start_or_refresh_enrollment(
  p_funnel_id uuid,
  p_lead_id uuid,
  p_context jsonb DEFAULT NULL::jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_context jsonb := COALESCE(p_context, crm.get_automation_context(p_lead_id));
  v_anchor jsonb;
  v_anchor_at timestamptz;
  v_anchor_message_id uuid;
  v_entry_result jsonb;
  v_existing crm.automation_enrollments%ROWTYPE;
  v_same_enrollment_id uuid;
  v_restarted_count integer := 0;
  v_calendar_event_id uuid;
  v_is_calendar boolean := FALSE;
  v_entry_rule_is_empty boolean := FALSE;
  v_new_enrollment_id uuid;
BEGIN
  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND OR v_context IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE((v_context->>'view')::boolean, TRUE) = FALSE THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_context->>'contact_phone', '') = '' THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  v_is_calendar := v_funnel.entry_source = 'calendar_event';
  v_calendar_event_id := NULLIF(v_context->'calendar'->>'event_id', '')::uuid;

  IF v_is_calendar AND v_calendar_event_id IS NULL THEN
    RETURN 0;
  END IF;

  v_anchor := crm.get_anchor_details_from_context(v_context, v_funnel.anchor_event);
  v_anchor_at := NULLIF(v_anchor->>'anchor_at', '')::timestamptz;
  v_anchor_message_id := NULLIF(v_anchor->>'anchor_message_id', '')::uuid;

  IF v_anchor_at IS NULL THEN
    RETURN 0;
  END IF;

  -- Numa jornada de calendario o gatilho e o proprio status do evento, entao uma
  -- regra de entrada vazia significa "sem filtro adicional" e nao "nunca entra".
  v_entry_rule_is_empty :=
    v_funnel.entry_rule IS NULL
    OR jsonb_array_length(COALESCE(v_funnel.entry_rule->'children', '[]'::jsonb)) = 0;

  IF NOT (v_is_calendar AND v_entry_rule_is_empty) THEN
    v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_anchor_at);
    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      RETURN 0;
    END IF;
  END IF;

  -- Um evento gera no maximo uma inscricao por jornada, independente de quantas
  -- vezes o status for reaplicado.
  IF v_is_calendar THEN
    IF EXISTS (
      SELECT 1
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND source_calendar_event_id = v_calendar_event_id
        AND status IN ('active', 'completed')
    ) THEN
      RETURN 0;
    END IF;
  ELSE
    SELECT id
    INTO v_same_enrollment_id
    FROM crm.automation_enrollments
    WHERE funnel_id = v_funnel.id
      AND lead_id = p_lead_id
      AND status = 'active'
      AND anchor_event = v_funnel.anchor_event
      AND anchor_at = v_anchor_at
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_same_enrollment_id IS NOT NULL THEN
      RETURN 0;
    END IF;

    SELECT *
    INTO v_existing
    FROM crm.automation_enrollments
    WHERE funnel_id = v_funnel.id
      AND lead_id = p_lead_id
      AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      IF v_funnel.reentry_mode = 'ignore_if_active' THEN
        RETURN 0;
      END IF;

      IF v_funnel.reentry_mode = 'restart_on_match' THEN
        v_restarted_count := COALESCE(v_existing.restarted_count, 0) + 1;
        PERFORM crm.stop_automation_enrollment(v_existing.id, 'cancelled', 'Reentrada por novo evento ancora', FALSE);
      END IF;
    END IF;
  END IF;

  INSERT INTO crm.automation_enrollments (
    aces_id,
    funnel_id,
    lead_id,
    status,
    anchor_event,
    anchor_at,
    anchor_message_id,
    current_stage_id,
    reply_target_stage_id,
    restarted_count,
    last_evaluated_at,
    source_calendar_event_id
  )
  VALUES (
    v_funnel.aces_id,
    v_funnel.id,
    p_lead_id,
    'active',
    v_funnel.anchor_event,
    v_anchor_at,
    v_anchor_message_id,
    NULLIF(v_context->>'stage_id', '')::uuid,
    v_funnel.reply_target_stage_id,
    v_restarted_count,
    now(),
    CASE WHEN v_is_calendar THEN v_calendar_event_id ELSE NULL END
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_enrollment_id;

  IF v_new_enrollment_id IS NULL THEN
    RETURN 0;
  END IF;

  RETURN crm.schedule_enrollment_executions(v_new_enrollment_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Proximo step: escopo por inscricao nas jornadas de calendario.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.find_next_enrollment_step(p_enrollment_id uuid)
RETURNS TABLE(
  step_id uuid,
  is_active boolean,
  step_position integer,
  delay_minutes integer,
  message_template text,
  step_rule jsonb,
  label text,
  created_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_is_calendar boolean := FALSE;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COALESCE(f.entry_source = 'calendar_event', FALSE)
  INTO v_is_calendar
  FROM crm.automation_funnels f
  WHERE f.id = v_enrollment.funnel_id
  LIMIT 1;

  v_is_calendar := COALESCE(v_is_calendar, FALSE);

  RETURN QUERY
  SELECT
    s.id,
    s.is_active,
    s.position AS step_position,
    s.delay_minutes,
    s.message_template,
    s.step_rule,
    s.label,
    s.created_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND NOT EXISTS (
      SELECT 1
      FROM crm.automation_step_progress asp
      WHERE asp.step_id = s.id
        AND (
          (v_is_calendar AND asp.enrollment_id = v_enrollment.id)
          OR (
            NOT v_is_calendar
            AND asp.enrollment_id IS NULL
            AND asp.funnel_id = v_enrollment.funnel_id
            AND asp.lead_id = v_enrollment.lead_id
          )
        )
    )
  ORDER BY s.position ASC, s.created_at ASC
  LIMIT 1;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Agendamento: propaga o evento de origem para a execucao.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.schedule_enrollment_executions(p_enrollment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer := 0;
  v_next record;
  v_scheduled_at timestamptz;
BEGIN
  SELECT * INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND OR v_enrollment.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id
    AND aces_id = v_enrollment.aces_id
    AND is_active IS TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads
  WHERE id = v_enrollment.lead_id
    AND aces_id = v_enrollment.aces_id
  LIMIT 1;

  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) IS FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '') THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.automation_executions AS ae
    WHERE ae.enrollment_id = v_enrollment.id
      AND ae.status IN ('pending', 'processing')
  ) THEN
    RETURN 0;
  END IF;

  SELECT * INTO v_next
  FROM crm.find_next_enrollment_step(v_enrollment.id)
  LIMIT 1;

  IF NOT FOUND OR v_next.step_id IS NULL OR COALESCE(v_next.is_active, TRUE) IS FALSE THEN
    RETURN 0;
  END IF;

  v_scheduled_at := v_enrollment.anchor_at + make_interval(mins => v_next.delay_minutes);

  IF COALESCE(v_funnel.daily_dispatch_enabled, FALSE) IS TRUE
     AND v_funnel.daily_dispatch_time IS NOT NULL THEN
    v_scheduled_at := crm.resolve_daily_automation_dispatch_at(
      v_scheduled_at,
      v_funnel.daily_dispatch_time,
      'America/Sao_Paulo',
      COALESCE(v_funnel.daily_dispatch_weekends_enabled, FALSE)
    );

    IF v_scheduled_at IS NULL THEN
      RETURN 0;
    END IF;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id,
    funnel_id,
    step_id,
    enrollment_id,
    lead_id,
    source_stage_id,
    source_calendar_event_id,
    scheduled_at,
    phone_snapshot,
    instance_snapshot,
    lead_name_snapshot,
    city_snapshot,
    status_snapshot,
    funnel_name_snapshot,
    step_label_snapshot,
    step_rule_snapshot,
    anchor_at_snapshot
  )
  VALUES (
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    v_next.step_id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.source_calendar_event_id,
    v_scheduled_at,
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    v_next.label,
    v_next.step_rule,
    v_enrollment.anchor_at
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10. Conclusao: grava o progresso no escopo certo.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_sent_at timestamptz := now();
  v_scheduled integer := 0;
  v_is_calendar boolean := FALSE;
BEGIN
  SELECT *
  INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id
    AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para conclusao';
  END IF;

  UPDATE crm.automation_executions
  SET
    status = 'sent',
    sent_at = v_sent_at,
    rendered_message = COALESCE(p_rendered_message, rendered_message),
    completed_reason = 'sent',
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_execution.id;

  v_is_calendar := v_execution.source_calendar_event_id IS NOT NULL
    AND v_execution.enrollment_id IS NOT NULL;

  IF v_execution.funnel_id IS NOT NULL
    AND v_execution.step_id IS NOT NULL THEN
    IF v_is_calendar THEN
      INSERT INTO crm.automation_step_progress (
        aces_id,
        funnel_id,
        lead_id,
        step_id,
        enrollment_id,
        sent_execution_id,
        first_sent_at
      )
      VALUES (
        v_execution.aces_id,
        v_execution.funnel_id,
        v_execution.lead_id,
        v_execution.step_id,
        v_execution.enrollment_id,
        v_execution.id,
        v_sent_at
      )
      ON CONFLICT (enrollment_id, step_id) WHERE enrollment_id IS NOT NULL DO UPDATE
      SET
        first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
        sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
        updated_at = now();
    ELSE
      INSERT INTO crm.automation_step_progress (
        aces_id,
        funnel_id,
        lead_id,
        step_id,
        sent_execution_id,
        first_sent_at
      )
      VALUES (
        v_execution.aces_id,
        v_execution.funnel_id,
        v_execution.lead_id,
        v_execution.step_id,
        v_execution.id,
        v_sent_at
      )
      ON CONFLICT (funnel_id, lead_id, step_id) WHERE enrollment_id IS NULL DO UPDATE
      SET
        first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
        sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
        updated_at = now();
    END IF;
  END IF;

  IF v_execution.funnel_id IS NOT NULL
    AND COALESCE(v_execution.instance_snapshot, '') <> '' THEN
    PERFORM crm.recalculate_automation_funnel_dispatch_state(
      v_execution.aces_id,
      v_execution.funnel_id,
      v_execution.instance_snapshot
    );
  END IF;

  IF v_execution.enrollment_id IS NOT NULL THEN
    v_scheduled := crm.schedule_enrollment_executions(v_execution.enrollment_id);

    UPDATE crm.automation_enrollments
    SET
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_execution.enrollment_id
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object(
    'success', TRUE,
    'scheduled', v_scheduled
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 11. Entrada disparada pela mudanca de status do evento.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.handle_calendar_event_status_entry(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_event calendar.events%ROWTYPE;
  v_context jsonb;
  v_funnel_id uuid;
  v_total integer := 0;
  v_aces_id integer;
  v_instance_name text;
BEGIN
  SELECT * INTO v_event
  FROM calendar.events
  WHERE id = p_event_id
    AND deleted_at IS NULL
  LIMIT 1;

  IF NOT FOUND OR v_event.lead_id IS NULL THEN
    RETURN 0;
  END IF;

  -- Guarda contra backfill: marcar hoje um evento antigo (arrumacao de historico)
  -- produziria um disparo com horario ja vencido, que sairia imediatamente.
  IF v_event.start_time < now() - interval '7 days' THEN
    RETURN 0;
  END IF;

  v_context := crm.get_automation_context_for_calendar_event(p_event_id);

  IF v_context IS NULL THEN
    RETURN 0;
  END IF;

  v_aces_id := NULLIF(v_context->>'aces_id', '')::integer;
  v_instance_name := NULLIF(v_context->>'instance_name', '');

  IF v_aces_id IS NULL OR v_instance_name IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_funnel_id IN
    SELECT f.id
    FROM crm.automation_funnels AS f
    WHERE f.aces_id = v_aces_id
      AND f.instance_name = v_instance_name
      AND f.is_active IS TRUE
      AND f.entry_source = 'calendar_event'
      AND f.trigger_event_status = v_event.status
  LOOP
    v_total := v_total + crm.start_or_refresh_enrollment(v_funnel_id, v_event.lead_id, v_context);
  END LOOP;

  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION crm.handle_calendar_event_status_entry(uuid)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.handle_calendar_event_status_entry(uuid) TO service_role;

CREATE OR REPLACE FUNCTION calendar.trg_handle_event_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.deleted_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  PERFORM crm.handle_calendar_event_status_entry(NEW.id);

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_events_status_automation ON calendar.events;
CREATE TRIGGER trg_calendar_events_status_automation
  AFTER INSERT OR UPDATE OF status ON calendar.events
  FOR EACH ROW
  EXECUTE FUNCTION calendar.trg_handle_event_automation();

-- ---------------------------------------------------------------------------
-- 12. Sincronizacao manual da jornada: varre eventos em vez de leads.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.rpc_sync_automation_funnel_v2(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_cancelled integer := 0;
  v_scheduled integer := 0;
  v_lead_id uuid;
  v_event_id uuid;
  v_event_lead_id uuid;
  v_event_context jsonb;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas ADMIN pode sincronizar automacoes';
  END IF;

  SELECT * INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  IF COALESCE(v_funnel.is_active, TRUE) IS FALSE THEN
    v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

    FOR v_enrollment IN
      SELECT *
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND status = 'active'
    LOOP
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id,
        'cancelled',
        'Automacao desativada',
        FALSE
      );
    END LOOP;

    RETURN jsonb_build_object('success', TRUE, 'cancelled', v_cancelled, 'scheduled', 0);
  END IF;

  FOR v_enrollment IN
    SELECT e.*
    FROM crm.automation_enrollments AS e
    JOIN crm.leads AS l ON l.id = e.lead_id
    WHERE e.funnel_id = v_funnel.id
      AND e.status = 'active'
      AND l.aces_id = v_funnel.aces_id
      AND COALESCE(l.instancia, '') = COALESCE(v_funnel.instance_name, '')
  LOOP
    IF v_funnel.entry_source = 'calendar_event' THEN
      v_context := crm.get_automation_context_for_calendar_event(v_enrollment.source_calendar_event_id);
    ELSE
      v_context := crm.get_automation_context(v_enrollment.lead_id);
    END IF;

    IF v_context IS NULL THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead nao encontrado na sincronizacao', FALSE
      );
      CONTINUE;
    END IF;

    IF COALESCE(v_context->>'instance_name', '') <> COALESCE(v_funnel.instance_name, '') THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'cancelled', 'Lead saiu da instancia da jornada', FALSE
      );
      CONTINUE;
    END IF;

    -- Jornadas de calendario nao reavaliam a regra de entrada: o gatilho foi um
    -- evento pontual que ja aconteceu, nao um estado atual do lead.
    IF v_funnel.entry_source <> 'calendar_event' THEN
      v_entry_result := crm.evaluate_automation_rule_node(
        v_funnel.entry_rule, v_context, v_enrollment.anchor_at
      );

      IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) IS FALSE THEN
        v_cancelled := v_cancelled + crm.stop_automation_enrollment(
          v_enrollment.id, 'cancelled', 'Regra de entrada nao bate mais', FALSE
        );
        CONTINUE;
      END IF;
    END IF;

    v_exit_result := crm.evaluate_automation_rule_node(
      v_funnel.exit_rule, v_context, v_enrollment.anchor_at
    );

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) IS TRUE THEN
      v_cancelled := v_cancelled + crm.stop_automation_enrollment(
        v_enrollment.id, 'completed', 'Regra de saida ja atendida', TRUE
      );
      CONTINUE;
    END IF;

    v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment.id);
  END LOOP;

  IF v_funnel.entry_source = 'calendar_event' THEN
    FOR v_event_id, v_event_lead_id IN
      SELECT e.id, e.lead_id
      FROM calendar.events AS e
      JOIN crm.leads AS l ON l.id = e.lead_id
      WHERE e.aces_id = v_funnel.aces_id
        AND e.deleted_at IS NULL
        AND e.status = v_funnel.trigger_event_status
        AND e.start_time >= now() - interval '7 days'
        AND COALESCE(l.instancia, '') = COALESCE(v_funnel.instance_name, '')
      ORDER BY e.start_time DESC
      LIMIT 500
    LOOP
      v_event_context := crm.get_automation_context_for_calendar_event(v_event_id);

      IF v_event_context IS NOT NULL THEN
        v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(
          v_funnel.id, v_event_lead_id, v_event_context
        );
      END IF;
    END LOOP;
  ELSE
    FOR v_lead_id IN
      SELECT l.id
      FROM crm.leads AS l
      WHERE l.aces_id = v_funnel.aces_id
        AND COALESCE(l.view, TRUE) IS TRUE
        AND COALESCE(l.instancia, '') = COALESCE(v_funnel.instance_name, '')
    LOOP
      v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(v_funnel.id, v_lead_id);
    END LOOP;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'cancelled', v_cancelled, 'scheduled', v_scheduled);
END;
$$;

REVOKE ALL ON FUNCTION crm.start_or_refresh_enrollment(uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.start_or_refresh_enrollment(uuid, uuid, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
