ALTER TABLE crm.automation_funnels
  ADD COLUMN IF NOT EXISTS daily_dispatch_weekends_enabled boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION crm.resolve_daily_automation_dispatch_at(
  p_base_at timestamptz,
  p_dispatch_time time,
  p_timezone text DEFAULT 'America/Sao_Paulo',
  p_include_weekends boolean DEFAULT false
)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_timezone text := COALESCE(NULLIF(trim(p_timezone), ''), 'America/Sao_Paulo');
  v_local_base timestamp;
  v_local_candidate timestamp;
BEGIN
  IF p_base_at IS NULL OR p_dispatch_time IS NULL THEN
    RETURN p_base_at;
  END IF;

  v_local_base := p_base_at AT TIME ZONE v_timezone;
  v_local_candidate := v_local_base::date + p_dispatch_time;

  IF v_local_candidate < v_local_base THEN
    v_local_candidate := (v_local_base::date + 1) + p_dispatch_time;
  END IF;

  IF COALESCE(p_include_weekends, false) = false THEN
    WHILE EXTRACT(ISODOW FROM v_local_candidate) IN (6, 7) LOOP
      v_local_candidate := (v_local_candidate::date + 1) + p_dispatch_time;
    END LOOP;
  END IF;

  RETURN v_local_candidate AT TIME ZONE v_timezone;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.schedule_enrollment_executions(p_enrollment_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $function$
DECLARE
  v_enrollment crm.automation_enrollments%ROWTYPE;
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer := 0;
  v_next record;
  v_scheduled_at timestamptz;
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

  IF NOT FOUND
    OR COALESCE(v_lead.view, TRUE) = FALSE
    OR COALESCE(v_lead.contact_phone, '') = ''
    OR COALESCE(v_lead.instancia, '') <> COALESCE(v_funnel.instance_name, '')
    OR v_lead.owner_id IS DISTINCT FROM v_funnel.created_by THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.automation_executions ae
    WHERE ae.enrollment_id = v_enrollment.id
      AND ae.status IN ('pending', 'processing')
  ) THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_next
  FROM crm.find_next_enrollment_step(v_enrollment.id)
  LIMIT 1;

  IF NOT FOUND OR v_next.step_id IS NULL THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_next.is_active, TRUE) = FALSE THEN
    RETURN 0;
  END IF;

  v_scheduled_at := v_enrollment.anchor_at + make_interval(mins => v_next.delay_minutes);

  IF COALESCE(v_funnel.daily_dispatch_enabled, FALSE) = TRUE AND v_funnel.daily_dispatch_time IS NOT NULL THEN
    v_scheduled_at := crm.resolve_daily_automation_dispatch_at(
      v_scheduled_at,
      v_funnel.daily_dispatch_time,
      'America/Sao_Paulo',
      COALESCE(v_funnel.daily_dispatch_weekends_enabled, FALSE)
    );
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
  VALUES (
    v_enrollment.aces_id,
    v_enrollment.funnel_id,
    v_next.step_id,
    v_enrollment.id,
    v_enrollment.lead_id,
    COALESCE(v_enrollment.current_stage_id, v_funnel.trigger_stage_id),
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
$function$;

CREATE OR REPLACE FUNCTION crm.schedule_automation_for_funnel_lead(p_funnel_id uuid, p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_count integer;
BEGIN
  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT *
  INTO v_lead
  FROM crm.leads
  WHERE id = p_lead_id
    AND aces_id = v_funnel.aces_id
    AND COALESCE(view, TRUE) = TRUE
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_lead.stage_id IS DISTINCT FROM v_funnel.trigger_stage_id THEN
    RETURN 0;
  END IF;

  IF COALESCE(v_lead.contact_phone, '') = '' THEN
    RETURN 0;
  END IF;

  INSERT INTO crm.automation_executions (
    aces_id,
    funnel_id,
    step_id,
    lead_id,
    source_stage_id,
    scheduled_at,
    phone_snapshot,
    instance_snapshot,
    lead_name_snapshot,
    city_snapshot,
    status_snapshot,
    funnel_name_snapshot,
    step_label_snapshot
  )
  SELECT
    v_lead.aces_id,
    v_funnel.id,
    s.id,
    v_lead.id,
    v_funnel.trigger_stage_id,
    CASE
      WHEN COALESCE(v_funnel.daily_dispatch_enabled, FALSE) = TRUE AND v_funnel.daily_dispatch_time IS NOT NULL
        THEN crm.resolve_daily_automation_dispatch_at(
          now() + make_interval(mins => s.delay_minutes),
          v_funnel.daily_dispatch_time,
          'America/Sao_Paulo',
          COALESCE(v_funnel.daily_dispatch_weekends_enabled, FALSE)
        )
      ELSE now() + make_interval(mins => s.delay_minutes)
    END,
    v_lead.contact_phone,
    v_funnel.instance_name,
    v_lead.name,
    v_lead.last_city,
    v_lead.status,
    v_funnel.name,
    s.label
  FROM crm.automation_steps s
  WHERE s.funnel_id = v_funnel.id
    AND s.is_active = TRUE
  ORDER BY s.position ASC, s.created_at ASC
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.resolve_daily_automation_dispatch_at(timestamptz, time, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION crm.resolve_daily_automation_dispatch_at(timestamptz, time, text, boolean) FROM authenticated;
REVOKE ALL ON FUNCTION crm.resolve_daily_automation_dispatch_at(timestamptz, time, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION crm.resolve_daily_automation_dispatch_at(timestamptz, time, text, boolean) FROM PUBLIC;
