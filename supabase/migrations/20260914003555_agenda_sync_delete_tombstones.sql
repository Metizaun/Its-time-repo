-- Capture deletion events before foreign-key cascades remove the scope rows used
-- to decide which partner connections must receive the tombstone.

CREATE OR REPLACE FUNCTION agenda_sync.capture_unit_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at timestamptz := clock_timestamp();
  v_resource jsonb;
BEGIN
  v_resource := jsonb_build_object(
    'id', OLD.id,
    'cnpj', OLD.cnpj,
    'name', OLD.name,
    'address', OLD.address,
    'city', OLD.city,
    'state', OLD.state,
    'isActive', false,
    'closures', '[]'::jsonb,
    'metadata', COALESCE(OLD.agenda_metadata, '{}'::jsonb),
    'updatedAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );

  PERFORM agenda_sync.emit_resource(
    OLD.aces_id, 'unit.upserted', 'unit', OLD.id, v_resource,
    p_unit_id => OLD.id, p_occurred_at => v_at
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.capture_professional_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at timestamptz := clock_timestamp();
  v_resource jsonb;
BEGIN
  v_resource := agenda_sync.professional_resource(OLD.id, OLD.aces_id);
  v_resource := jsonb_set(
    jsonb_set(v_resource, '{isActive}', 'false'::jsonb),
    '{deletedAt}',
    to_jsonb(to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  );
  v_resource := jsonb_set(
    v_resource,
    '{updatedAt}',
    to_jsonb(to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  );

  PERFORM agenda_sync.emit_resource(
    OLD.aces_id, 'professional.upserted', 'professional', OLD.id, v_resource,
    p_professional_id => OLD.id, p_occurred_at => v_at
  );
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.capture_assignment_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_at timestamptz := clock_timestamp();
  v_professional jsonb;
  v_assignments jsonb;
  v_availability jsonb;
BEGIN
  v_professional := agenda_sync.professional_resource(OLD.professional_id, OLD.aces_id);
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN item ->> 'assignmentId' = OLD.id::text
        THEN jsonb_set(item, '{isActive}', 'false'::jsonb)
      ELSE item
    END
  ), '[]'::jsonb)
  INTO v_assignments
  FROM jsonb_array_elements(COALESCE(v_professional -> 'assignments', '[]'::jsonb)) AS item;

  v_professional := jsonb_set(v_professional, '{assignments}', v_assignments);
  v_professional := jsonb_set(
    v_professional,
    '{updatedAt}',
    to_jsonb(to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  );

  PERFORM agenda_sync.emit_resource(
    OLD.aces_id, 'professional.upserted', 'professional', OLD.professional_id,
    v_professional, p_assignment_id => OLD.id,
    p_professional_id => OLD.professional_id, p_occurred_at => v_at
  );

  v_availability := jsonb_build_object(
    'assignmentId', OLD.id,
    'professionalId', OLD.professional_id,
    'unitId', OLD.empresa_id,
    'timezone', 'America/Sao_Paulo',
    'weeklyGrid', '[]'::jsonb,
    'exceptions', '[]'::jsonb,
    'updatedAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  PERFORM agenda_sync.emit_resource(
    OLD.aces_id, 'availability.upserted', 'availability', OLD.id,
    v_availability, p_assignment_id => OLD.id,
    p_unit_id => OLD.empresa_id, p_occurred_at => v_at
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_unit ON crm.empresas;
CREATE TRIGGER trg_agenda_sync_capture_unit
AFTER INSERT OR UPDATE ON crm.empresas
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_unit_change();

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_unit_delete ON crm.empresas;
CREATE TRIGGER trg_agenda_sync_capture_unit_delete
BEFORE DELETE ON crm.empresas
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_unit_delete();

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_professional ON calendar.professionals;
CREATE TRIGGER trg_agenda_sync_capture_professional
AFTER INSERT OR UPDATE ON calendar.professionals
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_professional_change();

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_professional_delete ON calendar.professionals;
CREATE TRIGGER trg_agenda_sync_capture_professional_delete
BEFORE DELETE ON calendar.professionals
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_professional_delete();

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_assignment ON calendar.professional_locations;
CREATE TRIGGER trg_agenda_sync_capture_assignment
AFTER INSERT OR UPDATE ON calendar.professional_locations
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_professional_change();

DROP TRIGGER IF EXISTS trg_agenda_sync_capture_assignment_delete ON calendar.professional_locations;
CREATE TRIGGER trg_agenda_sync_capture_assignment_delete
BEFORE DELETE ON calendar.professional_locations
FOR EACH ROW EXECUTE FUNCTION agenda_sync.capture_assignment_delete();

REVOKE ALL ON FUNCTION agenda_sync.capture_unit_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION agenda_sync.capture_professional_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION agenda_sync.capture_assignment_delete() FROM PUBLIC, anon, authenticated;
