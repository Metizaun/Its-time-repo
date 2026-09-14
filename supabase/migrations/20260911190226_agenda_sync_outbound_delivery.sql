-- Agenda Universal checkpoint 3: transactional appointment capture and leased delivery queue.

CREATE OR REPLACE FUNCTION agenda_sync.next_resource_version(
  p_aces_id integer, p_resource_type text, p_resource_id uuid
)
RETURNS bigint
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  INSERT INTO agenda_sync.resource_versions (aces_id, resource_type, resource_id, version)
  VALUES (p_aces_id, p_resource_type, p_resource_id, 1)
  ON CONFLICT (aces_id, resource_type, resource_id)
  DO UPDATE SET version = agenda_sync.resource_versions.version + 1, updated_at = now()
  RETURNING version
$$;

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

CREATE OR REPLACE FUNCTION agenda_sync.patient_resource(p_lead_id uuid, p_aces_id integer)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'phoneE164', l.contact_phone,
    'birthDate', NULL,
    'document', NULL,
    'homeUnitId', l.empresa_id,
    'metadata', '{}'::jsonb,
    'updatedAt', to_char(l.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )) || jsonb_build_object('birthDate', NULL, 'document', NULL)
  FROM crm.leads l
  WHERE l.id = p_lead_id AND l.aces_id = p_aces_id
$$;

CREATE OR REPLACE FUNCTION agenda_sync.connection_covers_assignment(
  p_connection_id uuid, p_aces_id integer, p_assignment_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM agenda_sync.connections c
    JOIN calendar.professional_locations pl
      ON pl.id = p_assignment_id AND pl.aces_id = p_aces_id
    WHERE c.id = p_connection_id AND c.aces_id = p_aces_id
      AND (
        c.scope_mode = 'all_resources'
        OR (pl.empresa_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM agenda_sync.connection_units cu
          WHERE cu.connection_id = c.id AND cu.aces_id = c.aces_id AND cu.unit_id = pl.empresa_id
        ))
        OR (pl.empresa_id IS NULL AND EXISTS (
          SELECT 1 FROM agenda_sync.connection_assignments ca
          WHERE ca.connection_id = c.id AND ca.aces_id = c.aces_id AND ca.assignment_id = pl.id
        ))
      )
  )
$$;

CREATE OR REPLACE FUNCTION agenda_sync.enqueue_for_connection(
  p_connection_id uuid,
  p_aces_id integer,
  p_event_type text,
  p_resource_type text,
  p_resource_id uuid,
  p_resource_version bigint,
  p_resource jsonb,
  p_occurred_at timestamptz DEFAULT clock_timestamp()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_sequence bigint;
  v_event_id uuid := gen_random_uuid();
  v_envelope jsonb;
BEGIN
  UPDATE agenda_sync.connections
  SET next_sequence = next_sequence + 1, updated_at = now()
  WHERE id = p_connection_id AND aces_id = p_aces_id
  RETURNING next_sequence INTO v_sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND'; END IF;

  v_envelope := jsonb_build_object(
    'schemaVersion', '1.0', 'eventId', v_event_id, 'eventType', p_event_type,
    'occurredAt', to_char(p_occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'resourceVersion', p_resource_version, 'resource', p_resource
  );
  INSERT INTO agenda_sync.outbox (
    connection_id, aces_id, sequence, event_id, event_type,
    resource_type, resource_id, resource_version, envelope, payload_hash
  ) VALUES (
    p_connection_id, p_aces_id, v_sequence, v_event_id, p_event_type,
    p_resource_type, p_resource_id, p_resource_version, v_envelope,
    encode(extensions.digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex')
  );
  RETURN v_event_id;
END;
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
    v_appointment := jsonb_build_object(
      'id', v_row.id, 'status', 'cancelled',
      'startTime', to_char(v_row.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endTime', to_char(v_row.end_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'timezone', 'America/Sao_Paulo', 'durationMinutes', GREATEST(1, floor(extract(epoch FROM (v_row.end_time-v_row.start_time))/60)::integer),
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

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_appointment ON calendar.events;
CREATE TRIGGER trg_agenda_sync_capture_appointment
AFTER INSERT OR UPDATE OR DELETE ON calendar.events
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_appointment_change();

CREATE OR REPLACE FUNCTION agenda_sync.claim_delivery(
  p_worker_id text, p_lease_seconds integer DEFAULT 60, p_limit integer DEFAULT 20
)
RETURNS SETOF agenda_sync.outbox
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NULLIF(btrim(p_worker_id), '') IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 600
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'AGENDA_CLAIM_ARGUMENT_INVALID' USING ERRCODE = '22023';
  END IF;
  -- A crash after the final allowed claim must not produce a ninth HTTP attempt.
  WITH exhausted AS (
    UPDATE agenda_sync.outbox
    SET status='dead_letter', dead_lettered_at=now(), locked_at=NULL, locked_until=NULL,
      locked_by=NULL, last_error_code='delivery_window_exhausted',
      last_error_message='Limite de tentativas ou janela de 24 horas esgotado', updated_at=now()
    WHERE status IN ('pending','delivering')
      AND (locked_until IS NULL OR locked_until < now())
      AND (attempt_count >= 8 OR (first_attempt_at IS NOT NULL AND now() >= first_attempt_at + interval '24 hours'))
    RETURNING connection_id, aces_id
  )
  UPDATE agenda_sync.connections c
  SET status='error', last_error_at=now(), last_error_code='delivery_window_exhausted',
    last_error_message='Limite de tentativas ou janela de 24 horas esgotado', updated_at=now()
  FROM exhausted e WHERE c.id=e.connection_id AND c.aces_id=e.aces_id;
  RETURN QUERY
  WITH heads AS (
    SELECT DISTINCT ON (o.connection_id) o.id
    FROM agenda_sync.outbox o
    JOIN agenda_sync.connections c ON c.id = o.connection_id AND c.aces_id = o.aces_id
    WHERE o.status IN ('pending', 'delivering', 'dead_letter')
      AND (c.status IN ('active', 'syncing') OR o.event_type = 'integration.test')
    ORDER BY o.connection_id, o.sequence
  ), candidates AS (
    SELECT o.id
    FROM agenda_sync.outbox o JOIN heads h ON h.id = o.id
    WHERE o.status IN ('pending', 'delivering')
      AND o.available_at <= now()
      AND (o.locked_until IS NULL OR o.locked_until < now())
    ORDER BY o.created_at, o.connection_id
    FOR UPDATE OF o SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE agenda_sync.outbox o
  SET status = 'delivering', attempt_count = o.attempt_count + 1,
      first_attempt_at = COALESCE(o.first_attempt_at, now()), locked_at = now(),
      locked_until = now() + make_interval(secs => p_lease_seconds),
      locked_by = p_worker_id, updated_at = now()
  FROM candidates c WHERE o.id = c.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.renew_delivery_lease(
  p_outbox_id uuid, p_worker_id text, p_lease_seconds integer DEFAULT 60
)
RETURNS boolean LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  UPDATE agenda_sync.outbox SET locked_until = now() + make_interval(secs => p_lease_seconds), updated_at = now()
  WHERE id = p_outbox_id AND status = 'delivering' AND locked_by = p_worker_id
    AND locked_until >= now() RETURNING true
$$;

CREATE OR REPLACE FUNCTION agenda_sync.finish_delivery(
  p_outbox_id uuid, p_worker_id text, p_started_at timestamptz, p_duration_ms integer,
  p_http_status integer, p_response_excerpt text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row agenda_sync.outbox%ROWTYPE;
BEGIN
  SELECT * INTO v_row FROM agenda_sync.outbox
  WHERE id = p_outbox_id AND status = 'delivering' AND locked_by = p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE agenda_sync.outbox SET status='delivered', delivered_at=now(), locked_at=NULL,
    locked_until=NULL, locked_by=NULL, last_http_status=p_http_status,
    last_error_code=NULL, last_error_message=NULL, updated_at=now() WHERE id=p_outbox_id;
  INSERT INTO agenda_sync.deliveries(connection_id,aces_id,outbox_id,event_id,attempt_number,
    started_at,finished_at,duration_ms,outcome,http_status,response_excerpt,worker_id)
  VALUES(v_row.connection_id,v_row.aces_id,v_row.id,v_row.event_id,v_row.attempt_count,
    p_started_at,now(),GREATEST(p_duration_ms,0),'delivered',p_http_status,left(p_response_excerpt,2000),p_worker_id);
  UPDATE agenda_sync.connections SET last_delivered_at=now(),last_error_at=NULL,
    last_error_code=NULL,last_error_message=NULL,updated_at=now()
  WHERE id=v_row.connection_id AND aces_id=v_row.aces_id;
  IF v_row.event_type='integration.test' THEN
    UPDATE agenda_sync.connections SET tested_at=now(),updated_at=now()
    WHERE id=v_row.connection_id AND aces_id=v_row.aces_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.fail_delivery(
  p_outbox_id uuid, p_worker_id text, p_started_at timestamptz, p_duration_ms integer,
  p_http_status integer, p_error_code text, p_error_message text,
  p_retryable boolean, p_retry_at timestamptz DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_row agenda_sync.outbox%ROWTYPE; v_dead boolean; v_outcome text;
BEGIN
  SELECT * INTO v_row FROM agenda_sync.outbox
  WHERE id=p_outbox_id AND status='delivering' AND locked_by=p_worker_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'lease_lost'; END IF;
  v_dead := NOT p_retryable OR v_row.attempt_count >= 8
    OR now() >= v_row.first_attempt_at + interval '24 hours'
    OR COALESCE(p_retry_at, now()) > v_row.first_attempt_at + interval '24 hours';
  v_outcome := CASE WHEN v_dead THEN CASE WHEN p_retryable THEN 'dead_letter' ELSE 'permanent_failure' END ELSE 'retry' END;
  UPDATE agenda_sync.outbox SET status=CASE WHEN v_dead THEN 'dead_letter' ELSE 'pending' END,
    available_at=CASE WHEN v_dead THEN available_at ELSE GREATEST(COALESCE(p_retry_at,now()),now()) END,
    dead_lettered_at=CASE WHEN v_dead THEN now() ELSE NULL END,
    locked_at=NULL,locked_until=NULL,locked_by=NULL,last_http_status=p_http_status,
    last_error_code=left(p_error_code,200),last_error_message=left(p_error_message,2000),updated_at=now()
  WHERE id=p_outbox_id;
  INSERT INTO agenda_sync.deliveries(connection_id,aces_id,outbox_id,event_id,attempt_number,
    started_at,finished_at,duration_ms,outcome,http_status,error_code,error_message,worker_id)
  VALUES(v_row.connection_id,v_row.aces_id,v_row.id,v_row.event_id,v_row.attempt_count,
    p_started_at,now(),GREATEST(p_duration_ms,0),v_outcome,p_http_status,left(p_error_code,200),left(p_error_message,2000),p_worker_id);
  UPDATE agenda_sync.connections SET last_error_at=now(),last_error_code=left(p_error_code,200),
    last_error_message=left(p_error_message,2000),status=CASE WHEN v_dead THEN 'error' ELSE status END,updated_at=now()
  WHERE id=v_row.connection_id AND aces_id=v_row.aces_id;
  RETURN CASE WHEN v_dead THEN 'dead_letter' ELSE 'retry' END;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.connection_metrics(p_aces_id integer, p_connection_id uuid)
RETURNS TABLE(queue_depth bigint, oldest_event_age_seconds bigint, success_count bigint,
  retry_count bigint, dead_letter_count bigint, average_latency_ms numeric, seconds_since_last_success bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT
    count(*) FILTER (WHERE o.status IN ('pending','delivering')),
    floor(extract(epoch FROM now()-min(o.created_at) FILTER (WHERE o.status IN ('pending','delivering'))))::bigint,
    (SELECT count(*) FROM agenda_sync.deliveries d WHERE d.aces_id=p_aces_id AND d.connection_id=p_connection_id AND d.outcome='delivered'),
    (SELECT count(*) FROM agenda_sync.deliveries d WHERE d.aces_id=p_aces_id AND d.connection_id=p_connection_id AND d.outcome='retry'),
    count(*) FILTER (WHERE o.status='dead_letter'),
    (SELECT round(avg(d.duration_ms),2) FROM agenda_sync.deliveries d WHERE d.aces_id=p_aces_id AND d.connection_id=p_connection_id AND d.outcome='delivered'),
    floor(extract(epoch FROM now()-c.last_delivered_at))::bigint
  FROM agenda_sync.connections c LEFT JOIN agenda_sync.outbox o
    ON o.connection_id=c.id AND o.aces_id=c.aces_id
  WHERE c.aces_id=p_aces_id AND c.id=p_connection_id GROUP BY c.last_delivered_at
$$;

REVOKE ALL ON FUNCTION agenda_sync.next_resource_version(integer,text,uuid) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.capture_appointment_change() FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.appointment_resource(uuid,integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.patient_resource(uuid,integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.connection_covers_assignment(uuid,integer,uuid) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.enqueue_for_connection(uuid,integer,text,text,uuid,bigint,jsonb,timestamptz) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.claim_delivery(text,integer,integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.renew_delivery_lease(uuid,text,integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.finish_delivery(uuid,text,timestamptz,integer,integer,text) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.fail_delivery(uuid,text,timestamptz,integer,integer,text,text,boolean,timestamptz) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.connection_metrics(integer,uuid) FROM PUBLIC,anon,authenticated,authenticator;

GRANT EXECUTE ON FUNCTION agenda_sync.next_resource_version(integer,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.appointment_resource(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.patient_resource(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.connection_covers_assignment(uuid,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.enqueue_for_connection(uuid,integer,text,text,uuid,bigint,jsonb,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.claim_delivery(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.renew_delivery_lease(uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.finish_delivery(uuid,text,timestamptz,integer,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.fail_delivery(uuid,text,timestamptz,integer,integer,text,text,boolean,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.connection_metrics(integer,uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
