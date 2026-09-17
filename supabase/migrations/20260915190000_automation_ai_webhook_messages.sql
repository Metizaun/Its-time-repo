BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

ALTER TABLE crm.lead_webhook_connections
  ADD COLUMN IF NOT EXISTS accept_media boolean NOT NULL DEFAULT FALSE;

ALTER TABLE crm.lead_webhook_receipts
  ADD COLUMN IF NOT EXISTS media_snapshot jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS lead_webhook_connections_aces_id_id_idx
  ON crm.lead_webhook_connections(aces_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS lead_webhook_receipts_aces_id_id_idx
  ON crm.lead_webhook_receipts(aces_id, id);

ALTER TABLE crm.automation_funnels
  ADD COLUMN IF NOT EXISTS lead_webhook_connection_id uuid
    REFERENCES crm.lead_webhook_connections(id) ON DELETE RESTRICT;

ALTER TABLE crm.automation_funnels
  DROP CONSTRAINT IF EXISTS automation_funnels_lead_webhook_connection_id_fkey;
ALTER TABLE crm.automation_funnels
  DROP CONSTRAINT IF EXISTS automation_funnels_webhook_connection_aces_fkey;
ALTER TABLE crm.automation_funnels
  ADD CONSTRAINT automation_funnels_webhook_connection_aces_fkey
  FOREIGN KEY (aces_id, lead_webhook_connection_id)
  REFERENCES crm.lead_webhook_connections(aces_id, id) ON DELETE RESTRICT;

ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS generation_mode text NOT NULL DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS ai_instruction varchar(350),
  ADD COLUMN IF NOT EXISTS ai_output_max_chars integer NOT NULL DEFAULT 1024,
  ADD COLUMN IF NOT EXISTS media_source text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS template_variable_bindings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS template_requested_category text,
  ADD COLUMN IF NOT EXISTS template_provider_category text,
  ADD COLUMN IF NOT EXISTS template_category_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS template_category_acknowledged_by uuid
    REFERENCES crm.users(id) ON DELETE SET NULL;

UPDATE crm.automation_steps
SET media_source = CASE
  WHEN content_mode = 'media' AND media_asset_id IS NOT NULL THEN 'stored_asset'
  ELSE 'none'
END
WHERE media_source = 'none';

ALTER TABLE crm.automation_enrollments
  ADD COLUMN IF NOT EXISTS source_webhook_receipt_id uuid
    REFERENCES crm.lead_webhook_receipts(id) ON DELETE SET NULL;

ALTER TABLE crm.automation_enrollments
  DROP CONSTRAINT IF EXISTS automation_enrollments_source_webhook_receipt_id_fkey;
ALTER TABLE crm.automation_enrollments
  DROP CONSTRAINT IF EXISTS automation_enrollments_webhook_receipt_aces_fkey;
ALTER TABLE crm.automation_enrollments
  ADD CONSTRAINT automation_enrollments_webhook_receipt_aces_fkey
  FOREIGN KEY (aces_id, source_webhook_receipt_id)
  REFERENCES crm.lead_webhook_receipts(aces_id, id) ON DELETE RESTRICT;

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS source_webhook_receipt_id uuid
    REFERENCES crm.lead_webhook_receipts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS generation_mode_snapshot text,
  ADD COLUMN IF NOT EXISTS agent_id_snapshot uuid
    REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_instruction_snapshot varchar(350),
  ADD COLUMN IF NOT EXISTS ai_output_max_chars_snapshot integer,
  ADD COLUMN IF NOT EXISTS media_source_snapshot text,
  ADD COLUMN IF NOT EXISTS template_variable_bindings_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS template_requested_category_snapshot text,
  ADD COLUMN IF NOT EXISTS template_provider_category_snapshot text,
  ADD COLUMN IF NOT EXISTS template_status_snapshot text,
  ADD COLUMN IF NOT EXISTS ai_generated_text text,
  ADD COLUMN IF NOT EXISTS ai_provider text,
  ADD COLUMN IF NOT EXISTS ai_model text,
  ADD COLUMN IF NOT EXISTS ai_provider_request_id text,
  ADD COLUMN IF NOT EXISTS ai_usage_event_id uuid,
  ADD COLUMN IF NOT EXISTS ai_generated_at timestamptz;

ALTER TABLE crm.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_source_webhook_receipt_id_fkey;
ALTER TABLE crm.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_webhook_receipt_aces_fkey;
ALTER TABLE crm.automation_executions
  ADD CONSTRAINT automation_executions_webhook_receipt_aces_fkey
  FOREIGN KEY (aces_id, source_webhook_receipt_id)
  REFERENCES crm.lead_webhook_receipts(aces_id, id) ON DELETE RESTRICT;

ALTER TABLE meta.whatsapp_templates
  ADD COLUMN IF NOT EXISTS requested_category text;

UPDATE meta.whatsapp_templates
SET requested_category = category
WHERE requested_category IS NULL;

CREATE OR REPLACE FUNCTION crm.automation_template_bindings_valid(p_bindings jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_typeof(COALESCE(p_bindings, '[]'::jsonb)) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(COALESCE(p_bindings, '[]'::jsonb)) WITH ORDINALITY AS item(value, ordinality)
      WHERE jsonb_typeof(item.value) <> 'object'
        OR CASE
          WHEN COALESCE(item.value->>'position', '') ~ '^[1-9][0-9]*$'
            THEN (item.value->>'position')::integer IS DISTINCT FROM item.ordinality::integer
          ELSE TRUE
        END
        OR item.value->>'source' NOT IN (
          'ai', 'fixed', 'lead.name', 'lead.city', 'lead.notes', 'lead.source',
          'lead.tags', 'webhook.media.caption'
        )
        OR (item.value->>'source' = 'fixed' AND length(btrim(COALESCE(item.value->>'value', ''))) = 0)
    );
$$;

DO $$
BEGIN
  ALTER TABLE crm.lead_webhook_receipts
    DROP CONSTRAINT IF EXISTS lead_webhook_receipts_media_snapshot_check;
  ALTER TABLE crm.lead_webhook_receipts
    ADD CONSTRAINT lead_webhook_receipts_media_snapshot_check
    CHECK (media_snapshot IS NULL OR jsonb_typeof(media_snapshot) = 'object');

  ALTER TABLE crm.automation_funnels
    DROP CONSTRAINT IF EXISTS automation_funnels_entry_source_check;
  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_entry_source_check
    CHECK (entry_source IN ('conditions', 'rb', 'calendar_event', 'collection', 'lead_webhook'));

  ALTER TABLE crm.automation_funnels
    DROP CONSTRAINT IF EXISTS automation_funnels_entry_shape_check;
  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_entry_shape_check CHECK (
      (entry_source = 'calendar_event' AND trigger_event_status IS NOT NULL)
      OR (entry_source IN ('collection', 'lead_webhook') AND trigger_event_status IS NULL AND trigger_stage_id IS NULL)
      OR (entry_source IN ('conditions', 'rb') AND trigger_stage_id IS NOT NULL)
    );

  ALTER TABLE crm.automation_funnels
    DROP CONSTRAINT IF EXISTS automation_funnels_webhook_connection_check;
  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_webhook_connection_check CHECK (
      (entry_source = 'lead_webhook' AND lead_webhook_connection_id IS NOT NULL)
      OR (entry_source <> 'lead_webhook' AND lead_webhook_connection_id IS NULL)
    );

  ALTER TABLE crm.automation_funnels
    DROP CONSTRAINT IF EXISTS automation_funnels_anchor_event_check;
  ALTER TABLE crm.automation_funnels
    ADD CONSTRAINT automation_funnels_anchor_event_check CHECK (
      anchor_event IN ('stage_entered_at', 'last_outbound', 'last_inbound',
        'event_start_time', 'event_end_time', 'event_status_changed_at',
        'collection_eligible_at', 'lead_webhook_received_at')
    );

  ALTER TABLE crm.automation_enrollments
    DROP CONSTRAINT IF EXISTS automation_enrollments_anchor_event_check;
  ALTER TABLE crm.automation_enrollments
    ADD CONSTRAINT automation_enrollments_anchor_event_check CHECK (
      anchor_event IN ('stage_entered_at', 'last_outbound', 'last_inbound',
        'event_start_time', 'event_end_time', 'event_status_changed_at',
        'collection_eligible_at', 'lead_webhook_received_at')
    );

  ALTER TABLE crm.automation_steps
    DROP CONSTRAINT IF EXISTS automation_steps_generation_mode_check;
  ALTER TABLE crm.automation_steps
    ADD CONSTRAINT automation_steps_generation_mode_check
    CHECK (generation_mode IN ('fixed', 'ai'));

  ALTER TABLE crm.automation_steps
    DROP CONSTRAINT IF EXISTS automation_steps_ai_configuration_check;
  ALTER TABLE crm.automation_steps
    ADD CONSTRAINT automation_steps_ai_configuration_check CHECK (
      ai_output_max_chars BETWEEN 1 AND 4096
      AND (generation_mode = 'fixed' OR length(btrim(COALESCE(ai_instruction, ''))) BETWEEN 1 AND 350)
    );

  ALTER TABLE crm.automation_steps
    DROP CONSTRAINT IF EXISTS automation_steps_media_source_check;
  ALTER TABLE crm.automation_steps
    ADD CONSTRAINT automation_steps_media_source_check
    CHECK (media_source IN ('none', 'stored_asset', 'webhook'));

  ALTER TABLE crm.automation_steps
    DROP CONSTRAINT IF EXISTS automation_steps_template_bindings_check;
  ALTER TABLE crm.automation_steps
    ADD CONSTRAINT automation_steps_template_bindings_check
    CHECK (crm.automation_template_bindings_valid(template_variable_bindings));

  ALTER TABLE crm.automation_steps
    DROP CONSTRAINT IF EXISTS automation_steps_template_categories_check;
  ALTER TABLE crm.automation_steps
    ADD CONSTRAINT automation_steps_template_categories_check CHECK (
      (template_requested_category IS NULL OR template_requested_category IN ('UTILITY', 'MARKETING'))
      AND (template_provider_category IS NULL OR template_provider_category IN ('UTILITY', 'MARKETING', 'AUTHENTICATION', 'UNKNOWN'))
    );

  ALTER TABLE crm.automation_steps
    DROP CONSTRAINT IF EXISTS automation_steps_content_payload_check;
  ALTER TABLE crm.automation_steps
    ADD CONSTRAINT automation_steps_content_payload_check CHECK (
      (generation_mode = 'ai' OR char_length(btrim(COALESCE(
        NULLIF(message_template, ''), NULLIF(media_caption, ''), ''
      ))) > 0)
      AND (
        (media_source = 'none' AND content_mode = 'text' AND media_asset_id IS NULL)
        OR (media_source = 'stored_asset' AND content_mode = 'media' AND media_asset_id IS NOT NULL)
        OR (media_source = 'webhook' AND content_mode = 'media' AND media_asset_id IS NULL AND media_kind = 'image')
      )
    );

  ALTER TABLE crm.automation_executions
    DROP CONSTRAINT IF EXISTS automation_executions_ai_generation_check;
  ALTER TABLE crm.automation_executions
    ADD CONSTRAINT automation_executions_ai_generation_check CHECK (
      ai_generated_text IS NULL
      OR (char_length(btrim(ai_generated_text)) > 0 AND ai_generated_at IS NOT NULL)
    );

  ALTER TABLE meta.whatsapp_templates
    DROP CONSTRAINT IF EXISTS meta_whatsapp_templates_requested_category_check;
  ALTER TABLE meta.whatsapp_templates
    ADD CONSTRAINT meta_whatsapp_templates_requested_category_check
    CHECK (requested_category IS NULL OR requested_category IN ('UTILITY', 'MARKETING'));
END;
$$;

DROP INDEX IF EXISTS crm.idx_automation_enrollments_active_anchor;
CREATE UNIQUE INDEX idx_automation_enrollments_active_anchor
  ON crm.automation_enrollments(funnel_id, lead_id, anchor_event, anchor_at)
  WHERE status = 'active'
    AND source_calendar_event_id IS NULL
    AND source_collection_case_id IS NULL
    AND source_webhook_receipt_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS automation_enrollments_webhook_receipt_idx
  ON crm.automation_enrollments(funnel_id, source_webhook_receipt_id)
  WHERE source_webhook_receipt_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS automation_executions_webhook_receipt_step_idx
  ON crm.automation_executions(source_webhook_receipt_id, step_id)
  WHERE source_webhook_receipt_id IS NOT NULL AND step_id IS NOT NULL;

DROP INDEX IF EXISTS crm.idx_automation_execution_pending_funnel_lead_step;
CREATE UNIQUE INDEX idx_automation_execution_pending_funnel_lead_step
  ON crm.automation_executions(funnel_id, lead_id, step_id)
  WHERE status IN ('pending', 'processing')
    AND funnel_id IS NOT NULL AND lead_id IS NOT NULL AND step_id IS NOT NULL
    AND source_calendar_event_id IS NULL
    AND source_collection_case_id IS NULL
    AND source_webhook_receipt_id IS NULL;

CREATE INDEX IF NOT EXISTS automation_funnels_webhook_connection_idx
  ON crm.automation_funnels(aces_id, lead_webhook_connection_id, is_active)
  WHERE entry_source = 'lead_webhook';

CREATE INDEX IF NOT EXISTS automation_executions_webhook_receipt_status_idx
  ON crm.automation_executions(source_webhook_receipt_id, status, scheduled_at)
  WHERE source_webhook_receipt_id IS NOT NULL;

CREATE OR REPLACE FUNCTION crm.snapshot_automation_execution_configuration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_step crm.automation_steps%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_media jsonb;
  v_agent_id uuid;
BEGIN
  IF NEW.enrollment_id IS NOT NULL THEN
    SELECT * INTO v_enrollment FROM crm.automation_enrollments WHERE id = NEW.enrollment_id;
    NEW.source_webhook_receipt_id := COALESCE(NEW.source_webhook_receipt_id, v_enrollment.source_webhook_receipt_id);
  END IF;

  IF NEW.step_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_step FROM crm.automation_steps WHERE id = NEW.step_id;
  SELECT * INTO v_funnel FROM crm.automation_funnels WHERE id = v_step.funnel_id;

  NEW.generation_mode_snapshot := COALESCE(NEW.generation_mode_snapshot, v_step.generation_mode);
  NEW.ai_instruction_snapshot := COALESCE(NEW.ai_instruction_snapshot, v_step.ai_instruction);
  NEW.ai_output_max_chars_snapshot := COALESCE(NEW.ai_output_max_chars_snapshot, v_step.ai_output_max_chars);
  NEW.media_source_snapshot := COALESCE(NEW.media_source_snapshot, v_step.media_source);
  NEW.template_variable_bindings_snapshot := COALESCE(NEW.template_variable_bindings_snapshot, v_step.template_variable_bindings);
  NEW.template_requested_category_snapshot := COALESCE(NEW.template_requested_category_snapshot, v_step.template_requested_category);
  NEW.template_provider_category_snapshot := COALESCE(NEW.template_provider_category_snapshot, v_step.template_provider_category);
  NEW.template_status_snapshot := COALESCE(NEW.template_status_snapshot, v_step.template_status);
  NEW.content_mode_snapshot := COALESCE(NEW.content_mode_snapshot, v_step.content_mode);
  NEW.media_asset_id_snapshot := COALESCE(NEW.media_asset_id_snapshot, v_step.media_asset_id);
  NEW.media_kind_snapshot := COALESCE(NEW.media_kind_snapshot, v_step.media_kind);
  NEW.media_caption_snapshot := COALESCE(NEW.media_caption_snapshot, v_step.media_caption);
  NEW.gupshup_template_id_snapshot := COALESCE(NEW.gupshup_template_id_snapshot, v_step.gupshup_template_id);
  NEW.gupshup_template_name_snapshot := COALESCE(NEW.gupshup_template_name_snapshot, v_step.gupshup_template_name);
  NEW.gupshup_template_language_snapshot := COALESCE(NEW.gupshup_template_language_snapshot, v_step.gupshup_template_language);
  NEW.gupshup_template_params_snapshot := COALESCE(NEW.gupshup_template_params_snapshot, v_step.gupshup_template_params);

  SELECT agent.id INTO v_agent_id
  FROM agents.ai_agents AS agent
  WHERE agent.aces_id = v_funnel.aces_id
    AND agent.instance_name = v_funnel.instance_name
    AND agent.agent_type = 'primary'
    AND agent.is_active IS TRUE
  LIMIT 1;
  NEW.agent_id_snapshot := COALESCE(NEW.agent_id_snapshot, v_agent_id);

  IF NEW.source_webhook_receipt_id IS NOT NULL AND v_step.media_source = 'webhook' THEN
    SELECT receipt.media_snapshot INTO v_media
    FROM crm.lead_webhook_receipts AS receipt
    WHERE receipt.id = NEW.source_webhook_receipt_id
      AND receipt.aces_id = v_funnel.aces_id;
    NEW.media_source_url_snapshot := NULLIF(v_media->>'finalUrl', '');
    NEW.media_mime_type_snapshot := NULLIF(v_media->>'mimeType', '');
    NEW.media_file_name_snapshot := COALESCE(NULLIF(v_media->>'fileName', ''), 'webhook-image');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_complete_automation_execution(
  p_execution_id uuid,
  p_rendered_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_execution crm.automation_executions%ROWTYPE;
  v_sent_at timestamptz := now();
  v_scheduled integer := 0;
  v_is_scoped boolean := FALSE;
BEGIN
  SELECT * INTO v_execution FROM crm.automation_executions
  WHERE id = p_execution_id AND status = 'processing';
  IF NOT FOUND THEN RAISE EXCEPTION 'Execucao nao encontrada para conclusao'; END IF;
  UPDATE crm.automation_executions SET status = 'sent', sent_at = v_sent_at,
    rendered_message = COALESCE(p_rendered_message, rendered_message), completed_reason = 'sent',
    attempt_count = attempt_count + 1, updated_at = now() WHERE id = v_execution.id;
  v_is_scoped := v_execution.enrollment_id IS NOT NULL AND (
    v_execution.source_calendar_event_id IS NOT NULL
    OR v_execution.source_collection_case_id IS NOT NULL
    OR v_execution.source_webhook_receipt_id IS NOT NULL
  );

  IF v_execution.funnel_id IS NOT NULL AND v_execution.step_id IS NOT NULL THEN
    IF v_is_scoped THEN
      INSERT INTO crm.automation_step_progress (
        aces_id, funnel_id, lead_id, step_id, enrollment_id, sent_execution_id, first_sent_at
      ) VALUES (
        v_execution.aces_id, v_execution.funnel_id, v_execution.lead_id, v_execution.step_id,
        v_execution.enrollment_id, v_execution.id, v_sent_at
      ) ON CONFLICT (enrollment_id, step_id) WHERE enrollment_id IS NOT NULL DO UPDATE
      SET first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
          sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
          updated_at = now();
    ELSE
      INSERT INTO crm.automation_step_progress (
        aces_id, funnel_id, lead_id, step_id, sent_execution_id, first_sent_at
      ) VALUES (
        v_execution.aces_id, v_execution.funnel_id, v_execution.lead_id, v_execution.step_id,
        v_execution.id, v_sent_at
      ) ON CONFLICT (funnel_id, lead_id, step_id) WHERE enrollment_id IS NULL DO UPDATE
      SET first_sent_at = LEAST(crm.automation_step_progress.first_sent_at, EXCLUDED.first_sent_at),
          sent_execution_id = COALESCE(crm.automation_step_progress.sent_execution_id, EXCLUDED.sent_execution_id),
          updated_at = now();
    END IF;
  END IF;

  IF v_execution.funnel_id IS NOT NULL AND COALESCE(v_execution.instance_snapshot, '') <> '' THEN
    PERFORM crm.recalculate_automation_funnel_dispatch_state(
      v_execution.aces_id, v_execution.funnel_id, v_execution.instance_snapshot
    );
  END IF;
  IF v_execution.enrollment_id IS NOT NULL THEN
    v_scheduled := crm.schedule_enrollment_executions(v_execution.enrollment_id);
    UPDATE crm.automation_enrollments SET last_evaluated_at = now(), updated_at = now()
    WHERE id = v_execution.enrollment_id AND status = 'active';
  END IF;
  IF v_execution.source_collection_case_id IS NOT NULL AND v_scheduled = 0 THEN
    UPDATE collections.cases
    SET communication_status = CASE
          WHEN source_freshness = 'fresh' AND open_receivables_count > 0 THEN 'eligible'
          WHEN source_freshness <> 'fresh' THEN 'stale'
          ELSE 'completed'
        END,
        updated_at = now()
    WHERE id = v_execution.source_collection_case_id
      AND communication_status = 'scheduled';
  END IF;
  RETURN jsonb_build_object('success', TRUE, 'scheduled', v_scheduled);
END;
$$;

DROP TRIGGER IF EXISTS trg_snapshot_automation_execution_configuration ON crm.automation_executions;
CREATE TRIGGER trg_snapshot_automation_execution_configuration
BEFORE INSERT ON crm.automation_executions
FOR EACH ROW EXECUTE FUNCTION crm.snapshot_automation_execution_configuration();

CREATE OR REPLACE FUNCTION crm.find_next_enrollment_step(p_enrollment_id uuid)
RETURNS TABLE(
  step_id uuid, is_active boolean, step_position integer, delay_minutes integer,
  message_template text, step_rule jsonb, label text, created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_is_scoped boolean := FALSE;
BEGIN
  SELECT * INTO v_enrollment FROM crm.automation_enrollments WHERE id = p_enrollment_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_is_scoped := v_enrollment.source_calendar_event_id IS NOT NULL
    OR v_enrollment.source_collection_case_id IS NOT NULL
    OR v_enrollment.source_webhook_receipt_id IS NOT NULL;
  RETURN QUERY
  SELECT s.id, s.is_active, s.position, s.delay_minutes, s.message_template,
    s.step_rule, s.label, s.created_at
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_enrollment.funnel_id
    AND NOT EXISTS (
      SELECT 1 FROM crm.automation_step_progress asp
      WHERE asp.step_id = s.id AND (
        (v_is_scoped AND asp.enrollment_id = v_enrollment.id)
        OR (NOT v_is_scoped AND asp.enrollment_id IS NULL
          AND asp.funnel_id = v_enrollment.funnel_id AND asp.lead_id = v_enrollment.lead_id)
      )
    )
  ORDER BY s.position, s.created_at
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION crm.enqueue_lead_webhook_automations(p_receipt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_receipt crm.lead_webhook_receipts%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_context jsonb;
  v_entry jsonb;
  v_exit jsonb;
  v_existing crm.automation_enrollments%ROWTYPE;
  v_enrollment_id uuid;
  v_enrolled integer := 0;
  v_scheduled integer := 0;
BEGIN
  SELECT * INTO v_receipt FROM crm.lead_webhook_receipts WHERE id = p_receipt_id FOR UPDATE;
  IF NOT FOUND OR v_receipt.lead_id IS NULL THEN
    RETURN jsonb_build_object('enrolled', 0, 'scheduled', 0, 'reason', 'receipt_not_available');
  END IF;
  SELECT * INTO v_lead FROM crm.leads WHERE id = v_receipt.lead_id AND aces_id = v_receipt.aces_id;
  IF NOT FOUND OR v_lead.view IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object('enrolled', 0, 'scheduled', 0, 'reason', 'lead_not_available');
  END IF;
  v_context := crm.get_automation_context(v_lead.id);

  FOR v_funnel IN
    SELECT funnel.* FROM crm.automation_funnels AS funnel
    WHERE funnel.aces_id = v_receipt.aces_id
      AND funnel.entry_source = 'lead_webhook'
      AND funnel.lead_webhook_connection_id = v_receipt.connection_id
      AND funnel.is_active IS TRUE
      AND funnel.instance_name = v_lead.instancia
      AND EXISTS (
        SELECT 1 FROM agents.ai_agents agent
        WHERE agent.aces_id = funnel.aces_id
          AND agent.instance_name = funnel.instance_name
          AND agent.agent_type = 'primary'
          AND agent.is_active IS TRUE
      )
  LOOP
    v_entry := CASE
      WHEN v_funnel.entry_rule IS NULL
        OR jsonb_array_length(COALESCE(v_funnel.entry_rule->'children', '[]'::jsonb)) = 0
      THEN jsonb_build_object('matched', TRUE)
      ELSE crm.evaluate_automation_rule_node(v_funnel.entry_rule, v_context, v_receipt.created_at)
    END;
    v_exit := CASE
      WHEN v_funnel.exit_rule IS NULL
        OR jsonb_array_length(COALESCE(v_funnel.exit_rule->'children', '[]'::jsonb)) = 0
      THEN jsonb_build_object('matched', FALSE)
      ELSE crm.evaluate_automation_rule_node(v_funnel.exit_rule, v_context, v_receipt.created_at)
    END;
    IF COALESCE((v_entry->>'matched')::boolean, TRUE) IS FALSE
       OR COALESCE((v_exit->>'matched')::boolean, FALSE) IS TRUE THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_existing FROM crm.automation_enrollments
    WHERE funnel_id = v_funnel.id AND lead_id = v_lead.id AND status = 'active'
    ORDER BY created_at DESC LIMIT 1;
    IF FOUND AND v_funnel.reentry_mode = 'ignore_if_active' THEN
      CONTINUE;
    ELSIF FOUND AND v_funnel.reentry_mode = 'restart_on_match' THEN
      PERFORM crm.stop_automation_enrollment(v_existing.id, 'cancelled', 'Reentrada por novo webhook', FALSE);
    END IF;

    v_enrollment_id := NULL;
    INSERT INTO crm.automation_enrollments (
      aces_id, funnel_id, lead_id, status, anchor_event, anchor_at,
      current_stage_id, reply_target_stage_id, last_evaluated_at,
      source_webhook_receipt_id
    ) VALUES (
      v_receipt.aces_id, v_funnel.id, v_lead.id, 'active',
      'lead_webhook_received_at', v_receipt.created_at, v_lead.stage_id,
      v_funnel.reply_target_stage_id, now(), v_receipt.id
    ) ON CONFLICT DO NOTHING RETURNING id INTO v_enrollment_id;
    IF v_enrollment_id IS NOT NULL THEN
      v_enrolled := v_enrolled + 1;
      v_scheduled := v_scheduled + crm.schedule_enrollment_executions(v_enrollment_id);
    END IF;
  END LOOP;
  RETURN jsonb_build_object('enrolled', v_enrolled, 'scheduled', v_scheduled);
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_finalize_lead_webhook_receipt(
  p_public_id text,
  p_idempotency_key text,
  p_payload_hash text,
  p_media_snapshot jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection crm.lead_webhook_connections%ROWTYPE;
  v_receipt crm.lead_webhook_receipts%ROWTYPE;
  v_automation jsonb;
  v_response jsonb;
BEGIN
  SELECT * INTO v_connection FROM crm.lead_webhook_connections
  WHERE public_id = btrim(p_public_id) LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_CONNECTION_NOT_FOUND'; END IF;
  SELECT * INTO v_receipt FROM crm.lead_webhook_receipts
  WHERE connection_id = v_connection.id AND idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_RECEIPT_NOT_FOUND'; END IF;
  IF v_receipt.payload_hash <> lower(btrim(p_payload_hash)) THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_IDEMPOTENCY_CONFLICT';
  END IF;
  IF v_receipt.response ? 'automation' THEN
    RETURN v_receipt.response;
  END IF;
  IF p_media_snapshot IS NOT NULL AND jsonb_typeof(p_media_snapshot) <> 'object' THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_MEDIA_INVALID';
  END IF;
  IF p_media_snapshot IS NOT NULL AND v_connection.accept_media IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_MEDIA_DISABLED';
  END IF;
  UPDATE crm.lead_webhook_receipts
  SET media_snapshot = p_media_snapshot
  WHERE id = v_receipt.id;
  v_automation := crm.enqueue_lead_webhook_automations(v_receipt.id);
  v_response := v_receipt.response || jsonb_build_object('automation', v_automation);
  UPDATE crm.lead_webhook_receipts SET response = v_response WHERE id = v_receipt.id;
  RETURN v_response;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_set_automation_funnel_active(
  p_funnel_id uuid,
  p_active boolean,
  p_ack_category_change boolean DEFAULT FALSE
)
RETURNS crm.automation_funnels
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_connection crm.lead_webhook_connections%ROWTYPE;
  v_provider text;
BEGIN
  IF public.current_crm_role() <> 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'AUTOMATION_ADMIN_REQUIRED';
  END IF;
  SELECT * INTO v_funnel FROM crm.automation_funnels
  WHERE id = p_funnel_id AND aces_id = public.current_aces_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUTOMATION_FUNNEL_NOT_FOUND'; END IF;
  IF p_active THEN
    SELECT lower(instance.provider) INTO v_provider
    FROM meta.instance AS instance
    WHERE instance.instance_name = v_funnel.instance_name;
    IF v_funnel.entry_source = 'lead_webhook' THEN
      SELECT * INTO v_connection FROM crm.lead_webhook_connections
      WHERE id = v_funnel.lead_webhook_connection_id AND aces_id = v_funnel.aces_id;
      IF NOT FOUND OR v_connection.status <> 'active' THEN RAISE EXCEPTION 'AUTOMATION_WEBHOOK_CONNECTION_INVALID'; END IF;
      IF NOT EXISTS (
        SELECT 1 FROM agents.ai_agents agent
        WHERE agent.id = v_connection.agent_id AND agent.aces_id = v_funnel.aces_id
          AND agent.instance_name = v_funnel.instance_name
          AND agent.agent_type = 'primary' AND agent.is_active IS TRUE
      ) THEN RAISE EXCEPTION 'AUTOMATION_INSTANCE_AGENT_INVALID'; END IF;
      IF EXISTS (
        SELECT 1 FROM crm.automation_steps step
        WHERE step.funnel_id = v_funnel.id AND step.is_active
          AND step.media_source = 'webhook' AND v_connection.accept_media IS DISTINCT FROM TRUE
      ) THEN RAISE EXCEPTION 'AUTOMATION_WEBHOOK_MEDIA_DISABLED'; END IF;
    END IF;
    IF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.generation_mode = 'ai'
        AND length(btrim(COALESCE(step.ai_instruction, ''))) = 0
    ) THEN RAISE EXCEPTION 'AUTOMATION_AI_INSTRUCTION_REQUIRED'; END IF;
    IF v_provider IN ('meta', 'gupshup') AND EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND (
          step.template_provider IS DISTINCT FROM v_provider
          OR length(btrim(COALESCE(step.gupshup_template_name, step.gupshup_template_id, ''))) = 0
        )
    ) THEN RAISE EXCEPTION 'AUTOMATION_OFFICIAL_TEMPLATE_REQUIRED'; END IF;
    IF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.template_provider IN ('meta', 'gupshup')
        AND upper(COALESCE(step.template_status, '')) <> 'APPROVED'
    ) THEN RAISE EXCEPTION 'AUTOMATION_TEMPLATE_NOT_APPROVED'; END IF;
    IF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.template_provider IN ('meta', 'gupshup')
        AND (step.generation_mode = 'ai' OR jsonb_array_length(step.template_variable_bindings) > 0)
        AND (
          NOT crm.automation_template_bindings_valid(step.template_variable_bindings)
          OR jsonb_array_length(step.template_variable_bindings) <> jsonb_array_length(step.gupshup_template_params)
          OR (step.generation_mode = 'ai' AND (
            SELECT count(*) FROM jsonb_array_elements(step.template_variable_bindings) binding
            WHERE binding->>'source' = 'ai'
          )) = 0
        )
    ) THEN RAISE EXCEPTION 'AUTOMATION_TEMPLATE_BINDINGS_INVALID'; END IF;
    IF p_ack_category_change THEN
      UPDATE crm.automation_steps SET
        template_category_acknowledged_at = now(),
        template_category_acknowledged_by = public.current_crm_user_id()
      WHERE funnel_id = v_funnel.id AND template_requested_category IS DISTINCT FROM template_provider_category;
    ELSIF EXISTS (
      SELECT 1 FROM crm.automation_steps step
      WHERE step.funnel_id = v_funnel.id AND step.is_active
        AND step.template_requested_category IS DISTINCT FROM step.template_provider_category
        AND step.template_category_acknowledged_at IS NULL
    ) THEN RAISE EXCEPTION 'AUTOMATION_TEMPLATE_CATEGORY_CONFIRMATION_REQUIRED'; END IF;
  END IF;
  UPDATE crm.automation_funnels SET is_active = p_active, updated_at = now()
  WHERE id = v_funnel.id RETURNING * INTO v_funnel;
  IF v_funnel.entry_source <> 'lead_webhook' THEN
    PERFORM crm.rpc_sync_automation_funnel_v2(v_funnel.id);
  END IF;
  RETURN v_funnel;
END;
$$;

REVOKE ALL ON FUNCTION crm.enqueue_lead_webhook_automations(uuid) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_finalize_lead_webhook_receipt(text, text, text, jsonb) FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.enqueue_lead_webhook_automations(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_finalize_lead_webhook_receipt(text, text, text, jsonb) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_set_automation_funnel_active(uuid, boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_set_automation_funnel_active(uuid, boolean, boolean) TO authenticated, service_role;

COMMENT ON COLUMN crm.lead_webhook_receipts.media_snapshot IS
  'Metadados imutaveis da imagem externa validada; nunca armazena os bytes.';
COMMENT ON COLUMN crm.automation_executions.ai_generated_text IS
  'Texto de IA persistido antes do envio e reutilizado em todas as retentativas.';

COMMIT;
