-- Automacao V1 baseada apenas em entrada de lead em etapa do funil.
-- Nao depende de crm.agendamentos.

CREATE TABLE IF NOT EXISTS crm.automation_funnels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL DEFAULT public.current_aces_id() REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  trigger_stage_id uuid NOT NULL REFERENCES crm.pipeline_stages(id),
  instance_name text NOT NULL REFERENCES crm.instance(instancia),
  is_active boolean NOT NULL DEFAULT TRUE,
  created_by uuid DEFAULT public.current_crm_user_id() REFERENCES crm.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_funnels_name_account_unique UNIQUE (aces_id, name)
);

CREATE TABLE IF NOT EXISTS crm.automation_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  funnel_id uuid NOT NULL REFERENCES crm.automation_funnels(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  label text NOT NULL,
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  message_template text NOT NULL CHECK (char_length(btrim(message_template)) > 0),
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel = 'whatsapp'),
  is_active boolean NOT NULL DEFAULT TRUE,
  created_by uuid DEFAULT public.current_crm_user_id() REFERENCES crm.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS crm.automation_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  funnel_id uuid REFERENCES crm.automation_funnels(id) ON DELETE SET NULL,
  step_id uuid REFERENCES crm.automation_steps(id) ON DELETE SET NULL,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  source_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  scheduled_at timestamptz NOT NULL,
  sent_at timestamptz,
  cancelled_at timestamptz,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  rendered_message text,
  phone_snapshot text,
  instance_snapshot text,
  lead_name_snapshot text,
  city_snapshot text,
  status_snapshot text,
  funnel_name_snapshot text,
  step_label_snapshot text,
  last_error text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_funnels_aces_id
  ON crm.automation_funnels(aces_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_funnels_trigger_stage
  ON crm.automation_funnels(trigger_stage_id, is_active);

CREATE INDEX IF NOT EXISTS idx_automation_steps_funnel_position
  ON crm.automation_steps(funnel_id, position);

CREATE INDEX IF NOT EXISTS idx_automation_executions_funnel
  ON crm.automation_executions(funnel_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_lead
  ON crm.automation_executions(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_pending_schedule
  ON crm.automation_executions(status, scheduled_at)
  WHERE status IN ('pending', 'processing');

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_pending_unique
  ON crm.automation_executions(step_id, lead_id, source_stage_id)
  WHERE status = 'pending' AND step_id IS NOT NULL AND source_stage_id IS NOT NULL;

ALTER TABLE crm.automation_funnels ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.automation_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.automation_executions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS automation_funnels_select ON crm.automation_funnels;
CREATE POLICY automation_funnels_select
ON crm.automation_funnels
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS automation_funnels_insert ON crm.automation_funnels;
CREATE POLICY automation_funnels_insert
ON crm.automation_funnels
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS automation_funnels_update ON crm.automation_funnels;
CREATE POLICY automation_funnels_update
ON crm.automation_funnels
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS automation_funnels_delete ON crm.automation_funnels;
CREATE POLICY automation_funnels_delete
ON crm.automation_funnels
FOR DELETE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS automation_steps_select ON crm.automation_steps;
CREATE POLICY automation_steps_select
ON crm.automation_steps
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM crm.automation_funnels f
    WHERE f.id = automation_steps.funnel_id
      AND f.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS automation_steps_insert ON crm.automation_steps;
CREATE POLICY automation_steps_insert
ON crm.automation_steps
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM crm.automation_funnels f
    WHERE f.id = automation_steps.funnel_id
      AND f.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS automation_steps_update ON crm.automation_steps;
CREATE POLICY automation_steps_update
ON crm.automation_steps
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM crm.automation_funnels f
    WHERE f.id = automation_steps.funnel_id
      AND f.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM crm.automation_funnels f
    WHERE f.id = automation_steps.funnel_id
      AND f.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS automation_steps_delete ON crm.automation_steps;
CREATE POLICY automation_steps_delete
ON crm.automation_steps
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM crm.automation_funnels f
    WHERE f.id = automation_steps.funnel_id
      AND f.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS automation_executions_select ON crm.automation_executions;
CREATE POLICY automation_executions_select
ON crm.automation_executions
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_funnels TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_steps TO authenticated;
GRANT SELECT ON crm.automation_executions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_funnels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_steps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.automation_executions TO service_role;

CREATE OR REPLACE FUNCTION crm.cancel_pending_executions_for_funnel(p_funnel_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE crm.automation_executions
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now(),
    last_error = COALESCE(last_error, 'Cancelado por alteracao do funil')
  WHERE funnel_id = p_funnel_id
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cancel_pending_executions_for_step(p_step_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE crm.automation_executions
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now(),
    last_error = COALESCE(last_error, 'Cancelado por alteracao do disparo')
  WHERE step_id = p_step_id
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.cancel_pending_automation_for_lead_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_count integer;
BEGIN
  UPDATE crm.automation_executions ae
  SET
    status = 'cancelled',
    cancelled_at = now(),
    updated_at = now(),
    last_error = COALESCE(ae.last_error, 'Lead saiu da etapa gatilho')
  FROM crm.automation_funnels f
  WHERE ae.funnel_id = f.id
    AND ae.lead_id = p_lead_id
    AND ae.status = 'pending'
    AND f.trigger_stage_id = p_stage_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.schedule_automation_for_funnel_lead(p_funnel_id uuid, p_lead_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
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
    now() + make_interval(mins => s.delay_minutes),
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

CREATE OR REPLACE FUNCTION crm.schedule_automations_for_lead_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel_id uuid;
  v_total integer := 0;
BEGIN
  FOR v_funnel_id IN
    SELECT id
    FROM crm.automation_funnels
    WHERE trigger_stage_id = p_stage_id
      AND is_active = TRUE
  LOOP
    v_total := v_total + crm.schedule_automation_for_funnel_lead(v_funnel_id, p_lead_id);
  END LOOP;

  RETURN v_total;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_handle_lead_stage_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.view, TRUE) = TRUE AND COALESCE(NEW.view, TRUE) = FALSE THEN
    IF OLD.stage_id IS NOT NULL THEN
      PERFORM crm.cancel_pending_automation_for_lead_stage(NEW.id, OLD.stage_id);
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.stage_id IS NOT NULL THEN
    PERFORM crm.cancel_pending_automation_for_lead_stage(NEW.id, OLD.stage_id);
  END IF;

  IF NEW.stage_id IS NOT NULL AND COALESCE(NEW.view, TRUE) = TRUE THEN
    PERFORM crm.schedule_automations_for_lead_stage(NEW.id, NEW.stage_id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_cancel_pending_on_funnel_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM crm.cancel_pending_executions_for_funnel(OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.is_active = FALSE AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
    PERFORM crm.cancel_pending_executions_for_funnel(NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.trg_cancel_pending_on_step_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM crm.cancel_pending_executions_for_step(OLD.id);
    RETURN OLD;
  END IF;

  IF NEW.is_active = FALSE AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
    PERFORM crm.cancel_pending_executions_for_step(NEW.id);
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_sync_automation_funnel(p_funnel_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_funnel crm.automation_funnels%ROWTYPE;
  v_lead_id uuid;
  v_cancelled integer := 0;
  v_scheduled integer := 0;
BEGIN
  IF public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode sincronizar automacoes';
  END IF;

  SELECT *
  INTO v_funnel
  FROM crm.automation_funnels
  WHERE id = p_funnel_id
    AND aces_id = public.current_aces_id()
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Funil de automacao nao encontrado';
  END IF;

  v_cancelled := crm.cancel_pending_executions_for_funnel(v_funnel.id);

  IF v_funnel.is_active = FALSE THEN
    RETURN jsonb_build_object(
      'success', TRUE,
      'cancelled', v_cancelled,
      'scheduled', 0
    );
  END IF;

  FOR v_lead_id IN
    SELECT id
    FROM crm.leads
    WHERE aces_id = v_funnel.aces_id
      AND stage_id = v_funnel.trigger_stage_id
      AND COALESCE(view, TRUE) = TRUE
  LOOP
    v_scheduled := v_scheduled + crm.schedule_automation_for_funnel_lead(v_funnel.id, v_lead_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', TRUE,
    'cancelled', v_cancelled,
    'scheduled', v_scheduled
  );
END;
$function$;

CREATE OR REPLACE FUNCTION crm.rpc_claim_due_automation_executions(p_limit integer DEFAULT 50)
RETURNS TABLE (
  execution_id uuid,
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
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT ae.id
    FROM crm.automation_executions ae
    WHERE ae.status = 'pending'
      AND ae.scheduled_at <= now()
    ORDER BY ae.scheduled_at ASC, ae.created_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    FOR UPDATE SKIP LOCKED
  ),
  claimed AS (
    UPDATE crm.automation_executions ae
    SET
      status = 'processing',
      updated_at = now()
    WHERE ae.id IN (SELECT id FROM due)
    RETURNING ae.*
  )
  SELECT
    c.id,
    c.lead_id,
    c.aces_id,
    c.instance_snapshot,
    c.phone_snapshot,
    c.lead_name_snapshot,
    c.city_snapshot,
    c.status_snapshot,
    s.message_template,
    c.step_label_snapshot,
    c.funnel_name_snapshot,
    c.scheduled_at,
    c.attempt_count
  FROM claimed c
  LEFT JOIN crm.automation_steps s ON s.id = c.step_id
  ORDER BY c.scheduled_at ASC, c.created_at ASC;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.rpc_sync_automation_funnel(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_sync_automation_funnel(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_automation_executions(integer) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions(integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions(integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_claim_due_automation_executions(integer) FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_automation_funnels_updated_at ON crm.automation_funnels;
CREATE TRIGGER trg_automation_funnels_updated_at
BEFORE UPDATE ON crm.automation_funnels
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_automation_steps_updated_at ON crm.automation_steps;
CREATE TRIGGER trg_automation_steps_updated_at
BEFORE UPDATE ON crm.automation_steps
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_automation_executions_updated_at ON crm.automation_executions;
CREATE TRIGGER trg_automation_executions_updated_at
BEFORE UPDATE ON crm.automation_executions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_leads_stage_automation ON crm.leads;
CREATE TRIGGER trg_leads_stage_automation
AFTER INSERT OR UPDATE OF stage_id, view ON crm.leads
FOR EACH ROW
EXECUTE FUNCTION crm.trg_handle_lead_stage_automation();

DROP TRIGGER IF EXISTS trg_automation_funnel_change_cancel_pending ON crm.automation_funnels;
CREATE TRIGGER trg_automation_funnel_change_cancel_pending
BEFORE DELETE OR UPDATE OF is_active ON crm.automation_funnels
FOR EACH ROW
EXECUTE FUNCTION crm.trg_cancel_pending_on_funnel_change();

DROP TRIGGER IF EXISTS trg_automation_step_change_cancel_pending ON crm.automation_steps;
CREATE TRIGGER trg_automation_step_change_cancel_pending
BEFORE DELETE OR UPDATE OF is_active ON crm.automation_steps
FOR EACH ROW
EXECUTE FUNCTION crm.trg_cancel_pending_on_step_change();
