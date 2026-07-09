-- Automacao multimodal V1.A: imagem e PDF em passos de automacao.

ALTER TABLE crm.automation_steps
  ADD COLUMN IF NOT EXISTS content_mode text NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_asset_id uuid,
  ADD COLUMN IF NOT EXISTS media_kind text,
  ADD COLUMN IF NOT EXISTS media_caption text,
  ADD COLUMN IF NOT EXISTS gupshup_template_id text,
  ADD COLUMN IF NOT EXISTS gupshup_template_name text,
  ADD COLUMN IF NOT EXISTS gupshup_template_language text DEFAULT 'pt_BR',
  ADD COLUMN IF NOT EXISTS gupshup_template_params jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE crm.automation_steps
  ALTER COLUMN message_template DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_message_template_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      DROP CONSTRAINT automation_steps_message_template_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_content_mode_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_content_mode_check
      CHECK (content_mode IN ('text', 'media'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_media_kind_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_media_kind_check
      CHECK (media_kind IS NULL OR media_kind IN ('image', 'document'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_gupshup_params_array_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_gupshup_params_array_check
      CHECK (jsonb_typeof(gupshup_template_params) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_content_payload_check'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_content_payload_check
      CHECK (
        (
          content_mode = 'text'
          AND char_length(btrim(COALESCE(message_template, ''))) > 0
          AND media_asset_id IS NULL
          AND media_kind IS NULL
        )
        OR
        (
          content_mode = 'media'
          AND media_asset_id IS NOT NULL
          AND media_kind IN ('image', 'document')
        )
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_automation_steps_media_asset
  ON crm.automation_steps(media_asset_id)
  WHERE media_asset_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('agents.tool_media_assets') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'automation_steps_media_asset_id_fkey'
         AND conrelid = 'crm.automation_steps'::regclass
     ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_media_asset_id_fkey
      FOREIGN KEY (media_asset_id)
      REFERENCES agents.tool_media_assets(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

ALTER TABLE crm.automation_executions
  ADD COLUMN IF NOT EXISTS content_mode_snapshot text,
  ADD COLUMN IF NOT EXISTS media_asset_id_snapshot uuid,
  ADD COLUMN IF NOT EXISTS media_kind_snapshot text,
  ADD COLUMN IF NOT EXISTS media_caption_snapshot text,
  ADD COLUMN IF NOT EXISTS media_source_url_snapshot text,
  ADD COLUMN IF NOT EXISTS media_mime_type_snapshot text,
  ADD COLUMN IF NOT EXISTS media_file_name_snapshot text,
  ADD COLUMN IF NOT EXISTS gupshup_template_id_snapshot text,
  ADD COLUMN IF NOT EXISTS gupshup_template_name_snapshot text,
  ADD COLUMN IF NOT EXISTS gupshup_template_language_snapshot text,
  ADD COLUMN IF NOT EXISTS gupshup_template_params_snapshot jsonb;

CREATE OR REPLACE FUNCTION crm.render_automation_text_or_null(
  p_template text,
  p_lead_name text,
  p_phone text,
  p_city text,
  p_status text
)
RETURNS text
LANGUAGE sql
STABLE
AS $function$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_template, '')), '') IS NULL THEN NULL
    ELSE crm.render_automation_message_template(p_template, p_lead_name, p_phone, p_city, p_status)
  END;
$function$;

DROP FUNCTION IF EXISTS crm.rpc_claim_due_automation_executions_v2(integer);

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
  attempt_count integer,
  content_mode text,
  media_asset_id uuid,
  media_kind text,
  media_caption text,
  media_source_url text,
  media_mime_type text,
  media_file_name text,
  gupshup_template_id text,
  gupshup_template_name text,
  gupshup_template_language text,
  gupshup_template_params jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm, agents
AS $function$
DECLARE
  v_due record;
  v_execution record;
  v_context jsonb;
  v_entry_result jsonb;
  v_exit_result jsonb;
  v_step_result jsonb;
  v_rendered_template text;
  v_rendered_caption text;
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
      COALESCE(ae.content_mode_snapshot, s.content_mode, 'text') AS step_content_mode,
      COALESCE(ae.media_asset_id_snapshot, s.media_asset_id) AS media_asset_id,
      COALESCE(ae.media_kind_snapshot, s.media_kind) AS media_kind,
      COALESCE(ae.media_caption_snapshot, s.media_caption) AS media_caption,
      COALESCE(ae.media_source_url_snapshot, ma.source_url) AS media_source_url,
      COALESCE(ae.media_mime_type_snapshot, ma.mime_type) AS media_mime_type,
      COALESCE(ae.media_file_name_snapshot, ma.file_name) AS media_file_name,
      CASE WHEN ae.media_source_url_snapshot IS NOT NULL THEN TRUE ELSE ma.is_active END AS media_is_active,
      COALESCE(ae.gupshup_template_id_snapshot, s.gupshup_template_id) AS gupshup_template_id,
      COALESCE(ae.gupshup_template_name_snapshot, s.gupshup_template_name) AS gupshup_template_name,
      COALESCE(ae.gupshup_template_language_snapshot, s.gupshup_template_language, 'pt_BR') AS gupshup_template_language,
      COALESCE(ae.gupshup_template_params_snapshot, s.gupshup_template_params, '[]'::jsonb) AS gupshup_template_params,
      f.is_active AS funnel_is_active,
      f.entry_rule,
      f.exit_rule,
      f.trigger_stage_id,
      f.instance_name AS funnel_instance_name,
      e.status AS enrollment_status,
      e.anchor_at,
      e.reply_target_stage_id,
      l.contact_phone AS live_phone,
      l.stage_id AS live_stage_id,
      l.instancia AS live_instance_name,
      COALESCE(l.view, TRUE) AS live_view
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN agents.tool_media_assets ma ON ma.id = COALESCE(ae.media_asset_id_snapshot, s.media_asset_id)
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.automation_enrollments e ON e.id = ae.enrollment_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_reason := NULL;
    v_rendered_template := crm.render_automation_text_or_null(
      v_execution.message_template,
      v_execution.lead_name_snapshot,
      v_execution.phone_snapshot,
      v_execution.city_snapshot,
      v_execution.status_snapshot
    );
    v_rendered_caption := crm.render_automation_text_or_null(
      v_execution.media_caption,
      v_execution.lead_name_snapshot,
      v_execution.phone_snapshot,
      v_execution.city_snapshot,
      v_execution.status_snapshot
    );

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
    ELSIF COALESCE(v_execution.live_instance_name, '') <> COALESCE(v_execution.funnel_instance_name, '') THEN
      v_reason := 'Lead fora da instancia da automacao';
    ELSIF v_execution.step_content_mode = 'text'
      AND crm.has_unresolved_automation_template_vars(COALESCE(v_rendered_template, '')) THEN
      v_reason := 'Mensagem contem variavel nao resolvida';
    ELSIF v_execution.step_content_mode = 'media'
      AND v_execution.media_asset_id IS NULL THEN
      v_reason := 'Midia da mensagem nao definida';
    ELSIF v_execution.step_content_mode = 'media'
      AND v_execution.media_is_active IS DISTINCT FROM TRUE THEN
      v_reason := 'Midia da mensagem esta inativa';
    ELSIF v_execution.step_content_mode = 'media'
      AND v_execution.media_kind NOT IN ('image', 'document') THEN
      v_reason := 'Tipo de midia nao suportado nesta automacao';
    ELSIF v_execution.step_content_mode = 'media'
      AND COALESCE(v_execution.media_source_url, '') = '' THEN
      v_reason := 'URL da midia nao encontrada';
    ELSIF v_execution.step_content_mode = 'media'
      AND crm.has_unresolved_automation_template_vars(COALESCE(v_rendered_caption, '')) THEN
      v_reason := 'Legenda contem variavel nao resolvida';
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

      IF v_execution.instance_snapshot IS NOT NULL THEN
        PERFORM crm.recalculate_automation_instance_dispatch_state(
          v_execution.aces_id,
          v_execution.instance_snapshot
        );
      END IF;

      CONTINUE;
    END IF;

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      claimed_by = COALESCE(auth.uid()::text, 'service_role'),
      content_mode_snapshot = v_execution.step_content_mode,
      media_asset_id_snapshot = v_execution.media_asset_id,
      media_kind_snapshot = v_execution.media_kind,
      media_caption_snapshot = v_rendered_caption,
      media_source_url_snapshot = v_execution.media_source_url,
      media_mime_type_snapshot = v_execution.media_mime_type,
      media_file_name_snapshot = v_execution.media_file_name,
      gupshup_template_id_snapshot = v_execution.gupshup_template_id,
      gupshup_template_name_snapshot = v_execution.gupshup_template_name,
      gupshup_template_language_snapshot = v_execution.gupshup_template_language,
      gupshup_template_params_snapshot = v_execution.gupshup_template_params,
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
        v_rendered_template,
        v_execution.step_label_snapshot,
        v_execution.funnel_name_snapshot,
        v_execution.scheduled_at,
        v_execution.attempt_count,
        v_execution.step_content_mode,
        v_execution.media_asset_id,
        v_execution.media_kind,
        v_rendered_caption,
        v_execution.media_source_url,
        v_execution.media_mime_type,
        v_execution.media_file_name,
        v_execution.gupshup_template_id,
        v_execution.gupshup_template_name,
        v_execution.gupshup_template_language,
        v_execution.gupshup_template_params;
    END IF;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.render_automation_text_or_null(text, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM PUBLIC;
