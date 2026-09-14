-- Agenda Universal checkpoint 4: signed inbound status reports.

ALTER TABLE agenda_sync.inbound_events
  ADD COLUMN response_body jsonb,
  ADD COLUMN reported_status text,
  ADD COLUMN reported_at timestamptz,
  ADD COLUMN reason text,
  ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE agenda_sync.inbound_events
  ADD CONSTRAINT agenda_inbound_events_response_body_object_check
    CHECK (response_body IS NULL OR jsonb_typeof(response_body) = 'object'),
  ADD CONSTRAINT agenda_inbound_events_reported_status_check
    CHECK (reported_status IS NULL OR reported_status IN ('done', 'no_show')),
  ADD CONSTRAINT agenda_inbound_events_reason_length_check
    CHECK (reason IS NULL OR length(reason) <= 2000),
  ADD CONSTRAINT agenda_inbound_events_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object');

CREATE OR REPLACE FUNCTION agenda_sync.process_inbound_event(
  p_public_connection_id text,
  p_event_id uuid,
  p_event_type text,
  p_payload_hash text,
  p_appointment_id uuid DEFAULT NULL,
  p_base_resource_version bigint DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_reported_at timestamptz DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_connection agenda_sync.connections%ROWTYPE;
  v_existing agenda_sync.inbound_events%ROWTYPE;
  v_event agenda_sync.inbound_events%ROWTYPE;
  v_appointment calendar.events%ROWTYPE;
  v_current_version bigint;
  v_new_version bigint;
  v_response jsonb;
BEGIN
  IF p_public_connection_id IS NULL OR p_public_connection_id !~ '^[0-9a-f]{48}$'
     OR p_event_id IS NULL OR NULLIF(btrim(p_event_type), '') IS NULL
     OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'AGENDA_INBOUND_ARGUMENT_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_connection
  FROM agenda_sync.connections
  WHERE public_id = p_public_connection_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('responseStatus', 401, 'code', 'invalid_connection');
  END IF;
  IF v_connection.status <> 'active' THEN
    RETURN jsonb_build_object('responseStatus', 503, 'code', 'connection_unavailable');
  END IF;

  INSERT INTO agenda_sync.inbound_events (
    connection_id, aces_id, event_id, event_type, payload_hash,
    appointment_id, base_resource_version, reported_status, reported_at,
    reason, metadata
  ) VALUES (
    v_connection.id, v_connection.aces_id, p_event_id, p_event_type, p_payload_hash,
    p_appointment_id, p_base_resource_version, p_status, p_reported_at,
    left(p_reason, 2000), COALESCE(p_metadata, '{}'::jsonb)
  )
  ON CONFLICT (connection_id, event_id) DO NOTHING
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT * INTO v_existing
    FROM agenda_sync.inbound_events
    WHERE connection_id = v_connection.id AND event_id = p_event_id
    FOR UPDATE;
    IF v_existing.payload_hash IS DISTINCT FROM p_payload_hash THEN
      RETURN jsonb_build_object(
        'responseStatus', 409, 'code', 'idempotency_conflict', 'eventId', p_event_id
      );
    END IF;
    RETURN COALESCE(v_existing.response_body, jsonb_build_object(
      'eventId', p_event_id, 'accepted', false
    )) || jsonb_build_object(
      'responseStatus', COALESCE(v_existing.response_status, 202), 'duplicate', true
    );
  END IF;

  IF p_event_type <> 'appointment.status_reported' THEN
    v_response := jsonb_build_object(
      'responseStatus', 200, 'eventId', p_event_id, 'ignored', true,
      'duplicate', false
    );
    UPDATE agenda_sync.inbound_events
    SET outcome = 'ignored', response_status = 200, response_body = v_response,
        processed_at = now()
    WHERE id = v_event.id;
    RETURN v_response;
  END IF;

  IF p_appointment_id IS NULL OR p_base_resource_version IS NULL
     OR p_status NOT IN ('done', 'no_show') OR p_reported_at IS NULL THEN
    v_response := jsonb_build_object(
      'responseStatus', 400, 'code', 'invalid_payload', 'eventId', p_event_id
    );
    UPDATE agenda_sync.inbound_events
    SET outcome = 'rejected', response_status = 400, response_body = v_response,
        error_code = 'invalid_payload', error_message = 'Campos obrigatorios invalidos',
        processed_at = now()
    WHERE id = v_event.id;
    RETURN v_response;
  END IF;

  SELECT * INTO v_appointment
  FROM calendar.events
  WHERE id = p_appointment_id AND aces_id = v_connection.aces_id
    AND professional_id IS NOT NULL AND professional_location_id IS NOT NULL
    AND service_id IS NOT NULL AND deleted_at IS NULL
  FOR UPDATE;
  IF NOT FOUND OR NOT agenda_sync.connection_covers_assignment(
    v_connection.id, v_connection.aces_id, v_appointment.professional_location_id
  ) THEN
    v_response := jsonb_build_object(
      'responseStatus', 404, 'code', 'appointment_not_found', 'eventId', p_event_id
    );
    UPDATE agenda_sync.inbound_events
    SET outcome = 'rejected', response_status = 404, response_body = v_response,
        error_code = 'appointment_not_found', error_message = 'Agendamento nao encontrado no escopo',
        processed_at = now()
    WHERE id = v_event.id;
    RETURN v_response;
  END IF;

  SELECT version INTO v_current_version
  FROM agenda_sync.resource_versions
  WHERE aces_id = v_connection.aces_id
    AND resource_type = 'appointment' AND resource_id = v_appointment.id
  FOR UPDATE;
  v_current_version := COALESCE(v_current_version, 0);
  IF p_base_resource_version IS DISTINCT FROM v_current_version THEN
    v_response := jsonb_build_object(
      'responseStatus', 409, 'code', 'stale_resource_version',
      'eventId', p_event_id, 'currentResourceVersion', v_current_version
    );
    UPDATE agenda_sync.inbound_events
    SET outcome = 'conflict', response_status = 409, response_body = v_response,
        error_code = 'stale_resource_version',
        error_message = 'Versao-base incompativel com a versao atual', processed_at = now()
    WHERE id = v_event.id;
    RETURN v_response;
  END IF;

  IF p_reported_at > now() + interval '5 minutes' THEN
    v_response := jsonb_build_object(
      'responseStatus', 422, 'code', 'reported_at_in_future', 'eventId', p_event_id
    );
  ELSIF p_reported_at < v_appointment.start_time THEN
    v_response := jsonb_build_object(
      'responseStatus', 422, 'code', 'attendance_before_start', 'eventId', p_event_id
    );
  ELSIF v_appointment.status NOT IN ('scheduled', 'confirmed') THEN
    v_response := jsonb_build_object(
      'responseStatus', 422, 'code', 'invalid_status_transition',
      'eventId', p_event_id, 'currentStatus', v_appointment.status
    );
  END IF;

  IF v_response IS NOT NULL THEN
    UPDATE agenda_sync.inbound_events
    SET outcome = 'rejected', response_status = 422, response_body = v_response,
        error_code = v_response->>'code', error_message = 'Transicao de atendimento invalida',
        processed_at = now()
    WHERE id = v_event.id;
    RETURN v_response;
  END IF;

  PERFORM set_config('agenda_sync.origin_connection_id', v_connection.id::text, true);
  UPDATE calendar.events
  SET status = p_status,
      metadata = jsonb_set(
        COALESCE(metadata, '{}'::jsonb), '{agendaLastStatusReport}',
        jsonb_build_object('reportedAt', p_reported_at, 'reason', p_reason,
          'metadata', COALESCE(p_metadata, '{}'::jsonb)), true
      ),
      updated_at = now()
  WHERE id = v_appointment.id AND aces_id = v_connection.aces_id;

  SELECT version INTO STRICT v_new_version
  FROM agenda_sync.resource_versions
  WHERE aces_id = v_connection.aces_id
    AND resource_type = 'appointment' AND resource_id = v_appointment.id;

  v_response := jsonb_build_object(
    'responseStatus', 202, 'eventId', p_event_id, 'accepted', true,
    'duplicate', false, 'appointmentId', v_appointment.id,
    'status', p_status, 'resourceVersion', v_new_version
  );
  UPDATE agenda_sync.inbound_events
  SET outcome = 'accepted', response_status = 202, response_body = v_response,
      processed_at = now()
  WHERE id = v_event.id;
  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION agenda_sync.process_inbound_event(
  text,uuid,text,text,uuid,bigint,text,text,timestamptz,jsonb
) FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION agenda_sync.process_inbound_event(
  text,uuid,text,text,uuid,bigint,text,text,timestamptz,jsonb
) TO service_role;

NOTIFY pgrst, 'reload schema';
