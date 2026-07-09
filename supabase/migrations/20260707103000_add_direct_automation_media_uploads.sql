INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'automation-media',
  'automation-media',
  true,
  104857600,
  ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'application/pdf'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

CREATE TABLE IF NOT EXISTS crm.automation_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL,
  display_name text NOT NULL,
  source_url text NOT NULL DEFAULT '',
  storage_bucket text,
  storage_path text,
  media_kind text NOT NULL,
  mime_type text,
  file_name text,
  file_size bigint,
  default_caption text,
  upload_status text NOT NULL DEFAULT 'ready',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_media_assets_kind_check
    CHECK (media_kind IN ('image', 'document')),
  CONSTRAINT automation_media_assets_upload_status_check
    CHECK (upload_status IN ('pending', 'ready', 'failed')),
  CONSTRAINT automation_media_assets_storage_consistency_check
    CHECK (
      upload_status <> 'pending'
      OR (storage_bucket IS NOT NULL AND storage_path IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_automation_media_assets_instance_active
  ON crm.automation_media_assets(aces_id, instance_name, is_active, upload_status, created_at DESC);

DROP TRIGGER IF EXISTS trg_automation_media_assets_updated_at ON crm.automation_media_assets;
CREATE TRIGGER trg_automation_media_assets_updated_at
BEFORE UPDATE ON crm.automation_media_assets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO crm.automation_media_assets (
  id,
  aces_id,
  instance_name,
  display_name,
  source_url,
  media_kind,
  mime_type,
  file_name,
  default_caption,
  upload_status,
  is_active,
  created_at,
  updated_at
)
SELECT
  tma.id,
  tma.aces_id,
  aa.instance_name,
  tma.display_name,
  tma.source_url,
  tma.media_kind,
  tma.mime_type,
  tma.file_name,
  tma.default_caption,
  'ready',
  tma.is_active,
  tma.created_at,
  tma.updated_at
FROM agents.tool_media_assets tma
JOIN agents.agent_tools at ON at.id = tma.agent_tool_id
JOIN agents.ai_agents aa ON aa.id = at.agent_id
ON CONFLICT (id) DO UPDATE
SET
  aces_id = EXCLUDED.aces_id,
  instance_name = EXCLUDED.instance_name,
  display_name = EXCLUDED.display_name,
  source_url = EXCLUDED.source_url,
  media_kind = EXCLUDED.media_kind,
  mime_type = EXCLUDED.mime_type,
  file_name = EXCLUDED.file_name,
  default_caption = EXCLUDED.default_caption,
  upload_status = EXCLUDED.upload_status,
  is_active = EXCLUDED.is_active,
  updated_at = EXCLUDED.updated_at;

ALTER TABLE crm.automation_steps
  DROP CONSTRAINT IF EXISTS automation_steps_media_asset_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'automation_steps_media_asset_id_fkey'
      AND conrelid = 'crm.automation_steps'::regclass
  ) THEN
    ALTER TABLE crm.automation_steps
      ADD CONSTRAINT automation_steps_media_asset_id_fkey
      FOREIGN KEY (media_asset_id)
      REFERENCES crm.automation_media_assets(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION crm.deactivate_orphan_automation_media_asset(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  IF p_asset_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE crm.automation_media_assets asset
  SET
    is_active = FALSE,
    updated_at = now()
  WHERE asset.id = p_asset_id
    AND asset.is_active = TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM crm.automation_steps step
      WHERE step.media_asset_id = p_asset_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cleanup_orphan_automation_media_assets_from_steps()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM crm.deactivate_orphan_automation_media_asset(OLD.media_asset_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.media_asset_id IS DISTINCT FROM NEW.media_asset_id THEN
    PERFORM crm.deactivate_orphan_automation_media_asset(OLD.media_asset_id);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cleanup_orphan_automation_media_assets_on_steps ON crm.automation_steps;
CREATE TRIGGER trg_cleanup_orphan_automation_media_assets_on_steps
AFTER UPDATE OR DELETE ON crm.automation_steps
FOR EACH ROW EXECUTE FUNCTION crm.cleanup_orphan_automation_media_assets_from_steps();

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
    LEFT JOIN crm.automation_media_assets ma ON ma.id = COALESCE(ae.media_asset_id_snapshot, s.media_asset_id)
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

GRANT EXECUTE ON FUNCTION crm.deactivate_orphan_automation_media_asset(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.cleanup_orphan_automation_media_assets_from_steps() TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions_v2(integer) FROM PUBLIC;
