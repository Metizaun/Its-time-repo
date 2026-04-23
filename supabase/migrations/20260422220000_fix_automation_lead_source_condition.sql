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
    'source', l."Fonte",
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
  v_source text := p_context->>'source';
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

    WHEN 'origem_is' THEN
      v_label := 'Origem do lead e';
      v_actual := CASE
        WHEN COALESCE(btrim(v_source), '') = '' THEN 'null'::jsonb
        ELSE to_jsonb(btrim(v_source))
      END;
      v_matched := CASE
        WHEN COALESCE(p_predicate->>'value', '') = '__automation_no_lead_source__'
          THEN COALESCE(btrim(v_source), '') = ''
        ELSE lower(COALESCE(btrim(v_source), '')) = lower(COALESCE(btrim(p_predicate->>'value'), ''))
      END;

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
