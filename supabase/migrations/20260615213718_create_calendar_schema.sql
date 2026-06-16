-- Calendar feature foundation.
-- Calendar-specific data lives in its own schema and references CRM entities for tenant and lead scope.

CREATE SCHEMA IF NOT EXISTS calendar;

REVOKE USAGE ON SCHEMA calendar FROM anon;
GRANT USAGE ON SCHEMA calendar TO authenticated, service_role, authenticator;

CREATE TABLE IF NOT EXISTS calendar.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL DEFAULT public.current_aces_id() REFERENCES crm.accounts(id) ON DELETE CASCADE,
  owner_user_id uuid DEFAULT public.current_crm_user_id() REFERENCES crm.users(id) ON DELETE SET NULL,
  created_by_user_id uuid DEFAULT public.current_crm_user_id() REFERENCES crm.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'crm' CHECK (source IN ('crm', 'n8n', 'import', 'external')),
  external_event_id text,
  title text NOT NULL,
  description text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'cancelled', 'done', 'no_show')),
  cancel_reason text,
  location text,
  meeting_url text,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES crm.opportunities(id) ON DELETE SET NULL,
  followup_1h_enabled boolean NOT NULL DEFAULT false,
  followup_1h_status text NOT NULL DEFAULT 'disabled'
    CHECK (followup_1h_status IN ('disabled', 'pending', 'sent', 'failed', 'skipped')),
  followup_1h_last_attempt_at timestamptz,
  followup_1h_sent_at timestamptz,
  followup_1h_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT calendar_events_end_after_start CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_aces_range
  ON calendar.events(aces_id, start_time, end_time)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_aces_status_start
  ON calendar.events(aces_id, status, start_time)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_lead_start
  ON calendar.events(lead_id, start_time DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_calendar_events_opportunity
  ON calendar.events(opportunity_id)
  WHERE opportunity_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_calendar_events_external_unique
  ON calendar.events(aces_id, source, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION calendar.validate_event_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = calendar, crm, public
AS $$
DECLARE
  v_current_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_lead_aces_id integer;
  v_opportunity_aces_id integer;
  v_opportunity_lead_id uuid;
BEGIN
  NEW.title := NULLIF(btrim(NEW.title), '');

  IF NEW.title IS NULL THEN
    RAISE EXCEPTION 'Titulo do evento e obrigatorio';
  END IF;

  IF NEW.aces_id IS NULL THEN
    NEW.aces_id := v_current_aces_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by_user_id := COALESCE(NEW.created_by_user_id, v_current_user_id);
    NEW.owner_user_id := COALESCE(NEW.owner_user_id, v_current_user_id);
  END IF;

  IF NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'Horario final deve ser maior que o horario inicial';
  END IF;

  SELECT l.aces_id
  INTO v_lead_aces_id
  FROM crm.leads l
  WHERE l.id = NEW.lead_id;

  IF v_lead_aces_id IS NULL THEN
    RAISE EXCEPTION 'Lead do evento nao encontrado';
  END IF;

  IF v_lead_aces_id IS DISTINCT FROM NEW.aces_id THEN
    RAISE EXCEPTION 'Lead do evento pertence a outro tenant';
  END IF;

  IF NEW.opportunity_id IS NOT NULL THEN
    SELECT o.aces_id, o.lead_id
    INTO v_opportunity_aces_id, v_opportunity_lead_id
    FROM crm.opportunities o
    WHERE o.id = NEW.opportunity_id;

    IF v_opportunity_aces_id IS NULL THEN
      RAISE EXCEPTION 'Oportunidade do evento nao encontrada';
    END IF;

    IF v_opportunity_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Oportunidade do evento pertence a outro tenant';
    END IF;

    IF v_opportunity_lead_id IS DISTINCT FROM NEW.lead_id THEN
      RAISE EXCEPTION 'Oportunidade do evento nao pertence ao lead informado';
    END IF;
  END IF;

  IF NOT NEW.followup_1h_enabled THEN
    NEW.followup_1h_status := 'disabled';
  ELSIF NEW.followup_1h_status = 'disabled' THEN
    NEW.followup_1h_status := 'pending';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();

    IF NEW.start_time IS DISTINCT FROM OLD.start_time OR NEW.end_time IS DISTINCT FROM OLD.end_time THEN
      NEW.followup_1h_status := CASE WHEN NEW.followup_1h_enabled THEN 'pending' ELSE 'disabled' END;
      NEW.followup_1h_last_attempt_at := NULL;
      NEW.followup_1h_sent_at := NULL;
      NEW.followup_1h_error := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_calendar_events_consistency ON calendar.events;
CREATE TRIGGER trg_calendar_events_consistency
BEFORE INSERT OR UPDATE ON calendar.events
FOR EACH ROW
EXECUTE FUNCTION calendar.validate_event_consistency();

ALTER TABLE calendar.events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select ON calendar.events;
CREATE POLICY calendar_events_select
ON calendar.events
FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

DROP POLICY IF EXISTS calendar_events_insert ON calendar.events;
CREATE POLICY calendar_events_insert
ON calendar.events
FOR INSERT
TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

DROP POLICY IF EXISTS calendar_events_update ON calendar.events;
CREATE POLICY calendar_events_update
ON calendar.events
FOR UPDATE
TO authenticated
USING (
  deleted_at IS NULL
  AND aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

DROP POLICY IF EXISTS calendar_events_delete ON calendar.events;
CREATE POLICY calendar_events_delete
ON calendar.events
FOR DELETE
TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_lead(lead_id)
);

REVOKE ALL ON calendar.events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.events TO authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.events TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA calendar
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated, service_role, authenticator;

ALTER TABLE calendar.events REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE calendar.events;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END;
$$;

ALTER ROLE authenticator SET pgrst.db_schemas = 'public,storage,graphql_public,crm,meta,calendar';
NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';
