-- Agenda Universal checkpoints 5/6: durable resync, operational recovery,
-- retention, inbound throttling and the remaining resource captures.

CREATE TABLE agenda_sync.resync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  requested_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'units',
  cursor_id uuid,
  fence_sequence bigint NOT NULL,
  snapshot_count bigint NOT NULL DEFAULT 0,
  delta_count bigint NOT NULL DEFAULT 0,
  locked_at timestamptz,
  locked_until timestamptz,
  locked_by text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_resync_runs_connection_fk FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_resync_runs_status_check CHECK (status IN
    ('queued','snapshotting','flushing_deltas','awaiting_delivery','completed','failed','cancelled')),
  CONSTRAINT agenda_resync_runs_stage_check CHECK (stage IN
    ('units','professionals','availability','patients','appointments','deltas','delivery','complete')),
  CONSTRAINT agenda_resync_runs_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  CONSTRAINT agenda_resync_runs_counts_check CHECK (snapshot_count >= 0 AND delta_count >= 0),
  CONSTRAINT agenda_resync_runs_error_length CHECK (error_message IS NULL OR length(error_message) <= 2000)
);

CREATE UNIQUE INDEX agenda_resync_runs_one_active_idx
  ON agenda_sync.resync_runs(connection_id)
  WHERE status IN ('queued','snapshotting','flushing_deltas','awaiting_delivery');
CREATE INDEX agenda_resync_runs_claim_idx
  ON agenda_sync.resync_runs(status, locked_until, created_at)
  WHERE status IN ('queued','snapshotting','flushing_deltas');

CREATE TABLE agenda_sync.resync_deltas (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES agenda_sync.resync_runs(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  resource_version bigint NOT NULL,
  envelope jsonb NOT NULL,
  payload_hash text NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_resync_deltas_connection_fk FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_resync_deltas_run_event_unique UNIQUE (run_id, event_id),
  CONSTRAINT agenda_resync_deltas_version_check CHECK (resource_version > 0),
  CONSTRAINT agenda_resync_deltas_envelope_check CHECK (jsonb_typeof(envelope) = 'object'),
  CONSTRAINT agenda_resync_deltas_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX agenda_resync_deltas_flush_idx ON agenda_sync.resync_deltas(run_id, id);

CREATE TABLE agenda_sync.inbound_rate_limits (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  ip_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, ip_hash, window_started_at),
  CONSTRAINT agenda_inbound_rate_connection_fk FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_inbound_rate_hash_check CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT agenda_inbound_rate_count_check CHECK (request_count > 0)
);
CREATE INDEX agenda_inbound_rate_cleanup_idx ON agenda_sync.inbound_rate_limits(updated_at);

ALTER TABLE agenda_sync.outbox
  ADD COLUMN resync_run_id uuid REFERENCES agenda_sync.resync_runs(id) ON DELETE SET NULL,
  ADD COLUMN resync_phase text,
  ADD CONSTRAINT agenda_outbox_resync_phase_check CHECK (
    (resync_run_id IS NULL AND resync_phase IS NULL)
    OR (resync_run_id IS NOT NULL AND resync_phase IN ('snapshot','delta'))
  );
CREATE INDEX agenda_outbox_resync_terminal_idx
  ON agenda_sync.outbox(resync_run_id, status) WHERE resync_run_id IS NOT NULL;

ALTER TABLE agenda_sync.deliveries DROP CONSTRAINT agenda_deliveries_outbox_fk;
ALTER TABLE agenda_sync.deliveries ALTER COLUMN outbox_id DROP NOT NULL;
ALTER TABLE agenda_sync.deliveries ADD CONSTRAINT agenda_deliveries_outbox_fk
  FOREIGN KEY (outbox_id) REFERENCES agenda_sync.outbox(id) ON DELETE SET NULL;
ALTER TABLE agenda_sync.deliveries ADD COLUMN event_type text;
UPDATE agenda_sync.deliveries d SET event_type=o.event_type FROM agenda_sync.outbox o WHERE o.id=d.outbox_id;
CREATE INDEX agenda_deliveries_event_filter_idx
  ON agenda_sync.deliveries(aces_id,connection_id,event_type,created_at DESC);

CREATE OR REPLACE FUNCTION agenda_sync.fill_delivery_event_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.event_type IS NULL AND NEW.outbox_id IS NOT NULL THEN
    SELECT event_type INTO NEW.event_type FROM agenda_sync.outbox WHERE id=NEW.outbox_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_agenda_sync_fill_delivery_event_type BEFORE INSERT ON agenda_sync.deliveries
FOR EACH ROW EXECUTE FUNCTION agenda_sync.fill_delivery_event_type();

ALTER TABLE crm.notifications ADD COLUMN IF NOT EXISTS admin_only boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notifications_admin_feed
  ON crm.notifications(aces_id, published_at DESC) WHERE admin_only IS TRUE;

ALTER TABLE agenda_sync.resync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.resync_deltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.inbound_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agenda_sync.resync_runs, agenda_sync.resync_deltas,
  agenda_sync.inbound_rate_limits FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_sync.resync_runs,
  agenda_sync.resync_deltas, agenda_sync.inbound_rate_limits TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agenda_sync TO service_role;

DROP POLICY IF EXISTS notifications_read_accessible ON crm.notifications;
CREATE POLICY notifications_read_accessible ON crm.notifications
FOR SELECT TO authenticated
USING (
  published_at <= now()
  AND (NOT admin_only OR crm.current_user_is_account_admin())
  AND (
    (routing_event_id IS NULL AND (
      (category = 'notice' AND (aces_id IS NULL OR aces_id = public.current_aces_id()))
      OR (category = 'internal' AND aces_id = public.current_aces_id()
        AND lead_id IS NOT NULL AND crm.current_user_can_access_lead(lead_id))
    ))
    OR (routing_event_id IS NOT NULL AND aces_id = public.current_aces_id() AND (
      crm.current_user_is_account_admin() OR EXISTS (
        SELECT 1 FROM crm.routing_event_recipients recipient
        WHERE recipient.routing_event_id = notifications.routing_event_id
          AND recipient.aces_id = notifications.aces_id
          AND recipient.crm_user_id = public.current_crm_user_id()
      )
    ))
  )
);

CREATE OR REPLACE FUNCTION agenda_sync.unit_resource(p_unit_id uuid, p_aces_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', e.id, 'cnpj', e.cnpj, 'name', e.name, 'address', e.address,
    'city', e.city, 'state', e.state, 'isActive', e.is_active,
    'closures', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'type', x.exception_type, 'startsAt', to_char(x.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endsAt', to_char(x.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'reason', x.reason
    ) ORDER BY x.starts_at, x.id) FROM calendar.availability_exceptions x
      WHERE x.aces_id=e.aces_id AND x.empresa_id=e.id AND x.is_active), '[]'::jsonb),
    'metadata', e.agenda_metadata,
    'updatedAt', to_char(e.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedAt', NULL
  ) FROM crm.empresas e WHERE e.id=p_unit_id AND e.aces_id=p_aces_id
$$;

CREATE OR REPLACE FUNCTION agenda_sync.professional_resource(p_professional_id uuid, p_aces_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'name', p.name, 'specialty', p.specialty, 'isActive', p.is_active,
    'assignments', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'assignmentId', pl.id, 'unitId', pl.empresa_id, 'locationName', pl.location_name,
      'isActive', pl.is_active) ORDER BY pl.id)
      FROM calendar.professional_locations pl
      WHERE pl.aces_id=p.aces_id AND pl.professional_id=p.id), '[]'::jsonb),
    'metadata', p.agenda_metadata,
    'updatedAt', to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedAt', NULL
  ) FROM calendar.professionals p WHERE p.id=p_professional_id AND p.aces_id=p_aces_id
$$;

CREATE OR REPLACE FUNCTION agenda_sync.availability_resource(p_assignment_id uuid, p_aces_id integer)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'assignmentId', pl.id, 'professionalId', pl.professional_id, 'unitId', pl.empresa_id,
    'timezone', COALESCE(s.timezone,'America/Sao_Paulo'),
    'weeklyGrid', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'weekday', r.weekday, 'startTime', to_char(r.start_time,'HH24:MI'),
      'endTime', to_char(r.end_time,'HH24:MI'), 'validFrom', r.valid_from, 'validUntil', r.valid_until
    ) ORDER BY r.weekday,r.start_time,r.id) FROM calendar.availability_rules r
      WHERE r.aces_id=pl.aces_id AND r.professional_location_id=pl.id AND r.is_active), '[]'::jsonb),
    'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'type', x.exception_type, 'startsAt', to_char(x.starts_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endsAt', to_char(x.ends_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'reason', x.reason
    ) ORDER BY x.starts_at,x.id) FROM calendar.availability_exceptions x
      WHERE x.aces_id=pl.aces_id AND (x.professional_location_id=pl.id OR x.empresa_id=pl.empresa_id) AND x.is_active), '[]'::jsonb),
    'updatedAt', to_char(GREATEST(pl.updated_at,
      COALESCE((SELECT max(r.updated_at) FROM calendar.availability_rules r WHERE r.professional_location_id=pl.id),pl.updated_at),
      COALESCE((SELECT max(x.updated_at) FROM calendar.availability_exceptions x
        WHERE x.professional_location_id=pl.id OR x.empresa_id=pl.empresa_id),pl.updated_at),
      COALESCE(s.updated_at,pl.updated_at)) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) FROM calendar.professional_locations pl
  LEFT JOIN calendar.settings s ON s.aces_id=pl.aces_id
  WHERE pl.id=p_assignment_id AND pl.aces_id=p_aces_id
$$;

CREATE OR REPLACE FUNCTION agenda_sync.connection_covers_unit(
  p_connection_id uuid, p_aces_id integer, p_unit_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM agenda_sync.connections c
    WHERE c.id=p_connection_id AND c.aces_id=p_aces_id AND (
      c.scope_mode='all_resources' OR EXISTS(SELECT 1 FROM agenda_sync.connection_units cu
        WHERE cu.connection_id=c.id AND cu.aces_id=c.aces_id AND cu.unit_id=p_unit_id)))
$$;

CREATE OR REPLACE FUNCTION agenda_sync.connection_covers_professional(
  p_connection_id uuid, p_aces_id integer, p_professional_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM calendar.professional_locations pl
    WHERE pl.aces_id=p_aces_id AND pl.professional_id=p_professional_id
      AND agenda_sync.connection_covers_assignment(p_connection_id,p_aces_id,pl.id))
$$;

CREATE OR REPLACE FUNCTION agenda_sync.enqueue_direct(
  p_connection_id uuid, p_aces_id integer, p_event_id uuid, p_event_type text,
  p_resource_type text, p_resource_id uuid, p_resource_version bigint,
  p_envelope jsonb, p_payload_hash text, p_resync_run_id uuid DEFAULT NULL,
  p_resync_phase text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_sequence bigint;
BEGIN
  UPDATE agenda_sync.connections SET next_sequence=next_sequence+1,updated_at=now()
  WHERE id=p_connection_id AND aces_id=p_aces_id RETURNING next_sequence INTO v_sequence;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND'; END IF;
  INSERT INTO agenda_sync.outbox(connection_id,aces_id,sequence,event_id,event_type,
    resource_type,resource_id,resource_version,envelope,payload_hash,resync_run_id,resync_phase)
  VALUES(p_connection_id,p_aces_id,v_sequence,p_event_id,p_event_type,p_resource_type,
    p_resource_id,p_resource_version,p_envelope,p_payload_hash,p_resync_run_id,p_resync_phase);
  RETURN p_event_id;
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.enqueue_for_connection(
  p_connection_id uuid, p_aces_id integer, p_event_type text, p_resource_type text,
  p_resource_id uuid, p_resource_version bigint, p_resource jsonb,
  p_occurred_at timestamptz DEFAULT clock_timestamp()
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_event_id uuid:=gen_random_uuid(); v_envelope jsonb; v_hash text;
  v_run agenda_sync.resync_runs%ROWTYPE;
BEGIN
  PERFORM 1 FROM agenda_sync.connections WHERE id=p_connection_id AND aces_id=p_aces_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND'; END IF;
  v_envelope:=jsonb_build_object('schemaVersion','1.0','eventId',v_event_id,
    'eventType',p_event_type,'occurredAt',to_char(p_occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'resourceVersion',p_resource_version,'resource',p_resource);
  v_hash:=encode(extensions.digest(convert_to(v_envelope::text,'UTF8'),'sha256'),'hex');
  SELECT * INTO v_run FROM agenda_sync.resync_runs
    WHERE connection_id=p_connection_id AND status IN ('queued','snapshotting','flushing_deltas','awaiting_delivery')
    ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND AND v_run.status IN ('queued','snapshotting','flushing_deltas') THEN
    INSERT INTO agenda_sync.resync_deltas(run_id,connection_id,aces_id,event_id,event_type,
      resource_type,resource_id,resource_version,envelope,payload_hash,occurred_at)
    VALUES(v_run.id,p_connection_id,p_aces_id,v_event_id,p_event_type,p_resource_type,
      p_resource_id,p_resource_version,v_envelope,v_hash,p_occurred_at);
    UPDATE agenda_sync.resync_runs SET delta_count=delta_count+1,updated_at=now() WHERE id=v_run.id;
    RETURN v_event_id;
  END IF;
  RETURN agenda_sync.enqueue_direct(p_connection_id,p_aces_id,v_event_id,p_event_type,
    p_resource_type,p_resource_id,p_resource_version,v_envelope,v_hash,
    CASE WHEN FOUND THEN v_run.id ELSE NULL END,CASE WHEN FOUND THEN 'delta' ELSE NULL END);
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.emit_resource(
  p_aces_id integer, p_event_type text, p_resource_type text, p_resource_id uuid,
  p_resource jsonb, p_assignment_id uuid DEFAULT NULL, p_unit_id uuid DEFAULT NULL,
  p_professional_id uuid DEFAULT NULL, p_origin_connection_id uuid DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT clock_timestamp()
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_version bigint; v_connection record;
BEGIN
  IF p_resource IS NULL THEN RETURN 0; END IF;
  v_version:=agenda_sync.next_resource_version(p_aces_id,p_resource_type,p_resource_id);
  FOR v_connection IN SELECT c.id FROM agenda_sync.connections c
    WHERE c.aces_id=p_aces_id AND c.status IN ('active','syncing')
      AND c.id IS DISTINCT FROM p_origin_connection_id
      AND (p_assignment_id IS NOT NULL AND agenda_sync.connection_covers_assignment(c.id,p_aces_id,p_assignment_id)
        OR p_unit_id IS NOT NULL AND agenda_sync.connection_covers_unit(c.id,p_aces_id,p_unit_id)
        OR p_professional_id IS NOT NULL AND agenda_sync.connection_covers_professional(c.id,p_aces_id,p_professional_id))
    ORDER BY c.id FOR UPDATE
  LOOP
    PERFORM agenda_sync.enqueue_for_connection(v_connection.id,p_aces_id,p_event_type,
      p_resource_type,p_resource_id,v_version,p_resource,p_occurred_at);
  END LOOP;
  RETURN v_version;
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.capture_unit_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row crm.empresas%ROWTYPE; v_resource jsonb; v_at timestamptz:=clock_timestamp();
BEGIN
  v_row:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
  v_resource:=agenda_sync.unit_resource(v_row.id,v_row.aces_id);
  IF v_resource IS NULL THEN
    v_resource:=jsonb_build_object('id',v_row.id,'cnpj',v_row.cnpj,'name',v_row.name,
      'address',v_row.address,'city',v_row.city,'state',v_row.state,'isActive',false,
      'closures','[]'::jsonb,'metadata',COALESCE(v_row.agenda_metadata,'{}'::jsonb),
      'updatedAt',to_char(v_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deletedAt',to_char(v_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  PERFORM agenda_sync.emit_resource(v_row.aces_id,'unit.upserted','unit',v_row.id,v_resource,
    p_unit_id=>v_row.id,p_occurred_at=>v_at);
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_unit ON crm.empresas;
CREATE TRIGGER trg_agenda_sync_capture_unit AFTER INSERT OR UPDATE OR DELETE ON crm.empresas
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_unit_change();

CREATE OR REPLACE FUNCTION agenda_sync.capture_professional_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_aces_id integer; v_professional_id uuid; v_resource jsonb; v_at timestamptz:=clock_timestamp();
  v_assignment record;
BEGIN
  IF TG_TABLE_NAME='professionals' THEN
    v_aces_id:=COALESCE(NEW.aces_id,OLD.aces_id); v_professional_id:=COALESCE(NEW.id,OLD.id);
  ELSE
    v_aces_id:=COALESCE(NEW.aces_id,OLD.aces_id); v_professional_id:=COALESCE(NEW.professional_id,OLD.professional_id);
  END IF;
  v_resource:=agenda_sync.professional_resource(v_professional_id,v_aces_id);
  IF v_resource IS NULL AND TG_TABLE_NAME='professionals' THEN
    v_resource:=jsonb_build_object('id',OLD.id,'name',OLD.name,'specialty',OLD.specialty,
      'isActive',false,'assignments','[]'::jsonb,'metadata',COALESCE(OLD.agenda_metadata,'{}'::jsonb),
      'updatedAt',to_char(v_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'deletedAt',to_char(v_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  END IF;
  PERFORM agenda_sync.emit_resource(v_aces_id,'professional.upserted','professional',v_professional_id,
    v_resource,p_professional_id=>v_professional_id,p_occurred_at=>v_at);
  IF TG_TABLE_NAME='professional_locations' THEN
    v_assignment:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
    v_resource:=agenda_sync.availability_resource(v_assignment.id,v_aces_id);
    IF v_resource IS NULL THEN
      v_resource:=jsonb_build_object('assignmentId',v_assignment.id,'professionalId',v_assignment.professional_id,
        'unitId',v_assignment.empresa_id,'timezone','America/Sao_Paulo','weeklyGrid','[]'::jsonb,
        'exceptions','[]'::jsonb,'updatedAt',to_char(v_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    END IF;
    PERFORM agenda_sync.emit_resource(v_aces_id,'availability.upserted','availability',v_assignment.id,
      v_resource,p_assignment_id=>v_assignment.id,p_unit_id=>v_assignment.empresa_id,p_occurred_at=>v_at);
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_professional ON calendar.professionals;
CREATE TRIGGER trg_agenda_sync_capture_professional AFTER INSERT OR UPDATE OR DELETE ON calendar.professionals
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_professional_change();
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_assignment ON calendar.professional_locations;
CREATE TRIGGER trg_agenda_sync_capture_assignment AFTER INSERT OR UPDATE OR DELETE ON calendar.professional_locations
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_professional_change();

CREATE OR REPLACE FUNCTION agenda_sync.capture_availability_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_aces_id integer:=COALESCE(NEW.aces_id,OLD.aces_id); v_assignment_id uuid;
  v_unit_id uuid; v_resource jsonb; v_row record; v_at timestamptz:=clock_timestamp();
BEGIN
  IF TG_TABLE_NAME='availability_rules' THEN
    v_assignment_id:=COALESCE(NEW.professional_location_id,OLD.professional_location_id);
    v_resource:=agenda_sync.availability_resource(v_assignment_id,v_aces_id);
    PERFORM agenda_sync.emit_resource(v_aces_id,'availability.upserted','availability',v_assignment_id,
      v_resource,p_assignment_id=>v_assignment_id,p_occurred_at=>v_at);
  ELSIF TG_TABLE_NAME='availability_exceptions' THEN
    v_assignment_id:=COALESCE(NEW.professional_location_id,OLD.professional_location_id);
    v_unit_id:=COALESCE(NEW.empresa_id,OLD.empresa_id);
    IF v_assignment_id IS NOT NULL THEN
      v_resource:=agenda_sync.availability_resource(v_assignment_id,v_aces_id);
      PERFORM agenda_sync.emit_resource(v_aces_id,'availability.upserted','availability',v_assignment_id,
        v_resource,p_assignment_id=>v_assignment_id,p_occurred_at=>v_at);
    ELSE
      FOR v_row IN SELECT pl.id FROM calendar.professional_locations pl
        WHERE pl.aces_id=v_aces_id AND pl.empresa_id=v_unit_id ORDER BY pl.id
      LOOP
        v_resource:=agenda_sync.availability_resource(v_row.id,v_aces_id);
        PERFORM agenda_sync.emit_resource(v_aces_id,'availability.upserted','availability',v_row.id,
          v_resource,p_assignment_id=>v_row.id,p_occurred_at=>v_at);
      END LOOP;
      v_resource:=agenda_sync.unit_resource(v_unit_id,v_aces_id);
      PERFORM agenda_sync.emit_resource(v_aces_id,'unit.upserted','unit',v_unit_id,v_resource,
        p_unit_id=>v_unit_id,p_occurred_at=>v_at);
    END IF;
  ELSE
    FOR v_row IN SELECT pl.id FROM calendar.professional_locations pl
      WHERE pl.aces_id=v_aces_id ORDER BY pl.id
    LOOP
      v_resource:=agenda_sync.availability_resource(v_row.id,v_aces_id);
      PERFORM agenda_sync.emit_resource(v_aces_id,'availability.upserted','availability',v_row.id,
        v_resource,p_assignment_id=>v_row.id,p_occurred_at=>v_at);
    END LOOP;
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_availability_rule ON calendar.availability_rules;
CREATE TRIGGER trg_agenda_sync_capture_availability_rule AFTER INSERT OR UPDATE OR DELETE ON calendar.availability_rules
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_availability_change();
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_availability_exception ON calendar.availability_exceptions;
CREATE TRIGGER trg_agenda_sync_capture_availability_exception AFTER INSERT OR UPDATE OR DELETE ON calendar.availability_exceptions
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_availability_change();
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_calendar_settings ON calendar.settings;
CREATE TRIGGER trg_agenda_sync_capture_calendar_settings AFTER INSERT OR UPDATE OR DELETE ON calendar.settings
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_availability_change();

CREATE OR REPLACE FUNCTION agenda_sync.capture_patient_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row crm.leads%ROWTYPE:=COALESCE(NEW,OLD); v_resource jsonb; v_version bigint;
  v_connection record; v_at timestamptz:=clock_timestamp();
BEGIN
  IF TG_OP='UPDATE' AND NEW.name IS NOT DISTINCT FROM OLD.name
    AND NEW.contact_phone IS NOT DISTINCT FROM OLD.contact_phone
    AND NEW.empresa_id IS NOT DISTINCT FROM OLD.empresa_id THEN RETURN NEW; END IF;
  v_resource:=agenda_sync.patient_resource(v_row.id,v_row.aces_id);
  IF v_resource IS NULL THEN RETURN COALESCE(NEW,OLD); END IF;
  v_version:=agenda_sync.next_resource_version(v_row.aces_id,'patient',v_row.id);
  FOR v_connection IN SELECT DISTINCT c.id FROM agenda_sync.connections c
    JOIN calendar.events e ON e.aces_id=c.aces_id AND e.lead_id=v_row.id
      AND e.deleted_at IS NULL AND e.professional_location_id IS NOT NULL
    WHERE c.aces_id=v_row.aces_id AND c.status IN ('active','syncing')
      AND agenda_sync.connection_covers_assignment(c.id,c.aces_id,e.professional_location_id)
    ORDER BY c.id
  LOOP
    PERFORM agenda_sync.enqueue_for_connection(v_connection.id,v_row.aces_id,'patient.upserted',
      'patient',v_row.id,v_version,v_resource,v_at);
  END LOOP;
  RETURN COALESCE(NEW,OLD);
END $$;
DROP TRIGGER IF EXISTS trg_agenda_sync_capture_patient ON crm.leads;
CREATE TRIGGER trg_agenda_sync_capture_patient AFTER UPDATE ON crm.leads
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_patient_change();

CREATE OR REPLACE FUNCTION agenda_sync.start_resync(
  p_aces_id integer,p_actor_id uuid,p_connection_id uuid,p_reason text DEFAULT 'manual'
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_connection agenda_sync.connections%ROWTYPE; v_run_id uuid;
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id,p_actor_id);
  IF NULLIF(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))>2000 THEN
    RAISE EXCEPTION 'AGENDA_RESYNC_REASON_INVALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_connection FROM agenda_sync.connections
    WHERE id=p_connection_id AND aces_id=p_aces_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_connection.status NOT IN ('active','syncing','error') THEN
    RAISE EXCEPTION 'AGENDA_RESYNC_STATUS_INVALID' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM agenda_sync.outbox WHERE connection_id=p_connection_id AND status='dead_letter') THEN
    RAISE EXCEPTION 'AGENDA_DEAD_LETTER_BLOCKS_RESYNC' USING ERRCODE='23514'; END IF;
  INSERT INTO agenda_sync.resync_runs(connection_id,aces_id,requested_by,reason,fence_sequence)
  VALUES(p_connection_id,p_aces_id,p_actor_id,btrim(p_reason),v_connection.next_sequence) RETURNING id INTO v_run_id;
  UPDATE agenda_sync.connections SET status='syncing',resync_watermark=v_connection.next_sequence,
    resync_started_at=now(),resync_completed_at=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=now()
    WHERE id=p_connection_id;
  INSERT INTO agenda_sync.connection_audit(connection_id,aces_id,actor_id,action,details)
    VALUES(p_connection_id,p_aces_id,p_actor_id,'resync_started',jsonb_build_object('runId',v_run_id,'reason',btrim(p_reason)));
  RETURN v_run_id;
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.enqueue_snapshot_resource(
  p_run_id uuid,p_connection_id uuid,p_aces_id integer,p_event_type text,p_resource_type text,
  p_resource_id uuid,p_resource jsonb,p_occurred_at timestamptz
) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_version bigint; v_event_id uuid:=gen_random_uuid(); v_envelope jsonb; v_hash text;
BEGIN
  v_version:=agenda_sync.next_resource_version(p_aces_id,p_resource_type,p_resource_id);
  v_envelope:=jsonb_build_object('schemaVersion','1.0','eventId',v_event_id,'eventType',p_event_type,
    'occurredAt',to_char(p_occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'resourceVersion',v_version,'resource',p_resource);
  v_hash:=encode(extensions.digest(convert_to(v_envelope::text,'UTF8'),'sha256'),'hex');
  RETURN agenda_sync.enqueue_direct(p_connection_id,p_aces_id,v_event_id,p_event_type,p_resource_type,
    p_resource_id,v_version,v_envelope,v_hash,p_run_id,'snapshot');
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.claim_resync_batch(
  p_worker_id text,p_lease_seconds integer DEFAULT 60,p_limit integer DEFAULT 100
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_run agenda_sync.resync_runs%ROWTYPE; v_item record; v_resource jsonb;
  v_count integer:=0; v_limit integer:=LEAST(GREATEST(COALESCE(p_limit,100),1),100);
  v_next_stage text;
BEGIN
  SELECT r.* INTO v_run FROM agenda_sync.resync_runs r
  JOIN agenda_sync.connections c ON c.id=r.connection_id AND c.aces_id=r.aces_id
  WHERE r.status IN ('queued','snapshotting','flushing_deltas') AND c.status='syncing'
    AND (r.locked_until IS NULL OR r.locked_until<now())
  ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE agenda_sync.resync_runs SET status=CASE WHEN status='queued' THEN 'snapshotting' ELSE status END,
    locked_at=now(),locked_until=now()+make_interval(secs=>LEAST(GREATEST(p_lease_seconds,10),600)),
    locked_by=p_worker_id,updated_at=now() WHERE id=v_run.id;
  IF v_run.status='queued' THEN v_run.status:='snapshotting'; END IF;

  IF v_run.status='flushing_deltas' THEN
    FOR v_item IN SELECT * FROM agenda_sync.resync_deltas d WHERE d.run_id=v_run.id
      ORDER BY d.id FOR UPDATE SKIP LOCKED LIMIT v_limit
    LOOP
      PERFORM agenda_sync.enqueue_direct(v_item.connection_id,v_item.aces_id,v_item.event_id,
        v_item.event_type,v_item.resource_type,v_item.resource_id,v_item.resource_version,
        v_item.envelope,v_item.payload_hash,v_run.id,'delta');
      DELETE FROM agenda_sync.resync_deltas WHERE id=v_item.id;
      v_count:=v_count+1;
    END LOOP;
    IF NOT EXISTS(SELECT 1 FROM agenda_sync.resync_deltas WHERE run_id=v_run.id) THEN
      UPDATE agenda_sync.resync_runs SET status='awaiting_delivery',stage='delivery',cursor_id=NULL,
        locked_at=NULL,locked_until=NULL,locked_by=NULL,updated_at=now() WHERE id=v_run.id;
    ELSE
      UPDATE agenda_sync.resync_runs SET locked_at=NULL,locked_until=NULL,locked_by=NULL,updated_at=now()
        WHERE id=v_run.id;
    END IF;
    RETURN jsonb_build_object('runId',v_run.id,'stage','deltas','processed',v_count);
  END IF;

  IF v_run.stage='units' THEN
    FOR v_item IN SELECT e.id FROM crm.empresas e WHERE e.aces_id=v_run.aces_id
      AND e.id>COALESCE(v_run.cursor_id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND (EXISTS(SELECT 1 FROM agenda_sync.connections c WHERE c.id=v_run.connection_id AND c.scope_mode='all_resources')
        OR agenda_sync.connection_covers_unit(v_run.connection_id,v_run.aces_id,e.id))
      ORDER BY e.id LIMIT v_limit
    LOOP
      v_resource:=agenda_sync.unit_resource(v_item.id,v_run.aces_id);
      PERFORM agenda_sync.enqueue_snapshot_resource(v_run.id,v_run.connection_id,v_run.aces_id,
        'unit.upserted','unit',v_item.id,v_resource,v_run.started_at);
      v_run.cursor_id:=v_item.id; v_count:=v_count+1;
    END LOOP; v_next_stage:='professionals';
  ELSIF v_run.stage='professionals' THEN
    FOR v_item IN SELECT p.id FROM calendar.professionals p WHERE p.aces_id=v_run.aces_id
      AND p.id>COALESCE(v_run.cursor_id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND agenda_sync.connection_covers_professional(v_run.connection_id,v_run.aces_id,p.id)
      ORDER BY p.id LIMIT v_limit
    LOOP
      v_resource:=agenda_sync.professional_resource(v_item.id,v_run.aces_id);
      PERFORM agenda_sync.enqueue_snapshot_resource(v_run.id,v_run.connection_id,v_run.aces_id,
        'professional.upserted','professional',v_item.id,v_resource,v_run.started_at);
      v_run.cursor_id:=v_item.id; v_count:=v_count+1;
    END LOOP; v_next_stage:='availability';
  ELSIF v_run.stage='availability' THEN
    FOR v_item IN SELECT pl.id FROM calendar.professional_locations pl WHERE pl.aces_id=v_run.aces_id
      AND pl.id>COALESCE(v_run.cursor_id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND agenda_sync.connection_covers_assignment(v_run.connection_id,v_run.aces_id,pl.id)
      ORDER BY pl.id LIMIT v_limit
    LOOP
      v_resource:=agenda_sync.availability_resource(v_item.id,v_run.aces_id);
      PERFORM agenda_sync.enqueue_snapshot_resource(v_run.id,v_run.connection_id,v_run.aces_id,
        'availability.upserted','availability',v_item.id,v_resource,v_run.started_at);
      v_run.cursor_id:=v_item.id; v_count:=v_count+1;
    END LOOP; v_next_stage:='patients';
  ELSIF v_run.stage='patients' THEN
    FOR v_item IN SELECT DISTINCT l.id FROM crm.leads l JOIN calendar.events e
      ON e.aces_id=l.aces_id AND e.lead_id=l.id AND e.deleted_at IS NULL
      WHERE l.aces_id=v_run.aces_id AND l.id>COALESCE(v_run.cursor_id,'00000000-0000-0000-0000-000000000000'::uuid)
        AND e.professional_location_id IS NOT NULL
        AND agenda_sync.connection_covers_assignment(v_run.connection_id,v_run.aces_id,e.professional_location_id)
      ORDER BY l.id LIMIT v_limit
    LOOP
      v_resource:=agenda_sync.patient_resource(v_item.id,v_run.aces_id);
      PERFORM agenda_sync.enqueue_snapshot_resource(v_run.id,v_run.connection_id,v_run.aces_id,
        'patient.upserted','patient',v_item.id,v_resource,v_run.started_at);
      v_run.cursor_id:=v_item.id; v_count:=v_count+1;
    END LOOP; v_next_stage:='appointments';
  ELSIF v_run.stage='appointments' THEN
    FOR v_item IN SELECT e.id FROM calendar.events e WHERE e.aces_id=v_run.aces_id
      AND e.id>COALESCE(v_run.cursor_id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND e.deleted_at IS NULL AND e.status IN ('scheduled','confirmed') AND e.end_time>=v_run.started_at
      AND e.professional_location_id IS NOT NULL AND e.service_id IS NOT NULL
      AND agenda_sync.connection_covers_assignment(v_run.connection_id,v_run.aces_id,e.professional_location_id)
      ORDER BY e.id LIMIT v_limit
    LOOP
      v_resource:=agenda_sync.appointment_resource(v_item.id,v_run.aces_id);
      PERFORM agenda_sync.enqueue_snapshot_resource(v_run.id,v_run.connection_id,v_run.aces_id,
        'appointment.created','appointment',v_item.id,v_resource,v_run.started_at);
      v_run.cursor_id:=v_item.id; v_count:=v_count+1;
    END LOOP; v_next_stage:='deltas';
  END IF;
  IF v_count<v_limit THEN
    UPDATE agenda_sync.resync_runs SET stage=v_next_stage,cursor_id=NULL,
      status=CASE WHEN v_next_stage='deltas' THEN 'flushing_deltas' ELSE 'snapshotting' END,
      snapshot_count=snapshot_count+v_count,locked_at=NULL,locked_until=NULL,locked_by=NULL,updated_at=now()
      WHERE id=v_run.id;
  ELSE
    UPDATE agenda_sync.resync_runs SET cursor_id=v_run.cursor_id,snapshot_count=snapshot_count+v_count,
      locked_at=NULL,locked_until=NULL,locked_by=NULL,updated_at=now() WHERE id=v_run.id;
  END IF;
  RETURN jsonb_build_object('runId',v_run.id,'stage',v_run.stage,'processed',v_count);
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.finalize_resyncs()
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_run agenda_sync.resync_runs%ROWTYPE; v_count integer:=0;
BEGIN
  FOR v_run IN SELECT * FROM agenda_sync.resync_runs WHERE status='awaiting_delivery'
    ORDER BY created_at FOR UPDATE SKIP LOCKED
  LOOP
    IF EXISTS(SELECT 1 FROM agenda_sync.outbox WHERE resync_run_id=v_run.id AND status='dead_letter') THEN
      UPDATE agenda_sync.resync_runs SET status='failed',stage='delivery',failed_at=now(),
        error_code='dead_letter',error_message='Uma entrega da ressincronizacao exige atencao',updated_at=now()
        WHERE id=v_run.id;
      UPDATE agenda_sync.connections SET status='error',last_error_code='dead_letter',
        last_error_message='Uma entrega da ressincronizacao exige atencao',updated_at=now()
        WHERE id=v_run.connection_id AND aces_id=v_run.aces_id;
    ELSIF NOT EXISTS(SELECT 1 FROM agenda_sync.outbox WHERE resync_run_id=v_run.id
      AND status IN ('pending','delivering'))
      AND NOT EXISTS(SELECT 1 FROM agenda_sync.resync_deltas WHERE run_id=v_run.id) THEN
      UPDATE agenda_sync.resync_runs SET status='completed',stage='complete',completed_at=now(),updated_at=now()
        WHERE id=v_run.id;
      UPDATE agenda_sync.connections SET status='active',resync_completed_at=now(),last_error_at=NULL,
        last_error_code=NULL,last_error_message=NULL,updated_at=now()
        WHERE id=v_run.connection_id AND aces_id=v_run.aces_id AND status='syncing';
      v_count:=v_count+1;
    END IF;
  END LOOP; RETURN v_count;
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.resolve_dead_letter(
  p_aces_id integer,p_actor_id uuid,p_connection_id uuid,p_outbox_id uuid,
  p_resolution text,p_reason text
) RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_row agenda_sync.outbox%ROWTYPE; v_active_run uuid; v_status text;
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id,p_actor_id);
  IF p_resolution NOT IN ('retry','skip') THEN RAISE EXCEPTION 'AGENDA_RESOLUTION_INVALID' USING ERRCODE='22023'; END IF;
  IF NULLIF(btrim(p_reason),'') IS NULL OR length(btrim(p_reason))>2000 THEN
    RAISE EXCEPTION 'AGENDA_RESOLUTION_REASON_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO v_row FROM agenda_sync.outbox WHERE id=p_outbox_id AND connection_id=p_connection_id
    AND aces_id=p_aces_id AND status='dead_letter' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_DEAD_LETTER_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF EXISTS(SELECT 1 FROM agenda_sync.outbox o WHERE o.connection_id=p_connection_id
    AND o.sequence<v_row.sequence AND o.status IN ('pending','delivering','dead_letter')) THEN
    RAISE EXCEPTION 'AGENDA_DEAD_LETTER_NOT_HEAD' USING ERRCODE='55000'; END IF;
  IF p_resolution='retry' THEN
    UPDATE agenda_sync.outbox SET status='pending',attempt_count=0,first_attempt_at=NULL,
      available_at=now(),locked_at=NULL,locked_until=NULL,locked_by=NULL,dead_lettered_at=NULL,
      last_http_status=NULL,last_error_code=NULL,last_error_message=NULL,resolved_at=now(),
      resolved_by=p_actor_id,resolution='retry',resolution_reason=btrim(p_reason),updated_at=now()
      WHERE id=v_row.id;
  ELSE
    UPDATE agenda_sync.outbox SET status='skipped',locked_at=NULL,locked_until=NULL,locked_by=NULL,
      resolved_at=now(),resolved_by=p_actor_id,resolution='skip',resolution_reason=btrim(p_reason),updated_at=now()
      WHERE id=v_row.id;
  END IF;
  SELECT id INTO v_active_run FROM agenda_sync.resync_runs WHERE connection_id=p_connection_id
    AND status IN ('queued','snapshotting','flushing_deltas','awaiting_delivery') ORDER BY created_at DESC LIMIT 1;
  v_status:=CASE WHEN v_active_run IS NULL THEN 'active' ELSE 'syncing' END;
  IF NOT EXISTS(SELECT 1 FROM agenda_sync.outbox WHERE connection_id=p_connection_id AND status='dead_letter' AND id<>v_row.id) THEN
    UPDATE agenda_sync.connections SET status=v_status,last_error_at=NULL,last_error_code=NULL,last_error_message=NULL,updated_at=now()
      WHERE id=p_connection_id AND aces_id=p_aces_id;
  END IF;
  INSERT INTO agenda_sync.connection_audit(connection_id,aces_id,actor_id,action,details)
    VALUES(p_connection_id,p_aces_id,p_actor_id,'dead_letter_'||p_resolution,
      jsonb_build_object('outboxId',p_outbox_id,'eventId',v_row.event_id,'reason',btrim(p_reason)));
  RETURN p_resolution;
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.correct_appointment_status(
  p_aces_id integer,p_actor_id uuid,p_connection_id uuid,p_appointment_id uuid,
  p_status text,p_reason text
) RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_event calendar.events%ROWTYPE; v_version bigint;
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id,p_actor_id);
  IF p_status NOT IN ('cancelled','done','no_show') OR NULLIF(btrim(p_reason),'') IS NULL
    OR length(btrim(p_reason))>2000 THEN RAISE EXCEPTION 'AGENDA_CORRECTION_INVALID' USING ERRCODE='22023'; END IF;
  SELECT e.* INTO v_event FROM calendar.events e WHERE e.id=p_appointment_id AND e.aces_id=p_aces_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_APPOINTMENT_NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_event.status NOT IN ('cancelled','done','no_show') THEN
    RAISE EXCEPTION 'AGENDA_APPOINTMENT_NOT_TERMINAL' USING ERRCODE='55000'; END IF;
  IF NOT agenda_sync.connection_covers_assignment(p_connection_id,p_aces_id,v_event.professional_location_id) THEN
    RAISE EXCEPTION 'AGENDA_APPOINTMENT_OUT_OF_SCOPE' USING ERRCODE='42501'; END IF;
  UPDATE calendar.events SET status=p_status,cancel_reason=CASE WHEN p_status='cancelled' THEN btrim(p_reason) ELSE cancel_reason END,
    metadata=COALESCE(metadata,'{}'::jsonb)||jsonb_build_object('agendaCorrectionReason',btrim(p_reason),
      'agendaCorrectedBy',p_actor_id,'agendaCorrectedAt',to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    WHERE id=p_appointment_id;
  IF v_event.status=p_status THEN
    PERFORM agenda_sync.emit_resource(p_aces_id,
      CASE WHEN p_status='cancelled' THEN 'appointment.cancelled' ELSE 'appointment.status_changed' END,
      'appointment',p_appointment_id,agenda_sync.appointment_resource(p_appointment_id,p_aces_id),
      p_assignment_id=>v_event.professional_location_id,p_occurred_at=>clock_timestamp());
  END IF;
  SELECT version INTO v_version FROM agenda_sync.resource_versions
    WHERE aces_id=p_aces_id AND resource_type='appointment' AND resource_id=p_appointment_id;
  INSERT INTO agenda_sync.connection_audit(connection_id,aces_id,actor_id,action,details)
    VALUES(p_connection_id,p_aces_id,p_actor_id,'appointment_status_corrected',
      jsonb_build_object('appointmentId',p_appointment_id,'fromStatus',v_event.status,'toStatus',p_status,'reason',btrim(p_reason)));
  RETURN v_version;
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.consume_inbound_rate_limit(
  p_aces_id integer,p_connection_id uuid,p_ip text,p_limit integer DEFAULT 120
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_window timestamptz:=date_trunc('minute',now()); v_count integer; v_hash text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM agenda_sync.connections WHERE id=p_connection_id AND aces_id=p_aces_id) THEN
    RETURN false; END IF;
  v_hash:=encode(extensions.digest(convert_to(COALESCE(NULLIF(p_ip,''),'unknown'),'UTF8'),'sha256'),'hex');
  INSERT INTO agenda_sync.inbound_rate_limits(aces_id,connection_id,ip_hash,window_started_at,request_count)
  VALUES(p_aces_id,p_connection_id,v_hash,v_window,1)
  ON CONFLICT(connection_id,ip_hash,window_started_at) DO UPDATE SET
    request_count=agenda_sync.inbound_rate_limits.request_count+1,updated_at=now()
  RETURNING request_count INTO v_count;
  RETURN v_count<=LEAST(GREATEST(COALESCE(p_limit,120),1),10000);
END $$;

CREATE OR REPLACE FUNCTION agenda_sync.notify_dead_letter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_name text;
BEGIN
  IF NEW.status='dead_letter' AND OLD.status IS DISTINCT FROM 'dead_letter' THEN
    SELECT name INTO v_name FROM agenda_sync.connections WHERE id=NEW.connection_id AND aces_id=NEW.aces_id;
    INSERT INTO crm.notifications(aces_id,category,event_type,title,description,action_path,idempotency_key,admin_only)
    VALUES(NEW.aces_id,'notice','agenda.dead_letter','Agenda Universal requer atencao',
      COALESCE(v_name,'Conexao')||' possui uma entrega que precisa ser revisada.',
      '/conexoes?panel=agenda&connection='||NEW.connection_id,
      'agenda:dead-letter:'||NEW.id,true)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_agenda_sync_notify_dead_letter ON agenda_sync.outbox;
CREATE TRIGGER trg_agenda_sync_notify_dead_letter AFTER UPDATE OF status ON agenda_sync.outbox
FOR EACH ROW EXECUTE FUNCTION agenda_sync.notify_dead_letter();

CREATE OR REPLACE FUNCTION agenda_sync.cleanup_history(p_batch_size integer DEFAULT 5000)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_limit integer:=LEAST(GREATEST(COALESCE(p_batch_size,5000),1),50000);
  v_outbox integer;v_deliveries integer;v_inbound integer;v_audit integer;v_rate integer;
BEGIN
  WITH doomed AS (SELECT id FROM agenda_sync.outbox WHERE status IN ('delivered','skipped')
    AND updated_at<now()-interval '30 days' ORDER BY updated_at LIMIT v_limit)
  DELETE FROM agenda_sync.outbox o USING doomed d WHERE o.id=d.id; GET DIAGNOSTICS v_outbox=ROW_COUNT;
  WITH doomed AS (SELECT id FROM agenda_sync.deliveries WHERE created_at<now()-interval '90 days'
    ORDER BY created_at LIMIT v_limit)
  DELETE FROM agenda_sync.deliveries x USING doomed d WHERE x.id=d.id; GET DIAGNOSTICS v_deliveries=ROW_COUNT;
  WITH doomed AS (SELECT id FROM agenda_sync.inbound_events WHERE received_at<now()-interval '90 days'
    ORDER BY received_at LIMIT v_limit)
  DELETE FROM agenda_sync.inbound_events x USING doomed d WHERE x.id=d.id; GET DIAGNOSTICS v_inbound=ROW_COUNT;
  WITH doomed AS (SELECT id FROM agenda_sync.connection_audit WHERE created_at<now()-interval '365 days'
    ORDER BY created_at LIMIT v_limit)
  DELETE FROM agenda_sync.connection_audit x USING doomed d WHERE x.id=d.id; GET DIAGNOSTICS v_audit=ROW_COUNT;
  DELETE FROM agenda_sync.inbound_rate_limits WHERE updated_at<now()-interval '10 minutes'; GET DIAGNOSTICS v_rate=ROW_COUNT;
  RETURN jsonb_build_object('outbox',v_outbox,'deliveries',v_deliveries,'inbound',v_inbound,'audit',v_audit,'rateLimits',v_rate);
END $$;

CREATE INDEX agenda_outbox_retention_idx ON agenda_sync.outbox(updated_at)
  WHERE status IN ('delivered','skipped');
CREATE INDEX agenda_deliveries_retention_idx ON agenda_sync.deliveries(created_at);
CREATE INDEX agenda_inbound_retention_idx ON agenda_sync.inbound_events(received_at);
CREATE INDEX agenda_audit_retention_idx ON agenda_sync.connection_audit(created_at);

DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname='agenda-sync-daily-cleanup';
    PERFORM cron.schedule('agenda-sync-daily-cleanup','17 3 * * *',
      'SELECT agenda_sync.cleanup_history(5000)');
  END IF;
END $$;

REVOKE ALL ON FUNCTION agenda_sync.enqueue_direct(uuid,integer,uuid,text,text,uuid,bigint,jsonb,text,uuid,text) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.emit_resource(integer,text,text,uuid,jsonb,uuid,uuid,uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.start_resync(integer,uuid,uuid,text) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.claim_resync_batch(text,integer,integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.finalize_resyncs() FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.resolve_dead_letter(integer,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.correct_appointment_status(integer,uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.consume_inbound_rate_limit(integer,uuid,text,integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.cleanup_history(integer) FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.notify_dead_letter() FROM PUBLIC,anon,authenticated,authenticator;
REVOKE ALL ON FUNCTION agenda_sync.fill_delivery_event_type() FROM PUBLIC,anon,authenticated,authenticator;
GRANT EXECUTE ON FUNCTION agenda_sync.start_resync(integer,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.claim_resync_batch(text,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.finalize_resyncs() TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.resolve_dead_letter(integer,uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.correct_appointment_status(integer,uuid,uuid,uuid,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.consume_inbound_rate_limit(integer,uuid,text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.cleanup_history(integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.unit_resource(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.professional_resource(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.availability_resource(uuid,integer) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.connection_covers_unit(uuid,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.connection_covers_professional(uuid,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.enqueue_direct(uuid,integer,uuid,text,text,uuid,bigint,jsonb,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.emit_resource(integer,text,text,uuid,jsonb,uuid,uuid,uuid,uuid,timestamptz) TO service_role;
