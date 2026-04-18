-- Motor logico de automacao v2 orientado por direcao de mensagem.

ALTER TABLE crm.automation_funnels
  ADD COLUMN IF NOT EXISTS entry_rule jsonb,
  ADD COLUMN IF NOT EXISTS exit_rule jsonb,
  ADD COLUMN IF NOT EXISTS anchor_event text,
  ADD COLUMN IF NOT EXISTS reentry_mode text,
  ADD COLUMN IF NOT EXISTS reply_target_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS builder_version integer NOT NULL DEFAULT 2;

ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS step_rule jsonb;

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS enrollment_id uuid,
  ADD COLUMN IF NOT EXISTS step_rule_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS anchor_at_snapshot timestamptz,
  ADD COLUMN IF NOT EXISTS completed_reason text,
  ADD COLUMN IF NOT EXISTS claimed_by text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'crm'
      AND table_name = 'automation_executions'
      AND constraint_name = 'automation_executions_enrollment_id_fkey'
  ) THEN
    ALTER TABLE crm.automation_executions
      ADD CONSTRAINT automation_executions_enrollment_id_fkey
      FOREIGN KEY (enrollment_id)
      REFERENCES crm.automation_enrollments(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END;
$$;

DROP INDEX IF EXISTS crm.idx_automation_pending_unique;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_funnels_anchor_event_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels
      ADD CONSTRAINT automation_funnels_anchor_event_check
      CHECK (anchor_event IN ('stage_entered_at', 'last_outbound', 'last_inbound'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_funnels_reentry_mode_check'
      AND conrelid = 'crm.automation_funnels'::regclass
  ) THEN
    ALTER TABLE crm.automation_funnels
      ADD CONSTRAINT automation_funnels_reentry_mode_check
      CHECK (reentry_mode IN ('restart_on_match', 'ignore_if_active', 'allow_parallel'));
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS crm.lead_stage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('entered', 'left')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.lead_automation_state (
  lead_id uuid PRIMARY KEY REFERENCES crm.leads(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  current_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  stage_entered_at timestamptz,
  last_direction text CHECK (last_direction IN ('inbound', 'outbound')),
  last_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  last_message_at timestamptz,
  last_outbound_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  last_inbound_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  last_reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.automation_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  funnel_id uuid NOT NULL REFERENCES crm.automation_funnels(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'failed')),
  anchor_event text NOT NULL CHECK (anchor_event IN ('stage_entered_at', 'last_outbound', 'last_inbound')),
  anchor_at timestamptz NOT NULL,
  anchor_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  current_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  reply_target_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  stopped_reason text,
  restarted_count integer NOT NULL DEFAULT 0 CHECK (restarted_count >= 0),
  last_evaluated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_enrollment_id_fkey;

ALTER TABLE crm.automation_executions
  ADD CONSTRAINT automation_executions_enrollment_id_fkey
  FOREIGN KEY (enrollment_id)
  REFERENCES crm.automation_enrollments(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_stage_events_lead_occurred_at
  ON crm.lead_stage_events(lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_stage_events_stage_event
  ON crm.lead_stage_events(stage_id, event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_automation_state_stage
  ON crm.lead_automation_state(current_stage_id, stage_entered_at);

CREATE INDEX IF NOT EXISTS idx_automation_enrollments_funnel_status
  ON crm.automation_enrollments(funnel_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_enrollments_lead_status
  ON crm.automation_enrollments(lead_id, status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_enrollments_active_anchor
  ON crm.automation_enrollments(funnel_id, lead_id, anchor_event, anchor_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_automation_executions_enrollment
  ON crm.automation_executions(enrollment_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_execution_pending_enrollment_step
  ON crm.automation_executions(enrollment_id, step_id)
  WHERE status IN ('pending', 'processing')
    AND enrollment_id IS NOT NULL
    AND step_id IS NOT NULL;

ALTER TABLE crm.lead_stage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_automation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.automation_enrollments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_stage_events_select ON crm.lead_stage_events;
CREATE POLICY lead_stage_events_select
ON crm.lead_stage_events
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS lead_automation_state_select ON crm.lead_automation_state;
CREATE POLICY lead_automation_state_select
ON crm.lead_automation_state
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS automation_enrollments_select ON crm.automation_enrollments;
CREATE POLICY automation_enrollments_select
ON crm.automation_enrollments
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT ON crm.lead_stage_events TO authenticated;
GRANT SELECT ON crm.lead_automation_state TO authenticated;
GRANT SELECT ON crm.automation_enrollments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_stage_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lead_automation_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_enrollments TO service_role;

CREATE OR REPLACE FUNCTION crm.resolve_automation_reply_target_stage(p_aces_id integer)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
  SELECT ps.id
  FROM crm.pipeline_stages ps
  WHERE ps.aces_id = p_aces_id
    AND lower(btrim(ps.name)) = 'atendimento'
  ORDER BY ps.position ASC, ps.created_at ASC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION crm.build_default_entry_rule(p_stage_id uuid)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'type', 'group',
    'operator', 'all',
    'children', jsonb_build_array(
      jsonb_build_object(
        'type', 'predicate',
        'predicate', 'stage_is',
        'value', CASE WHEN p_stage_id IS NULL THEN '' ELSE p_stage_id::text END
      ),
      jsonb_build_object(
        'type', 'predicate',
        'predicate', 'lead_visible_is_true',
        'value', true
      )
    )
  );
$function$;

CREATE OR REPLACE FUNCTION crm.build_default_exit_rule()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT jsonb_build_object(
    'type', 'group',
    'operator', 'any',
    'children', jsonb_build_array(
      jsonb_build_object(
        'type', 'predicate',
        'predicate', 'lead_replied',
        'value', true
      )
    )
  );
$function$;

UPDATE crm.automation_funnels f
SET
  entry_rule = COALESCE(f.entry_rule, crm.build_default_entry_rule(f.trigger_stage_id)),
  exit_rule = COALESCE(f.exit_rule, crm.build_default_exit_rule()),
  anchor_event = COALESCE(f.anchor_event, 'stage_entered_at'),
  reentry_mode = COALESCE(f.reentry_mode, 'restart_on_match'),
  reply_target_stage_id = COALESCE(f.reply_target_stage_id, crm.resolve_automation_reply_target_stage(f.aces_id)),
  builder_version = COALESCE(f.builder_version, 2),
  updated_at = now();

CREATE OR REPLACE FUNCTION crm.trg_prepare_automation_funnel_logic()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  NEW.entry_rule := COALESCE(NEW.entry_rule, crm.build_default_entry_rule(NEW.trigger_stage_id));
  NEW.exit_rule := COALESCE(NEW.exit_rule, crm.build_default_exit_rule());
  NEW.anchor_event := COALESCE(NEW.anchor_event, 'stage_entered_at');
  NEW.reentry_mode := COALESCE(NEW.reentry_mode, 'restart_on_match');
  NEW.builder_version := COALESCE(NEW.builder_version, 2);
  NEW.reply_target_stage_id := COALESCE(
    NEW.reply_target_stage_id,
    crm.resolve_automation_reply_target_stage(NEW.aces_id)
  );

  IF COALESCE(NEW.is_active, TRUE) = TRUE AND NEW.reply_target_stage_id IS NULL THEN
    RAISE EXCEPTION 'Nao foi encontrada uma etapa Atendimento para esta conta';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.upsert_lead_automation_state_from_lead(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_lead crm.leads%ROWTYPE;
  v_stage_entered_at timestamptz;
BEGIN
  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT lse.occurred_at
  INTO v_stage_entered_at
  FROM crm.lead_stage_events lse
  WHERE lse.lead_id = v_lead.id
    AND lse.stage_id IS NOT DISTINCT FROM v_lead.stage_id
    AND lse.event_type = 'entered'
  ORDER BY lse.occurred_at DESC
  LIMIT 1;

  INSERT INTO crm.lead_automation_state (
    lead_id,
    aces_id,
    current_stage_id,
    stage_entered_at,
    created_at,
    updated_at
  )
  VALUES (
    v_lead.id,
    v_lead.aces_id,
    v_lead.stage_id,
    COALESCE(v_stage_entered_at, v_lead.updated_at, v_lead.created_at, now()),
    now(),
    now()
  )
  ON CONFLICT (lead_id) DO UPDATE
  SET
    aces_id = EXCLUDED.aces_id,
    current_stage_id = EXCLUDED.current_stage_id,
    stage_entered_at = EXCLUDED.stage_entered_at,
    updated_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION crm.upsert_lead_automation_state_from_message(p_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_message crm.message_history%ROWTYPE;
  v_direction text;
BEGIN
  SELECT *
  INTO v_message
  FROM crm.message_history
  WHERE id = p_message_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_direction := CASE
    WHEN lower(COALESCE(v_message.direction, '')) IN ('outbound', 'out') THEN 'outbound'
    ELSE 'inbound'
  END;

  PERFORM crm.upsert_lead_automation_state_from_lead(v_message.lead_id);

  INSERT INTO crm.lead_automation_state (
    lead_id,
    aces_id,
    current_stage_id,
    stage_entered_at,
    last_direction,
    last_message_id,
    last_message_at,
    last_outbound_at,
    last_inbound_at,
    last_outbound_message_id,
    last_inbound_message_id,
    last_reply_at,
    created_at,
    updated_at
  )
  SELECT
    l.id,
    l.aces_id,
    l.stage_id,
    COALESCE(las.stage_entered_at, l.updated_at, l.created_at, now()),
    v_direction,
    v_message.id,
    COALESCE(v_message.sent_at, now()),
    CASE WHEN v_direction = 'outbound' THEN COALESCE(v_message.sent_at, now()) ELSE las.last_outbound_at END,
    CASE WHEN v_direction = 'inbound' THEN COALESCE(v_message.sent_at, now()) ELSE las.last_inbound_at END,
    CASE WHEN v_direction = 'outbound' THEN v_message.id ELSE las.last_outbound_message_id END,
    CASE WHEN v_direction = 'inbound' THEN v_message.id ELSE las.last_inbound_message_id END,
    CASE WHEN v_direction = 'inbound' THEN COALESCE(v_message.sent_at, now()) ELSE las.last_reply_at END,
    now(),
    now()
  FROM crm.leads l
  LEFT JOIN crm.lead_automation_state las
    ON las.lead_id = l.id
  WHERE l.id = v_message.lead_id
  ON CONFLICT (lead_id) DO UPDATE
  SET
    aces_id = EXCLUDED.aces_id,
    current_stage_id = EXCLUDED.current_stage_id,
    stage_entered_at = COALESCE(EXCLUDED.stage_entered_at, crm.lead_automation_state.stage_entered_at),
    last_direction = EXCLUDED.last_direction,
    last_message_id = EXCLUDED.last_message_id,
    last_message_at = EXCLUDED.last_message_at,
    last_outbound_at = COALESCE(EXCLUDED.last_outbound_at, crm.lead_automation_state.last_outbound_at),
    last_inbound_at = COALESCE(EXCLUDED.last_inbound_at, crm.lead_automation_state.last_inbound_at),
    last_outbound_message_id = COALESCE(EXCLUDED.last_outbound_message_id, crm.lead_automation_state.last_outbound_message_id),
    last_inbound_message_id = COALESCE(EXCLUDED.last_inbound_message_id, crm.lead_automation_state.last_inbound_message_id),
    last_reply_at = COALESCE(EXCLUDED.last_reply_at, crm.lead_automation_state.last_reply_at),
    updated_at = now();
END;
$function$;

INSERT INTO crm.lead_stage_events (
  aces_id,
  lead_id,
  stage_id,
  event_type,
  occurred_at,
  created_at
)
SELECT
  l.aces_id,
  l.id,
  l.stage_id,
  'entered',
  COALESCE(l.updated_at, l.created_at, now()),
  COALESCE(l.updated_at, l.created_at, now())
FROM crm.leads l
WHERE l.stage_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM crm.lead_stage_events existing
    WHERE existing.lead_id = l.id
      AND existing.stage_id IS NOT DISTINCT FROM l.stage_id
      AND existing.event_type = 'entered'
  );

INSERT INTO crm.lead_automation_state (
  lead_id,
  aces_id,
  current_stage_id,
  stage_entered_at,
  last_direction,
  last_message_id,
  last_message_at,
  last_outbound_at,
  last_inbound_at,
  last_outbound_message_id,
  last_inbound_message_id,
  last_reply_at,
  created_at,
  updated_at
)
SELECT
  l.id,
  l.aces_id,
  l.stage_id,
  COALESCE(latest_stage.occurred_at, l.updated_at, l.created_at, now()),
  latest_message.direction_normalized,
  latest_message.id,
  latest_message.sent_at,
  latest_outbound.sent_at,
  latest_inbound.sent_at,
  latest_outbound.id,
  latest_inbound.id,
  latest_inbound.sent_at,
  now(),
  now()
FROM crm.leads l
LEFT JOIN LATERAL (
  SELECT lse.occurred_at
  FROM crm.lead_stage_events lse
  WHERE lse.lead_id = l.id
    AND lse.stage_id IS NOT DISTINCT FROM l.stage_id
    AND lse.event_type = 'entered'
  ORDER BY lse.occurred_at DESC
  LIMIT 1
) latest_stage ON TRUE
LEFT JOIN LATERAL (
  SELECT
    mh.id,
    COALESCE(mh.sent_at, now()) AS sent_at,
    CASE
      WHEN lower(COALESCE(mh.direction, '')) IN ('outbound', 'out') THEN 'outbound'
      ELSE 'inbound'
    END AS direction_normalized
  FROM crm.message_history mh
  WHERE mh.lead_id = l.id
  ORDER BY mh.sent_at DESC NULLS LAST, mh.id DESC
  LIMIT 1
) latest_message ON TRUE
LEFT JOIN LATERAL (
  SELECT mh.id, COALESCE(mh.sent_at, now()) AS sent_at
  FROM crm.message_history mh
  WHERE mh.lead_id = l.id
    AND lower(COALESCE(mh.direction, '')) IN ('outbound', 'out')
  ORDER BY mh.sent_at DESC NULLS LAST, mh.id DESC
  LIMIT 1
) latest_outbound ON TRUE
LEFT JOIN LATERAL (
  SELECT mh.id, COALESCE(mh.sent_at, now()) AS sent_at
  FROM crm.message_history mh
  WHERE mh.lead_id = l.id
    AND lower(COALESCE(mh.direction, '')) NOT IN ('outbound', 'out')
  ORDER BY mh.sent_at DESC NULLS LAST, mh.id DESC
  LIMIT 1
) latest_inbound ON TRUE
ON CONFLICT (lead_id) DO UPDATE
SET
  aces_id = EXCLUDED.aces_id,
  current_stage_id = EXCLUDED.current_stage_id,
  stage_entered_at = EXCLUDED.stage_entered_at,
  last_direction = EXCLUDED.last_direction,
  last_message_id = EXCLUDED.last_message_id,
  last_message_at = EXCLUDED.last_message_at,
  last_outbound_at = EXCLUDED.last_outbound_at,
  last_inbound_at = EXCLUDED.last_inbound_at,
  last_outbound_message_id = EXCLUDED.last_outbound_message_id,
  last_inbound_message_id = EXCLUDED.last_inbound_message_id,
  last_reply_at = EXCLUDED.last_reply_at,
  updated_at = now();

CREATE OR REPLACE FUNCTION crm.get_automation_context(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
  SELECT jsonb_build_object(
    'lead_id', l.id,
    'aces_id', l.aces_id,
    'stage_id', l.stage_id,
    'status', l.status,
    'owner_id', l.owner_id,
    'instance_name', l.instancia,
    'view', COALESCE(l.view, TRUE),
    'contact_phone', l.contact_phone,
    'state', jsonb_build_object(
      'current_stage_id', las.current_stage_id,
      'stage_entered_at', las.stage_entered_at,
      'last_direction', las.last_direction,
      'last_message_id', las.last_message_id,
      'last_message_at', las.last_message_at,
      'last_outbound_at', las.last_outbound_at,
      'last_inbound_at', las.last_inbound_at,
      'last_outbound_message_id', las.last_outbound_message_id,
      'last_inbound_message_id', las.last_inbound_message_id,
      'last_reply_at', las.last_reply_at
    )
  )
  FROM crm.leads l
  LEFT JOIN crm.lead_automation_state las
    ON las.lead_id = l.id
  WHERE l.id = p_lead_id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION crm.get_anchor_details_from_context(p_context jsonb, p_anchor_event text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_state jsonb := COALESCE(p_context->'state', '{}'::jsonb);
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

  RETURN jsonb_build_object(
    'anchor_at', v_state->>'stage_entered_at',
    'anchor_message_id', NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.evaluate_automation_predicate(
  p_predicate jsonb,
  p_context jsonb,
  p_anchor_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_predicate text := COALESCE(p_predicate->>'predicate', '');
  v_lead_id uuid := NULLIF(p_context->>'lead_id', '')::uuid;
  v_stage_id uuid := NULLIF(p_context->>'stage_id', '')::uuid;
  v_owner_id uuid := NULLIF(p_context->>'owner_id', '')::uuid;
  v_status text := p_context->>'status';
  v_instance_name text := p_context->>'instance_name';
  v_view boolean := COALESCE((p_context->>'view')::boolean, TRUE);
  v_state jsonb := COALESCE(p_context->'state', '{}'::jsonb);
  v_last_direction text := v_state->>'last_direction';
  v_stage_entered_at timestamptz := NULLIF(v_state->>'stage_entered_at', '')::timestamptz;
  v_last_outbound_at timestamptz := NULLIF(v_state->>'last_outbound_at', '')::timestamptz;
  v_last_inbound_at timestamptz := NULLIF(v_state->>'last_inbound_at', '')::timestamptz;
  v_matched boolean := FALSE;
  v_label text := v_predicate;
  v_expected jsonb := COALESCE(p_predicate->'value', p_predicate->'values', to_jsonb(TRUE));
  v_actual jsonb := 'null'::jsonb;
BEGIN
  CASE v_predicate
    WHEN 'stage_is' THEN
      v_label := 'Etapa e exatamente';
      v_actual := to_jsonb(CASE WHEN v_stage_id IS NULL THEN NULL ELSE v_stage_id::text END);
      v_matched := COALESCE(p_predicate->>'value', '') <> ''
        AND v_stage_id IS NOT NULL
        AND v_stage_id::text = p_predicate->>'value';

    WHEN 'stage_in' THEN
      v_label := 'Etapa esta na lista';
      v_actual := to_jsonb(CASE WHEN v_stage_id IS NULL THEN NULL ELSE v_stage_id::text END);
      v_matched := EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(COALESCE(p_predicate->'values', '[]'::jsonb)) values_list(value)
        WHERE values_list.value = COALESCE(v_stage_id::text, '')
      );

    WHEN 'days_in_stage_gte' THEN
      v_label := 'Dias na etapa maior ou igual';
      v_actual := to_jsonb(
        CASE
          WHEN v_stage_entered_at IS NULL THEN NULL
          ELSE floor(EXTRACT(EPOCH FROM (now() - v_stage_entered_at)) / 86400.0)::integer
        END
      );
      v_matched := v_stage_entered_at IS NOT NULL
        AND floor(EXTRACT(EPOCH FROM (now() - v_stage_entered_at)) / 86400.0) >= COALESCE((p_predicate->>'value')::numeric, 0);

    WHEN 'last_message_direction_is' THEN
      v_label := 'Ultima mensagem foi';
      v_actual := to_jsonb(v_last_direction);
      v_matched := COALESCE(v_last_direction, '') = COALESCE(p_predicate->>'value', '');

    WHEN 'hours_since_last_outbound_gte' THEN
      v_label := 'Horas desde ultimo outbound';
      v_actual := to_jsonb(
        CASE
          WHEN v_last_outbound_at IS NULL THEN NULL
          ELSE round(EXTRACT(EPOCH FROM (now() - v_last_outbound_at)) / 3600.0, 2)
        END
      );
      v_matched := v_last_outbound_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (now() - v_last_outbound_at)) / 3600.0 >= COALESCE((p_predicate->>'value')::numeric, 0);

    WHEN 'hours_since_last_inbound_gte' THEN
      v_label := 'Horas desde ultimo inbound';
      v_actual := to_jsonb(
        CASE
          WHEN v_last_inbound_at IS NULL THEN NULL
          ELSE round(EXTRACT(EPOCH FROM (now() - v_last_inbound_at)) / 3600.0, 2)
        END
      );
      v_matched := v_last_inbound_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (now() - v_last_inbound_at)) / 3600.0 >= COALESCE((p_predicate->>'value')::numeric, 0);

    WHEN 'no_inbound_since_anchor' THEN
      v_label := 'Nao houve inbound desde a ancora';
      v_actual := to_jsonb(v_last_inbound_at);
      v_matched := p_anchor_at IS NOT NULL
        AND (v_last_inbound_at IS NULL OR v_last_inbound_at < p_anchor_at);

    WHEN 'lead_replied' THEN
      v_label := 'Lead respondeu';
      v_actual := to_jsonb(v_last_inbound_at);
      v_matched := v_last_inbound_at IS NOT NULL
        AND (p_anchor_at IS NULL OR v_last_inbound_at >= p_anchor_at);

    WHEN 'tag_has' THEN
      v_label := 'Lead possui tag';
      v_actual := to_jsonb(
        EXISTS (
          SELECT 1
          FROM crm.lead_tags lt
          WHERE lt.lead_id = v_lead_id
            AND (
              lt.tag_id::text = COALESCE(p_predicate->>'value', '')
              OR lower(COALESCE(lt.tag_name, '')) = lower(COALESCE(p_predicate->>'value', ''))
            )
        )
      );
      v_matched := (v_actual #>> '{}')::boolean;

    WHEN 'owner_is' THEN
      v_label := 'Responsavel e';
      v_actual := to_jsonb(CASE WHEN v_owner_id IS NULL THEN NULL ELSE v_owner_id::text END);
      v_matched := v_owner_id IS NOT NULL
        AND v_owner_id::text = COALESCE(p_predicate->>'value', '');

    WHEN 'instance_is' THEN
      v_label := 'Instancia e';
      v_actual := to_jsonb(v_instance_name);
      v_matched := COALESCE(v_instance_name, '') = COALESCE(p_predicate->>'value', '');

    WHEN 'status_is' THEN
      v_label := 'Status textual e';
      v_actual := to_jsonb(v_status);
      v_matched := lower(COALESCE(v_status, '')) = lower(COALESCE(p_predicate->>'value', ''));

    WHEN 'lead_visible_is_true' THEN
      v_label := 'Lead visivel';
      v_actual := to_jsonb(v_view);
      v_matched := v_view = TRUE;

    ELSE
      v_label := COALESCE(v_predicate, 'condicao');
      v_actual := 'null'::jsonb;
      v_matched := FALSE;
  END CASE;

  RETURN jsonb_build_object(
    'type', 'predicate',
    'predicate', v_predicate,
    'label', v_label,
    'matched', v_matched,
    'expected', v_expected,
    'actual', v_actual
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.evaluate_automation_rule_node(
  p_rule jsonb,
  p_context jsonb,
  p_anchor_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_rule_type text := COALESCE(p_rule->>'type', 'group');
  v_operator text := COALESCE(p_rule->>'operator', 'all');
  v_child jsonb;
  v_child_result jsonb;
  v_children jsonb := '[]'::jsonb;
  v_has_any boolean := FALSE;
  v_all_match boolean := TRUE;
  v_count integer := 0;
  v_matched boolean := FALSE;
BEGIN
  IF p_rule IS NULL THEN
    RETURN jsonb_build_object(
      'type', 'group',
      'label', 'Regra vazia',
      'operator', 'all',
      'matched', FALSE,
      'children', '[]'::jsonb
    );
  END IF;

  IF v_rule_type = 'predicate' THEN
    RETURN crm.evaluate_automation_predicate(p_rule, p_context, p_anchor_at);
  END IF;

  FOR v_child IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(p_rule->'children', '[]'::jsonb))
  LOOP
    v_child_result := crm.evaluate_automation_rule_node(v_child, p_context, p_anchor_at);
    v_children := v_children || jsonb_build_array(v_child_result);
    v_count := v_count + 1;

    IF COALESCE((v_child_result->>'matched')::boolean, FALSE) THEN
      v_has_any := TRUE;
    ELSE
      v_all_match := FALSE;
    END IF;
  END LOOP;

  IF v_count = 0 THEN
    v_matched := FALSE;
  ELSIF v_operator = 'any' THEN
    v_matched := v_has_any;
  ELSE
    v_matched := v_all_match;
  END IF;

  RETURN jsonb_build_object(
    'type', 'group',
    'label', CASE WHEN v_operator = 'any' THEN 'Qualquer condicao' ELSE 'Todas as condicoes' END,
    'operator', v_operator,
    'matched', v_matched,
    'children', v_children
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cancel_pending_executions_for_enrollment(
  p_enrollment_id uuid,
  p_reason text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE crm.automation_executions
  SET
    status = 'cancelled',
    cancelled_at = now(),
    completed_reason = COALESCE(completed_reason, p_reason),
    last_error = COALESCE(last_error, p_reason),
    updated_at = now()
  WHERE enrollment_id = p_enrollment_id
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.schedule_enrollment_executions(p_enrollment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND OR v_enrollment.status <> 'active' THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = v_enrollment.funnel_id
    AND is_active = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = v_enrollment.lead_id
    AND aces_id = v_enrollment.aces_id
  LIMIT 1;

  IF NOT FOUND OR COALESCE(v_lead.view, TRUE) = FALSE OR COALESCE(v_lead.contact_phone, '') = '' THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id,
    funnel_id,
    step_id,
    enrollment_id,
    lead_id,
    source_stage_id,
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
  SELECT
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    s.id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
    v_enrollment.anchor_at + make_interval(mins => s.delay_minutes),
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    s.label,
    s.step_rule,
    v_enrollment.anchor_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND s.is_active = TRUE
  ORDER BY s.position ASC, s.created_at ASC
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.stop_automation_enrollment(
  p_enrollment_id uuid,
  p_status text,
  p_reason text,
  p_move_lead boolean DEFAULT FALSE
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_target_stage crm.pipeline_stages%ROWTYPE;
  v_count integer := 0;
BEGIN
  SELECT *
  INTO v_enrollment
  FROM crm.automation_enrollments
  WHERE id = p_enrollment_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  v_count := crm.cancel_pending_executions_for_enrollment(v_enrollment.id, p_reason);

  UPDATE crm.automation_enrollments
  SET
    status = p_status,
    stopped_reason = p_reason,
    last_evaluated_at = now(),
    updated_at = now()
  WHERE id = v_enrollment.id
    AND status = 'active';

  IF p_move_lead = TRUE AND v_enrollment.reply_target_stage_id IS NOT NULL THEN
    SELECT *
    INTO v_target_stage
    FROM crm.pipeline_stages
    WHERE id = v_enrollment.reply_target_stage_id
      AND aces_id = v_enrollment.aces_id
    LIMIT 1;

    IF FOUND THEN
      UPDATE crm.leads
      SET
        stage_id = v_target_stage.id,
        status = CASE
          WHEN v_target_stage.category = 'Ganho' THEN 'Fechado'
          WHEN v_target_stage.category = 'Perdido' THEN 'Perdido'
          ELSE v_target_stage.name
        END,
        updated_at = now()
      WHERE id = v_enrollment.lead_id
        AND aces_id = v_enrollment.aces_id;
    END IF;
  END IF;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.start_or_refresh_enrollment(
  p_funnel_id uuid,
  p_lead_id uuid,
  p_context jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
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

  v_anchor := crm.get_anchor_details_from_context(v_context, v_funnel.anchor_event);
  v_anchor_at := NULLIF(v_anchor->>'anchor_at', '')::timestamptz;
  v_anchor_message_id := NULLIF(v_anchor->>'anchor_message_id', '')::uuid;

  IF v_anchor_at IS NULL THEN
    RETURN 0;
  END IF;

  v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_anchor_at);
  IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
    RETURN 0;
  END IF;

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
    last_evaluated_at
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
    now()
  );

  RETURN crm.schedule_enrollment_executions(
    (
      SELECT id
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND lead_id = p_lead_id
        AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.handle_entry_event(
  p_lead_id uuid,
  p_anchor_event text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_context jsonb;
  v_funnel_id uuid;
  v_total integer := 0;
  v_aces_id integer := NULLIF(crm.get_automation_context(p_lead_id)->>'aces_id', '')::integer;
BEGIN
  v_context := crm.get_automation_context(p_lead_id);

  IF v_context IS NULL OR v_aces_id IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_funnel_id IN
    SELECT id
    FROM crm.automation_funnels
    WHERE aces_id = v_aces_id
      AND is_active = TRUE
      AND anchor_event = p_anchor_event
  LOOP
    v_total := v_total + crm.start_or_refresh_enrollment(v_funnel_id, p_lead_id, v_context);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.revalidate_active_enrollments_for_lead(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_lead crm.leads%ROWTYPE;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_total integer := 0;
BEGIN
  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE lead_id = p_lead_id
      AND status = 'active'
  LOOP
    SELECT *
    INTO v_funnel
    FROM crm.automation_funnels
    WHERE id = v_enrollment.funnel_id
    LIMIT 1;

    IF NOT FOUND OR COALESCE(v_lead.view, TRUE) = FALSE THEN
      v_total := v_total + crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead oculto ou jornada removida', FALSE);
      CONTINUE;
    END IF;

    IF v_funnel.trigger_stage_id IS NOT NULL AND v_lead.stage_id IS DISTINCT FROM v_funnel.trigger_stage_id THEN
      v_total := v_total + crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead saiu da etapa da jornada', FALSE);
      CONTINUE;
    END IF;

    UPDATE crm.automation_enrollments
    SET
      current_stage_id = v_lead.stage_id,
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_enrollment.id;
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.handle_inbound_exit_for_lead(p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_context jsonb := crm.get_automation_context(p_lead_id);
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_exit_result jsonb;
  v_total integer := 0;
BEGIN
  IF v_context IS NULL THEN
    RETURN 0;
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE lead_id = p_lead_id
      AND status = 'active'
  LOOP
    SELECT *
    INTO v_funnel
    FROM crm.automation_funnels
    WHERE id = v_enrollment.funnel_id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);
    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) THEN
      v_total := v_total + crm.stop_automation_enrollment(
        v_enrollment.id,
        'completed',
        'Lead respondeu inbound',
        TRUE
      );
    ELSE
      UPDATE crm.automation_enrollments
      SET
        current_stage_id = NULLIF(v_context->>'stage_id', '')::uuid,
        last_evaluated_at = now(),
        updated_at = now()
      WHERE id = v_enrollment.id;
    END IF;
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_preview_automation_rule(
  p_funnel_id uuid,
  p_lead_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_context jsonb;
  v_anchor jsonb;
  v_anchor_at timestamptz;
  v_steps jsonb := '[]'::jsonb;
  v_step crm.automation_steps%ROWTYPE;
  v_step_rule_result jsonb;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode visualizar o preview das automacoes';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  v_context := crm.get_automation_context(p_lead_id);
  IF v_context IS NULL OR NULLIF(v_context->>'aces_id', '')::integer IS DISTINCT FROM v_funnel.aces_id THEN
    RAISE EXCEPTION 'Lead nao encontrado para esta conta';
  END IF;

  v_anchor := crm.get_anchor_details_from_context(v_context, v_funnel.anchor_event);
  v_anchor_at := NULLIF(v_anchor->>'anchor_at', '')::timestamptz;

  FOR v_step IN
    SELECT *
    FROM crm.automation_steps
    WHERE funnel_id = v_funnel.id
      AND is_active = TRUE
    ORDER BY position ASC, created_at ASC
  LOOP
    v_step_rule_result := CASE
      WHEN v_step.step_rule IS NULL THEN NULL
      ELSE crm.evaluate_automation_rule_node(v_step.step_rule, v_context, v_anchor_at)
    END;

    v_steps := v_steps || jsonb_build_array(
      jsonb_build_object(
        'id', v_step.id,
        'label', v_step.label,
        'delay_minutes', v_step.delay_minutes,
        'scheduled_at', CASE
          WHEN v_anchor_at IS NULL THEN NULL
          ELSE v_anchor_at + make_interval(mins => v_step.delay_minutes)
        END,
        'rule', v_step_rule_result
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'lead_id', p_lead_id,
    'funnel_id', v_funnel.id,
    'anchor_event', v_funnel.anchor_event,
    'anchor_at', v_anchor_at,
    'reply_target_stage_id', v_funnel.reply_target_stage_id,
    'entry_rule', crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_anchor_at),
    'exit_rule', crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_anchor_at),
    'steps', v_steps
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_sync_automation_funnel_v2(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_cancelled integer := 0;
  v_scheduled integer := 0;
  v_lead_id uuid;
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode sincronizar automacoes';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Automacao nao encontrada';
  END IF;

  v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

  IF COALESCE(v_funnel.is_active, TRUE) = FALSE THEN
    FOR v_enrollment IN
      SELECT *
      FROM crm.automation_enrollments
      WHERE funnel_id = v_funnel.id
        AND status = 'active'
    LOOP
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Automacao desativada', FALSE);
    END LOOP;

    RETURN jsonb_build_object(
      'success', TRUE,
      'cancelled', v_cancelled,
      'scheduled', 0
    );
  END IF;

  FOR v_enrollment IN
    SELECT *
    FROM crm.automation_enrollments
    WHERE funnel_id = v_funnel.id
      AND status = 'active'
  LOOP
    v_context := crm.get_automation_context(v_enrollment.lead_id);

    IF v_context IS NULL THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Lead nao encontrado na sincronizacao', FALSE);
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_enrollment.anchor_at);
    v_exit_result := crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_enrollment.anchor_at);

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'cancelled', 'Regra de entrada nao bate mais', FALSE);
      CONTINUE;
    END IF;

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      PERFORM crm.stop_automation_enrollment(v_enrollment.id, 'completed', 'Regra de saida ja atendida', TRUE);
      CONTINUE;
    END IF;

    v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment.id);
  END LOOP;

  FOR v_lead_id IN
    SELECT id
    FROM crm.leads
    WHERE aces_id = v_funnel.aces_id
      AND COALESCE(view, TRUE) = TRUE
  LOOP
    v_scheduled := v_scheduled + crm.start_or_refresh_enrollment(v_funnel.id, v_lead_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'cancelled', v_cancelled,
    'scheduled', v_scheduled
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_claim_due_automation_executions_v2(p_limit integer DEFAULT 50)
RETURNS TABLE (
  execution_id uuid,
  enrollment_id uuid,
  lead_id uuid,
  aces_id integer,
  instance_name text,
  phone text,
  lead_name text,
  city text,
  lead_status text,
  template text,
  step_label text,
  funnel_name text,
  scheduled_at timestamptz,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_due record;
  v_execution record;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
  v_step_result jsonb;
  v_reason text;
BEGIN
  FOR v_due IN
    SELECT ae.id
    FROM crm.automation_executions ae
    WHERE ae.status = 'pending'
      AND ae.scheduled_at <= now()
    ORDER BY ae.scheduled_at ASC, ae.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    SELECT
      ae.*,
      s.message_template,
      s.is_active AS step_is_active,
      s.step_rule,
      f.is_active AS funnel_is_active,
      f.entry_rule,
      f.exit_rule,
      f.trigger_stage_id,
      e.status AS enrollment_status,
      e.anchor_at,
      e.reply_target_stage_id,
      l.contact_phone AS live_phone,
      l.stage_id AS live_stage_id,
      COALESCE(l.view, TRUE) AS live_view
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.automation_enrollments e ON e.id = ae.enrollment_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_reason := NULL;

    IF v_execution.funnel_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Automacao inativa';
    ELSIF v_execution.step_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Mensagem inativa';
    ELSIF COALESCE(v_execution.enrollment_status, '') <> 'active' THEN
      v_reason := 'Enrollment inativo';
    ELSIF COALESCE(v_execution.live_view, TRUE) = FALSE THEN
      v_reason := 'Lead oculto';
    ELSIF COALESCE(v_execution.live_phone, '') = '' THEN
      v_reason := 'Lead sem telefone';
    END IF;

    IF v_reason IS NULL THEN
      v_context := crm.get_automation_context(v_execution.lead_id);
      v_entry_result := crm.evaluate_automation_rule_node(v_execution.entry_rule, v_context, v_execution.anchor_at);
      v_exit_result := crm.evaluate_automation_rule_node(v_execution.exit_rule, v_context, v_execution.anchor_at);
      v_step_result := CASE
        WHEN v_execution.step_rule IS NULL THEN jsonb_build_object('matched', TRUE)
        ELSE crm.evaluate_automation_rule_node(v_execution.step_rule, v_context, v_execution.anchor_at)
      END;

      IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
        v_reason := 'Regra de entrada nao corresponde mais';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'cancelled', v_reason, FALSE);
      ELSIF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
        v_reason := 'Jornada encerrada por regra de saida';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'completed', v_reason, TRUE);
      ELSIF COALESCE((v_step_result->>'matched')::boolean, FALSE) = FALSE THEN
        v_reason := 'Regra extra da mensagem nao bate mais';
      ELSIF v_execution.trigger_stage_id IS NOT NULL AND v_execution.live_stage_id IS DISTINCT FROM v_execution.trigger_stage_id THEN
        v_reason := 'Lead saiu da etapa da jornada';
        PERFORM crm.stop_automation_enrollment(v_execution.enrollment_id, 'cancelled', v_reason, FALSE);
      END IF;
    END IF;

    IF v_reason IS NOT NULL THEN
      UPDATE crm.automation_executions
      SET
        status = 'cancelled',
        cancelled_at = now(),
        completed_reason = COALESCE(completed_reason, v_reason),
        last_error = COALESCE(last_error, v_reason),
        updated_at = now()
      WHERE id = v_execution.id
        AND status = 'pending';

      CONTINUE;
    END IF;

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      claimed_by = COALESCE(auth.uid()::text, 'service_role'),
      updated_at = now()
    WHERE id = v_execution.id
      AND status = 'pending';

    IF FOUND THEN
      RETURN QUERY
      SELECT
        v_execution.id,
        v_execution.enrollment_id,
        v_execution.lead_id,
        v_execution.aces_id,
        v_execution.instance_snapshot,
        v_execution.phone_snapshot,
        v_execution.lead_name_snapshot,
        v_execution.city_snapshot,
        v_execution.status_snapshot,
        v_execution.message_template,
        v_execution.step_label_snapshot,
        v_execution.funnel_name_snapshot,
        v_execution.scheduled_at,
        v_execution.attempt_count;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
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
    sent_at = now(),
    rendered_message = COALESCE(p_rendered_message, rendered_message),
    completed_reason = 'sent',
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_execution.id;

  IF v_execution.enrollment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM crm.automation_executions pending_execution
    WHERE pending_execution.enrollment_id = v_execution.enrollment_id
      AND pending_execution.status IN ('pending', 'processing')
  ) THEN
    UPDATE crm.automation_enrollments
    SET
      status = 'completed',
      stopped_reason = COALESCE(stopped_reason, 'Fluxo finalizado'),
      last_evaluated_at = now(),
      updated_at = now()
    WHERE id = v_execution.enrollment_id
      AND status = 'active';
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_fail_automation_execution(
  p_execution_id uuid,
  p_error text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
BEGIN
  SELECT *
  INTO v_execution
  FROM crm.automation_executions
  WHERE id = p_execution_id
    AND status = 'processing'
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Execucao nao encontrada para falha';
  END IF;

  UPDATE crm.automation_executions
  SET
    status = 'failed',
    last_error = COALESCE(p_error, 'Falha desconhecida'),
    completed_reason = 'failed',
    attempt_count = attempt_count + 1,
    updated_at = now()
  WHERE id = v_execution.id;

  IF v_execution.enrollment_id IS NOT NULL THEN
    PERFORM crm.stop_automation_enrollment(
      v_execution.enrollment_id,
      'failed',
      COALESCE(p_error, 'Falha no envio'),
      FALSE
    );
  END IF;

  RETURN jsonb_build_object('success', TRUE);
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_handle_lead_automation_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_now timestamptz := now();
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      INSERT INTO crm.lead_stage_events (
        aces_id,
        lead_id,
        stage_id,
        event_type,
        occurred_at,
        created_at
      )
      VALUES (
        NEW.aces_id,
        NEW.id,
        NEW.stage_id,
        'entered',
        COALESCE(NEW.updated_at, NEW.created_at, v_now),
        COALESCE(NEW.updated_at, NEW.created_at, v_now)
      );
    END IF;

    PERFORM crm.upsert_lead_automation_state_from_lead(NEW.id);

    IF NEW.stage_id IS NOT NULL AND COALESCE(NEW.view, TRUE) = TRUE THEN
      PERFORM crm.handle_entry_event(NEW.id, 'stage_entered_at');
    END IF;

    RETURN NEW;
  END IF;

  IF COALESCE(OLD.view, TRUE) = TRUE AND COALESCE(NEW.view, TRUE) = FALSE THEN
    PERFORM crm.upsert_lead_automation_state_from_lead(NEW.id);
    PERFORM crm.revalidate_active_enrollments_for_lead(NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    IF OLD.stage_id IS NOT NULL THEN
      INSERT INTO crm.lead_stage_events (
        aces_id,
        lead_id,
        stage_id,
        event_type,
        occurred_at,
        created_at
      )
      VALUES (
        NEW.aces_id,
        NEW.id,
        OLD.stage_id,
        'left',
        v_now,
        v_now
      );
    END IF;

    IF NEW.stage_id IS NOT NULL THEN
      INSERT INTO crm.lead_stage_events (
        aces_id,
        lead_id,
        stage_id,
        event_type,
        occurred_at,
        created_at
      )
      VALUES (
        NEW.aces_id,
        NEW.id,
        NEW.stage_id,
        'entered',
        v_now,
        v_now
      );
    END IF;
  END IF;

  PERFORM crm.upsert_lead_automation_state_from_lead(NEW.id);
  PERFORM crm.revalidate_active_enrollments_for_lead(NEW.id);

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id
    AND NEW.stage_id IS NOT NULL
    AND COALESCE(NEW.view, TRUE) = TRUE THEN
    PERFORM crm.handle_entry_event(NEW.id, 'stage_entered_at');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_handle_message_history_automation_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_direction text := CASE
    WHEN lower(COALESCE(NEW.direction, '')) IN ('outbound', 'out') THEN 'outbound'
    ELSE 'inbound'
  END;
BEGIN
  PERFORM crm.upsert_lead_automation_state_from_message(NEW.id);

  IF v_direction = 'outbound' THEN
    PERFORM crm.handle_entry_event(NEW.lead_id, 'last_outbound');
  ELSE
    PERFORM crm.handle_inbound_exit_for_lead(NEW.lead_id);
    PERFORM crm.handle_entry_event(NEW.lead_id, 'last_inbound');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_cancel_pending_on_funnel_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_target_id uuid := COALESCE(OLD.id, NEW.id);
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM crm.cancel_pending_executions_for_funnel(OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.is_active = FALSE AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
    PERFORM crm.cancel_pending_executions_for_funnel(NEW.id);
    UPDATE crm.automation_enrollments
    SET
      status = 'cancelled',
      stopped_reason = COALESCE(stopped_reason, 'Automacao desativada'),
      last_evaluated_at = now(),
      updated_at = now()
    WHERE funnel_id = v_target_id
      AND status = 'active';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_cancel_pending_on_step_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM crm.cancel_pending_executions_for_step(OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.is_active = FALSE AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
    PERFORM crm.cancel_pending_executions_for_step(NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_automation_funnels_logic_prepare ON crm.automation_funnels;
CREATE TRIGGER trg_automation_funnels_logic_prepare
BEFORE INSERT OR UPDATE OF trigger_stage_id, entry_rule, exit_rule, anchor_event, reentry_mode, reply_target_stage_id, is_active
ON crm.automation_funnels
FOR EACH ROW
EXECUTE FUNCTION crm.trg_prepare_automation_funnel_logic();

DROP TRIGGER IF EXISTS trg_leads_stage_automation ON crm.leads;
CREATE TRIGGER trg_leads_stage_automation
AFTER INSERT OR UPDATE OF stage_id, view ON crm.leads
FOR EACH ROW
EXECUTE FUNCTION crm.trg_handle_lead_automation_v2();

DROP TRIGGER IF EXISTS trg_message_history_automation_v2 ON crm.message_history;
CREATE TRIGGER trg_message_history_automation_v2
AFTER INSERT ON crm.message_history
FOR EACH ROW
EXECUTE FUNCTION crm.trg_handle_message_history_automation_v2();

DROP TRIGGER IF EXISTS trg_lead_automation_state_updated_at ON crm.lead_automation_state;
CREATE TRIGGER trg_lead_automation_state_updated_at
BEFORE UPDATE ON crm.lead_automation_state
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_automation_enrollments_updated_at ON crm.automation_enrollments;
CREATE TRIGGER trg_automation_enrollments_updated_at
BEFORE UPDATE ON crm.automation_enrollments
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

GRANT EXECUTE ON FUNCTION crm.rpc_preview_automation_rule(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_preview_automation_rule(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_sync_automation_funnel_v2(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_sync_automation_funnel_v2(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_fail_automation_execution(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_complete_automation_execution(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION crm.rpc_fail_automation_execution(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_fail_automation_execution(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_fail_automation_execution(uuid, text) FROM PUBLIC;
