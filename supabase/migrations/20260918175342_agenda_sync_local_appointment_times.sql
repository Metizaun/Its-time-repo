-- Preserve the canonical UTC timestamps and add explicit local wall-clock
-- values so webhook consumers do not need to perform timezone conversion.

CREATE OR REPLACE FUNCTION agenda_sync.appointment_resource(p_event_id uuid, p_aces_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', e.id,
    'status', CASE WHEN e.deleted_at IS NOT NULL THEN 'cancelled' ELSE e.status END,
    'startTime', to_char(e.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endTime', to_char(e.end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'startTimeLocal', to_char(timezone(COALESCE(cs.timezone, 'America/Sao_Paulo'), e.start_time), 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'endTimeLocal', to_char(timezone(COALESCE(cs.timezone, 'America/Sao_Paulo'), e.end_time), 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'timezone', COALESCE(cs.timezone, 'America/Sao_Paulo'),
    'durationMinutes', COALESCE(e.duration_minutes_snapshot, s.duration_minutes,
      GREATEST(1, floor(extract(epoch FROM (e.end_time - e.start_time)) / 60)::integer)),
    'unitId', pl.empresa_id,
    'locationName', CASE WHEN pl.empresa_id IS NULL THEN pl.location_name ELSE NULL END,
    'professionalId', e.professional_id,
    'assignmentId', e.professional_location_id,
    'patientId', e.lead_id,
    'service', jsonb_build_object(
      'id', e.service_id,
      'name', s.name,
      'durationMinutes', COALESCE(e.duration_minutes_snapshot, s.duration_minutes),
      'price', CASE WHEN e.price_cents_snapshot IS NULL THEN NULL
        ELSE to_char(e.price_cents_snapshot / 100.0, 'FM999999999999990.00') END,
      'currency', 'BRL'
    ),
    'origin', e.booking_origin,
    'notes', e.description,
    'cancelReason', e.cancel_reason,
    'metadata', COALESCE(e.metadata, '{}'::jsonb),
    'updatedAt', to_char(e.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
  FROM calendar.events e
  JOIN calendar.professional_locations pl
    ON pl.id = e.professional_location_id AND pl.aces_id = e.aces_id
  JOIN calendar.services s ON s.id = e.service_id AND s.aces_id = e.aces_id
  LEFT JOIN calendar.settings cs ON cs.aces_id = e.aces_id
  WHERE e.id = p_event_id AND e.aces_id = p_aces_id
$$;

CREATE OR REPLACE FUNCTION agenda_sync.capture_appointment_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new_eligible boolean := false;
  v_old_eligible boolean := false;
  v_row calendar.events%ROWTYPE;
  v_event_type text;
  v_appointment_version bigint;
  v_patient_version bigint;
  v_appointment jsonb;
  v_patient jsonb;
  v_connection record;
  v_origin_connection_id uuid;
  v_timezone text;
  v_occurred_at timestamptz := clock_timestamp();
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_new_eligible := NEW.professional_id IS NOT NULL
      AND NEW.professional_location_id IS NOT NULL AND NEW.service_id IS NOT NULL
      AND NEW.deleted_at IS NULL;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old_eligible := OLD.professional_id IS NOT NULL
      AND OLD.professional_location_id IS NOT NULL AND OLD.service_id IS NOT NULL
      AND OLD.deleted_at IS NULL;
  END IF;
  IF NOT v_new_eligible AND NOT v_old_eligible THEN RETURN COALESCE(NEW, OLD); END IF;

  v_row := CASE WHEN v_new_eligible THEN NEW ELSE OLD END;
  IF NOT v_old_eligible AND v_new_eligible THEN
    v_event_type := 'appointment.created';
  ELSIF v_old_eligible AND NOT v_new_eligible THEN
    v_event_type := 'appointment.cancelled';
  ELSIF NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time
     OR NEW.professional_id IS DISTINCT FROM OLD.professional_id
     OR NEW.professional_location_id IS DISTINCT FROM OLD.professional_location_id
     OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    v_event_type := 'appointment.rescheduled';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_event_type := CASE WHEN NEW.status = 'cancelled' THEN 'appointment.cancelled'
      ELSE 'appointment.status_changed' END;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_appointment_version := agenda_sync.next_resource_version(v_row.aces_id, 'appointment', v_row.id);
  v_appointment := agenda_sync.appointment_resource(v_row.id, v_row.aces_id);
  -- Hard deletes cannot be queried after the row operation; reconstruct the stable core from OLD.
  IF v_appointment IS NULL THEN
    SELECT COALESCE(cs.timezone, 'America/Sao_Paulo')
    INTO v_timezone
    FROM calendar.settings cs
    WHERE cs.aces_id = v_row.aces_id;
    v_timezone := COALESCE(v_timezone, 'America/Sao_Paulo');

    v_appointment := jsonb_build_object(
      'id', v_row.id, 'status', 'cancelled',
      'startTime', to_char(v_row.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endTime', to_char(v_row.end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'startTimeLocal', to_char(timezone(v_timezone, v_row.start_time), 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
      'endTimeLocal', to_char(timezone(v_timezone, v_row.end_time), 'YYYY-MM-DD"T"HH24:MI:SS.MS'),
      'timezone', v_timezone, 'durationMinutes', GREATEST(1, floor(extract(epoch FROM (v_row.end_time-v_row.start_time))/60)::integer),
      'unitId', v_row.empresa_id, 'locationName', v_row.location,
      'professionalId', v_row.professional_id, 'assignmentId', v_row.professional_location_id,
      'patientId', v_row.lead_id,
      'service', jsonb_build_object('id', v_row.service_id, 'name', v_row.title,
        'durationMinutes', COALESCE(v_row.duration_minutes_snapshot, GREATEST(1, floor(extract(epoch FROM (v_row.end_time-v_row.start_time))/60)::integer)),
        'price', CASE WHEN v_row.price_cents_snapshot IS NULL THEN NULL ELSE to_char(v_row.price_cents_snapshot/100.0, 'FM999999999999990.00') END,
        'currency', 'BRL'),
      'origin', v_row.booking_origin, 'notes', v_row.description,
      'cancelReason', COALESCE(v_row.cancel_reason, 'deleted'), 'metadata', COALESCE(v_row.metadata, '{}'::jsonb),
      'updatedAt', to_char(v_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
  ELSIF v_event_type = 'appointment.cancelled' AND v_appointment->>'status' <> 'cancelled' THEN
    v_appointment := jsonb_set(v_appointment, '{status}', '"cancelled"'::jsonb);
  END IF;

  v_origin_connection_id := NULLIF(current_setting('agenda_sync.origin_connection_id', true), '')::uuid;
  IF v_event_type = 'appointment.created' THEN
    v_patient_version := agenda_sync.next_resource_version(v_row.aces_id, 'patient', v_row.lead_id);
    v_patient := agenda_sync.patient_resource(v_row.lead_id, v_row.aces_id);
  END IF;

  FOR v_connection IN
    SELECT c.id
    FROM agenda_sync.connections c
    WHERE c.aces_id = v_row.aces_id
      AND c.status IN ('active', 'syncing')
      AND c.id IS DISTINCT FROM v_origin_connection_id
      AND agenda_sync.connection_covers_assignment(c.id, v_row.aces_id, v_row.professional_location_id)
    ORDER BY c.id
    FOR UPDATE
  LOOP
    IF v_event_type = 'appointment.created' THEN
      PERFORM agenda_sync.enqueue_for_connection(v_connection.id, v_row.aces_id,
        'patient.upserted', 'patient', v_row.lead_id, v_patient_version, v_patient, v_occurred_at);
    END IF;
    PERFORM agenda_sync.enqueue_for_connection(v_connection.id, v_row.aces_id,
      v_event_type, 'appointment', v_row.id, v_appointment_version, v_appointment, v_occurred_at);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END;
$$;
