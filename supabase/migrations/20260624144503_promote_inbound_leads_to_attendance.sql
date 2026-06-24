CREATE OR REPLACE FUNCTION crm.promote_inbound_lead_to_attendance()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_entry_stage_id uuid;
  v_attendance_stage_id uuid;
  v_attendance_status text;
BEGIN
  IF NEW.direction IS DISTINCT FROM 'inbound' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT stage.id
    INTO v_entry_stage_id
  FROM crm.pipeline_stages AS stage
  WHERE stage.aces_id = NEW.aces_id
    AND lower(btrim(stage.name)) = 'entrada'
  ORDER BY stage.position, stage.id
  LIMIT 1;

  SELECT stage.id, stage.name
    INTO v_attendance_stage_id, v_attendance_status
  FROM crm.pipeline_stages AS stage
  WHERE stage.aces_id = NEW.aces_id
    AND lower(btrim(stage.name)) IN ('em atendimento', 'atendimento')
  ORDER BY
    CASE lower(btrim(stage.name))
      WHEN 'em atendimento' THEN 0
      ELSE 1
    END,
    stage.position,
    stage.id
  LIMIT 1;

  IF v_entry_stage_id IS NULL OR v_attendance_stage_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE crm.leads
  SET
    stage_id = v_attendance_stage_id,
    status = v_attendance_status,
    updated_at = now()
  WHERE id = NEW.lead_id
    AND aces_id = NEW.aces_id
    AND stage_id = v_entry_stage_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_promote_inbound_lead_to_attendance ON crm.message_history;
CREATE TRIGGER trg_promote_inbound_lead_to_attendance
AFTER INSERT ON crm.message_history
FOR EACH ROW
WHEN (NEW.direction = 'inbound')
EXECUTE FUNCTION crm.promote_inbound_lead_to_attendance();
