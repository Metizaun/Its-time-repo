CREATE OR REPLACE FUNCTION calendar.service_reschedule_professional_appointment(
  p_event_id uuid,
  p_start_time timestamptz,
  p_aces_id integer
)
RETURNS calendar.events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event calendar.events%ROWTYPE;
  v_existing calendar.events%ROWTYPE;
  v_new_event calendar.events%ROWTYPE;
  v_slot record;
  v_timezone text;
  v_idempotency_key text;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_event_id IS NULL OR p_start_time IS NULL OR p_aces_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento e novo horario sao obrigatorios';
  END IF;

  v_idempotency_key := 'ai-reschedule:' || p_event_id::text || ':'
    || to_char(p_start_time AT TIME ZONE 'UTC', 'YYYYMMDDHH24MISSUS');

  SELECT * INTO v_existing
  FROM calendar.events AS event
  WHERE event.aces_id = p_aces_id
    AND event.idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  SELECT * INTO v_event
  FROM calendar.events AS event
  WHERE event.id = p_event_id
    AND event.aces_id = p_aces_id
    AND event.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agendamento profissional nao encontrado ou inativo';
  END IF;

  -- Another request for this source event may have completed while this call waited on its row lock.
  SELECT * INTO v_existing
  FROM calendar.events AS event
  WHERE event.aces_id = p_aces_id
    AND event.idempotency_key = v_idempotency_key
  LIMIT 1;

  IF FOUND THEN
    RETURN v_existing;
  END IF;

  IF v_event.professional_location_id IS NULL
    OR v_event.service_id IS NULL
    OR v_event.lead_id IS NULL
    OR v_event.status NOT IN ('scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Agendamento profissional nao encontrado ou inativo';
  END IF;

  IF v_event.start_time = p_start_time THEN
    RETURN v_event;
  END IF;

  v_timezone := COALESCE(
    (SELECT settings.timezone
     FROM calendar.settings AS settings
     WHERE settings.aces_id = p_aces_id),
    'America/Sao_Paulo'
  );

  SELECT * INTO v_slot
  FROM calendar.list_available_slots(
    v_event.professional_location_id,
    v_event.service_id,
    (p_start_time AT TIME ZONE v_timezone)::date,
    (p_start_time AT TIME ZONE v_timezone)::date,
    NULL,
    200,
    v_event.id,
    p_aces_id
  ) AS slot
  WHERE slot.slot_start = p_start_time
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE';
  END IF;

  PERFORM calendar.cancel_professional_appointment(
    v_event.id,
    'Reagendado a pedido do cliente pelo atendimento com IA.'
  );

  SELECT * INTO v_new_event
  FROM calendar.create_professional_appointment(
    p_lead_id => v_event.lead_id,
    p_professional_location_id => v_event.professional_location_id,
    p_service_id => v_event.service_id,
    p_start_time => v_slot.slot_start,
    p_title => v_event.title,
    p_opportunity_id => v_event.opportunity_id,
    p_status => v_event.status,
    p_description => v_event.description,
    p_location => v_event.location,
    p_meeting_url => v_event.meeting_url,
    p_followup_1h_enabled => v_event.followup_1h_enabled,
    p_booking_origin => COALESCE(v_event.booking_origin, 'ai'),
    p_idempotency_key => v_idempotency_key,
    p_aces_id => p_aces_id
  );

  UPDATE calendar.events AS event
  SET metadata = (COALESCE(v_event.metadata, '{}'::jsonb)
      - 'cancelled_at' - 'cancelled_by_user_id'
      - 'rescheduled_by' - 'rescheduled_from_event_id')
    || COALESCE(v_new_event.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'rescheduled_by', 'ai',
      'rescheduled_from_event_id', v_event.id
    ),
    updated_at = now()
  WHERE event.id = v_new_event.id
  RETURNING * INTO v_new_event;

  RETURN v_new_event;
END;
$$;

REVOKE ALL ON FUNCTION calendar.service_reschedule_professional_appointment(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION calendar.service_reschedule_professional_appointment(uuid, timestamptz, integer)
  TO service_role;
