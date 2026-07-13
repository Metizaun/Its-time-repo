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
  gupshup_template_params jsonb,
  rb_pix_key text,
  rb_total_amount numeric,
  rb_next_due_date date,
  rb_titles_count integer,
  rb_store_emp_id text,
  rb_store_emp_cpf_cnpj text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm, agents, rb
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
      s.label AS step_label,
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
      f.anchor_event,
      f.name AS live_funnel_name,
      f.reply_target_stage_id,
      f.instance_name AS live_instance_name,
      l.name AS live_lead_name,
      l.contact_phone AS live_phone,
      l.last_city AS live_city,
      l.status AS live_status,
      l.view AS lead_visible,
      rbm.pix_key AS live_rb_pix_key,
      rbm.total_amount AS live_rb_total_amount,
      rbm.next_due_date AS live_rb_next_due_date,
      rbm.titles_count AS live_rb_titles_count,
      rbm.store_emp_id AS live_rb_store_emp_id,
      rbm.store_emp_cpf_cnpj AS live_rb_store_emp_cpf_cnpj
    INTO v_execution
    FROM crm.automation_executions ae
    LEFT JOIN crm.automation_steps s ON s.id = ae.step_id
    LEFT JOIN crm.automation_funnels f ON f.id = ae.funnel_id
    LEFT JOIN crm.leads l ON l.id = ae.lead_id
    LEFT JOIN rb.lead_metadata rbm ON rbm.lead_id = l.id
    LEFT JOIN crm.automation_media_assets ma ON ma.id = COALESCE(ae.media_asset_id_snapshot, s.media_asset_id)
    WHERE ae.id = v_due.id
    LIMIT 1;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_execution.funnel_is_active IS DISTINCT FROM TRUE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Automacao inativa', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    IF v_execution.step_is_active IS DISTINCT FROM TRUE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Mensagem inativa', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_context := crm.get_automation_context(v_execution.lead_id);

    IF v_context IS NULL OR COALESCE((v_context->>'view')::boolean, TRUE) = FALSE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead invisivel ou inexistente', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_entry_result := crm.evaluate_automation_rule_node(
      v_execution.entry_rule,
      v_context,
      crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
    );

    IF COALESCE((v_entry_result->>'matched')::boolean, FALSE) = FALSE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead fora da regra de entrada', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    v_exit_result := crm.evaluate_automation_rule_node(
      v_execution.exit_rule,
      v_context,
      crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
    );

    IF COALESCE((v_exit_result->>'matched')::boolean, FALSE) = TRUE THEN
      UPDATE crm.automation_executions
      SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead na regra de saida', updated_at = now()
      WHERE id = v_execution.id;
      CONTINUE;
    END IF;

    IF v_execution.step_rule IS NOT NULL THEN
      v_step_result := crm.evaluate_automation_rule_node(
        v_execution.step_rule,
        v_context,
        crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context)
      );

      IF COALESCE((v_step_result->>'matched')::boolean, FALSE) = FALSE THEN
        UPDATE crm.automation_executions
        SET status = 'cancelled', cancelled_at = now(), last_error = 'Lead fora da regra da mensagem', updated_at = now()
        WHERE id = v_execution.id;
        CONTINUE;
      END IF;
    END IF;

    v_rendered_template := crm.render_automation_text_or_null(
      v_execution.message_template,
      v_execution.live_lead_name,
      v_execution.live_phone,
      v_execution.live_city,
      v_execution.live_status,
      v_execution.live_rb_pix_key,
      v_execution.live_rb_total_amount,
      v_execution.live_rb_next_due_date,
      v_execution.live_rb_titles_count,
      v_execution.live_rb_store_emp_id,
      v_execution.live_rb_store_emp_cpf_cnpj
    );

    v_rendered_caption := crm.render_automation_text_or_null(
      v_execution.media_caption,
      v_execution.live_lead_name,
      v_execution.live_phone,
      v_execution.live_city,
      v_execution.live_status,
      v_execution.live_rb_pix_key,
      v_execution.live_rb_total_amount,
      v_execution.live_rb_next_due_date,
      v_execution.live_rb_titles_count,
      v_execution.live_rb_store_emp_id,
      v_execution.live_rb_store_emp_cpf_cnpj
    );

    UPDATE crm.automation_executions
    SET
      status = 'processing',
      claimed_by = 'worker',
      rendered_message = v_rendered_template,
      phone_snapshot = v_execution.live_phone,
      instance_snapshot = v_execution.live_instance_name,
      lead_name_snapshot = v_execution.live_lead_name,
      city_snapshot = v_execution.live_city,
      status_snapshot = v_execution.live_status,
      funnel_name_snapshot = v_execution.live_funnel_name,
      step_label_snapshot = COALESCE(v_execution.step_label_snapshot, v_execution.step_label),
      step_rule_snapshot = v_execution.step_rule,
      anchor_at_snapshot = crm.resolve_automation_anchor_at(v_execution.anchor_event, v_context),
      updated_at = now()
    WHERE id = v_execution.id;

    execution_id := v_execution.id;
    enrollment_id := v_execution.enrollment_id;
    lead_id := v_execution.lead_id;
    aces_id := v_execution.aces_id;
    instance_name := v_execution.live_instance_name;
    phone := v_execution.live_phone;
    lead_name := v_execution.live_lead_name;
    city := v_execution.live_city;
    lead_status := v_execution.live_status;
    template := v_rendered_template;
    step_label := COALESCE(v_execution.step_label_snapshot, v_execution.step_label);
    funnel_name := v_execution.live_funnel_name;
    scheduled_at := v_execution.scheduled_at;
    attempt_count := v_execution.attempt_count;
    content_mode := v_execution.step_content_mode;
    media_asset_id := v_execution.media_asset_id;
    media_kind := v_execution.media_kind;
    media_caption := v_rendered_caption;
    media_source_url := v_execution.media_source_url;
    media_mime_type := v_execution.media_mime_type;
    media_file_name := v_execution.media_file_name;
    gupshup_template_id := v_execution.gupshup_template_id;
    gupshup_template_name := v_execution.gupshup_template_name;
    gupshup_template_language := v_execution.gupshup_template_language;
    gupshup_template_params := v_execution.gupshup_template_params;
    rb_pix_key := v_execution.live_rb_pix_key;
    rb_total_amount := v_execution.live_rb_total_amount;
    rb_next_due_date := v_execution.live_rb_next_due_date;
    rb_titles_count := v_execution.live_rb_titles_count;
    rb_store_emp_id := v_execution.live_rb_store_emp_id;
    rb_store_emp_cpf_cnpj := v_execution.live_rb_store_emp_cpf_cnpj;
    RETURN NEXT;
  END LOOP;
END;
$function$;
