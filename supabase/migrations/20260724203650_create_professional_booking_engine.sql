-- Deterministic professional availability and conflict-safe appointment engine.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE calendar.events
  ADD COLUMN occupied_range tstzrange;

-- Arithmetic with timestamptz is timezone-aware and therefore cannot be used
-- in a generated column. Persist the range and keep it synchronized in the
-- event trigger instead, so the GiST exclusion constraint remains indexable.
UPDATE calendar.events
SET occupied_range = tstzrange(
  start_time - make_interval(mins => buffer_before_minutes_snapshot),
  end_time + make_interval(mins => buffer_after_minutes_snapshot),
  '[)'
);

ALTER TABLE calendar.events
  ALTER COLUMN occupied_range SET NOT NULL;

SET search_path = public, extensions, calendar, crm;

ALTER TABLE calendar.events
  ADD CONSTRAINT calendar_events_professional_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    occupied_range WITH &&
  )
  WHERE (
    professional_id IS NOT NULL
    AND deleted_at IS NULL
    AND status IN ('scheduled', 'confirmed')
  );

RESET search_path;

CREATE OR REPLACE FUNCTION calendar.list_available_slots(
  p_professional_location_id uuid,
  p_service_id uuid,
  p_date_from date,
  p_date_until date,
  p_period text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_exclude_event_id uuid DEFAULT NULL,
  p_aces_id integer DEFAULT NULL
)
RETURNS TABLE (
  slot_start timestamptz,
  slot_end timestamptz,
  professional_id uuid,
  professional_name text,
  empresa_id uuid,
  empresa_name text,
  service_id uuid,
  service_name text,
  duration_minutes integer,
  price_cents integer
)
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := COALESCE(public.current_aces_id(), p_aces_id);
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Conta nao identificada';
  END IF;

  IF p_date_from IS NULL OR p_date_until IS NULL OR p_date_until < p_date_from THEN
    RAISE EXCEPTION 'Periodo de consulta invalido';
  END IF;

  IF p_period IS NOT NULL AND p_period NOT IN ('morning', 'afternoon', 'evening') THEN
    RAISE EXCEPTION 'Periodo do dia invalido';
  END IF;

  RETURN QUERY
  WITH account_settings AS (
    SELECT
      COALESCE(cs.timezone, 'America/Sao_Paulo') AS timezone,
      COALESCE(cs.minimum_notice_minutes, 60) AS minimum_notice_minutes,
      COALESCE(cs.booking_horizon_days, 90) AS booking_horizon_days,
      COALESCE(cs.slot_interval_minutes, 15) AS slot_interval_minutes
    FROM (SELECT 1) AS seed
    LEFT JOIN calendar.settings AS cs
      ON cs.aces_id = v_aces_id
  ),
  binding AS (
    SELECT
      pl.id AS professional_location_id,
      pl.professional_id,
      p.name AS professional_name,
      pl.empresa_id,
      e.name AS empresa_name,
      s.id AS service_id,
      s.name AS service_name,
      COALESCE(ps.duration_minutes_override, s.duration_minutes) AS duration_minutes,
      COALESCE(ps.price_cents_override, s.price_cents) AS price_cents,
      COALESCE(ps.buffer_before_minutes_override, s.buffer_before_minutes) AS buffer_before_minutes,
      COALESCE(ps.buffer_after_minutes_override, s.buffer_after_minutes) AS buffer_after_minutes
    FROM calendar.professional_locations AS pl
    JOIN calendar.professionals AS p
      ON p.id = pl.professional_id
     AND p.aces_id = pl.aces_id
     AND p.is_active IS TRUE
    JOIN calendar.professional_services AS ps
      ON ps.professional_location_id = pl.id
     AND ps.aces_id = pl.aces_id
     AND ps.service_id = p_service_id
     AND ps.is_active IS TRUE
    JOIN calendar.services AS s
      ON s.id = ps.service_id
     AND s.aces_id = ps.aces_id
     AND s.is_active IS TRUE
    LEFT JOIN crm.empresas AS e
      ON e.id = pl.empresa_id
     AND e.aces_id = pl.aces_id
     AND e.is_active IS TRUE
    WHERE pl.id = p_professional_location_id
      AND pl.aces_id = v_aces_id
      AND pl.is_active IS TRUE
      AND (pl.empresa_id IS NULL OR e.id IS NOT NULL)
  ),
  bounded_dates AS (
    SELECT generated_date::date AS local_date
    FROM account_settings AS cfg
    CROSS JOIN LATERAL generate_series(
      GREATEST(
        p_date_from,
        (now() AT TIME ZONE cfg.timezone)::date
      )::timestamp,
      LEAST(
        p_date_until,
        (now() AT TIME ZONE cfg.timezone)::date + cfg.booking_horizon_days
      )::timestamp,
      interval '1 day'
    ) AS generated_date
  ),
  candidate_slots AS (
    SELECT DISTINCT
      generated_slot AS slot_start,
      generated_slot + make_interval(mins => b.duration_minutes) AS slot_end,
      b.professional_id,
      b.professional_name,
      b.empresa_id,
      b.empresa_name,
      b.service_id,
      b.service_name,
      b.duration_minutes,
      b.price_cents,
      b.buffer_before_minutes,
      b.buffer_after_minutes,
      cfg.timezone,
      cfg.minimum_notice_minutes
    FROM bounded_dates AS d
    CROSS JOIN account_settings AS cfg
    CROSS JOIN binding AS b
    JOIN calendar.availability_rules AS ar
      ON ar.aces_id = v_aces_id
     AND ar.professional_location_id = b.professional_location_id
     AND ar.weekday = extract(dow FROM d.local_date)::smallint
     AND ar.is_active IS TRUE
     AND (ar.valid_from IS NULL OR ar.valid_from <= d.local_date)
     AND (ar.valid_until IS NULL OR ar.valid_until >= d.local_date)
    CROSS JOIN LATERAL generate_series(
      (d.local_date + ar.start_time) AT TIME ZONE cfg.timezone,
      ((d.local_date + ar.end_time) AT TIME ZONE cfg.timezone)
        - make_interval(mins => b.duration_minutes),
      make_interval(mins => cfg.slot_interval_minutes)
    ) AS generated_slot
  )
  SELECT
    candidate.slot_start,
    candidate.slot_end,
    candidate.professional_id,
    candidate.professional_name,
    candidate.empresa_id,
    candidate.empresa_name,
    candidate.service_id,
    candidate.service_name,
    candidate.duration_minutes,
    candidate.price_cents
  FROM candidate_slots AS candidate
  WHERE candidate.slot_start >= now() + make_interval(mins => candidate.minimum_notice_minutes)
    AND (
      p_period IS NULL
      OR (p_period = 'morning'
        AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time < time '12:00')
      OR (p_period = 'afternoon'
        AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time >= time '12:00'
        AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time < time '18:00')
      OR (p_period = 'evening'
        AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time >= time '18:00')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM calendar.availability_exceptions AS exception
      WHERE exception.aces_id = v_aces_id
        AND exception.is_active IS TRUE
        AND (
          (exception.empresa_id IS NULL AND exception.professional_location_id IS NULL)
          OR exception.empresa_id = candidate.empresa_id
          OR exception.professional_location_id = p_professional_location_id
        )
        AND tstzrange(exception.starts_at, exception.ends_at, '[)')
          && tstzrange(
            candidate.slot_start - make_interval(mins => candidate.buffer_before_minutes),
            candidate.slot_end + make_interval(mins => candidate.buffer_after_minutes),
            '[)'
          )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM calendar.events AS event
      WHERE event.aces_id = v_aces_id
        AND event.professional_id = candidate.professional_id
        AND event.deleted_at IS NULL
        AND event.status IN ('scheduled', 'confirmed')
        AND (p_exclude_event_id IS NULL OR event.id <> p_exclude_event_id)
        AND event.occupied_range && tstzrange(
          candidate.slot_start - make_interval(mins => candidate.buffer_before_minutes),
          candidate.slot_end + make_interval(mins => candidate.buffer_after_minutes),
          '[)'
        )
    )
  ORDER BY candidate.slot_start, candidate.professional_name
  LIMIT v_limit;
END;
$$;

CREATE OR REPLACE FUNCTION calendar.validate_event_consistency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_current_aces_id integer := public.current_aces_id();
  v_current_user_id uuid := public.current_crm_user_id();
  v_lead_aces_id integer;
  v_opportunity_aces_id integer;
  v_opportunity_lead_id uuid;
  v_location record;
  v_service record;
  v_timezone text;
  v_validate_slot boolean := FALSE;
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
  FROM crm.leads AS l
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
    FROM crm.opportunities AS o
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

  IF NEW.professional_location_id IS NOT NULL THEN
    SELECT
      pl.professional_id,
      pl.empresa_id,
      pl.is_active,
      p.is_active AS professional_is_active
    INTO v_location
    FROM calendar.professional_locations AS pl
    JOIN calendar.professionals AS p
      ON p.id = pl.professional_id
     AND p.aces_id = pl.aces_id
    WHERE pl.id = NEW.professional_location_id
      AND pl.aces_id = NEW.aces_id;

    IF v_location IS NULL OR NOT v_location.is_active OR NOT v_location.professional_is_active THEN
      RAISE EXCEPTION 'Local profissional nao encontrado ou inativo';
    END IF;

    SELECT
      COALESCE(ps.duration_minutes_override, s.duration_minutes) AS duration_minutes,
      COALESCE(ps.price_cents_override, s.price_cents) AS price_cents,
      COALESCE(ps.buffer_before_minutes_override, s.buffer_before_minutes) AS buffer_before_minutes,
      COALESCE(ps.buffer_after_minutes_override, s.buffer_after_minutes) AS buffer_after_minutes
    INTO v_service
    FROM calendar.professional_services AS ps
    JOIN calendar.services AS s
      ON s.id = ps.service_id
     AND s.aces_id = ps.aces_id
    WHERE ps.aces_id = NEW.aces_id
      AND ps.professional_location_id = NEW.professional_location_id
      AND ps.service_id = NEW.service_id
      AND ps.is_active IS TRUE
      AND s.is_active IS TRUE;

    IF v_service IS NULL THEN
      RAISE EXCEPTION 'Servico nao esta disponivel para o profissional neste local';
    END IF;

    IF TG_OP = 'INSERT' THEN
      v_validate_slot := TRUE;
      NEW.professional_id := v_location.professional_id;
      NEW.empresa_id := v_location.empresa_id;
      NEW.duration_minutes_snapshot := v_service.duration_minutes;
      NEW.price_cents_snapshot := v_service.price_cents;
      NEW.buffer_before_minutes_snapshot := v_service.buffer_before_minutes;
      NEW.buffer_after_minutes_snapshot := v_service.buffer_after_minutes;
      NEW.end_time := NEW.start_time + make_interval(mins => v_service.duration_minutes);
      NEW.all_day := FALSE;
    ELSE
      v_validate_slot := NEW.start_time IS DISTINCT FROM OLD.start_time
        OR NEW.professional_location_id IS DISTINCT FROM OLD.professional_location_id
        OR NEW.service_id IS DISTINCT FROM OLD.service_id
        OR (OLD.status NOT IN ('scheduled', 'confirmed') AND NEW.status IN ('scheduled', 'confirmed'));

      IF NEW.start_time IS DISTINCT FROM OLD.start_time
        OR NEW.professional_location_id IS DISTINCT FROM OLD.professional_location_id
        OR NEW.service_id IS DISTINCT FROM OLD.service_id THEN
        NEW.professional_id := v_location.professional_id;
        NEW.empresa_id := v_location.empresa_id;
        NEW.duration_minutes_snapshot := v_service.duration_minutes;
        NEW.price_cents_snapshot := v_service.price_cents;
        NEW.buffer_before_minutes_snapshot := v_service.buffer_before_minutes;
        NEW.buffer_after_minutes_snapshot := v_service.buffer_after_minutes;
        NEW.end_time := NEW.start_time + make_interval(mins => v_service.duration_minutes);
        NEW.all_day := FALSE;
      END IF;
    END IF;

    IF v_validate_slot AND NEW.status IN ('scheduled', 'confirmed') THEN
      SELECT COALESCE(cs.timezone, 'America/Sao_Paulo')
      INTO v_timezone
      FROM (SELECT 1) AS seed
      LEFT JOIN calendar.settings AS cs ON cs.aces_id = NEW.aces_id;

      IF NOT EXISTS (
        SELECT 1
        FROM calendar.list_available_slots(
          NEW.professional_location_id,
          NEW.service_id,
          (NEW.start_time AT TIME ZONE v_timezone)::date,
          (NEW.start_time AT TIME ZONE v_timezone)::date,
          NULL,
          200,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END,
          NEW.aces_id
        ) AS slot
        WHERE slot.slot_start = NEW.start_time
      ) THEN
        RAISE EXCEPTION 'SLOT_UNAVAILABLE';
      END IF;
    END IF;
  ELSIF NEW.professional_id IS NOT NULL OR NEW.service_id IS NOT NULL OR NEW.empresa_id IS NOT NULL THEN
    RAISE EXCEPTION 'Agendamento profissional exige local e servico validos';
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

  NEW.occupied_range := tstzrange(
    NEW.start_time - make_interval(mins => NEW.buffer_before_minutes_snapshot),
    NEW.end_time + make_interval(mins => NEW.buffer_after_minutes_snapshot),
    '[)'
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION calendar.create_professional_appointment(
  p_lead_id uuid,
  p_professional_location_id uuid,
  p_service_id uuid,
  p_start_time timestamptz,
  p_title text DEFAULT NULL,
  p_opportunity_id uuid DEFAULT NULL,
  p_status text DEFAULT 'scheduled',
  p_description text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_meeting_url text DEFAULT NULL,
  p_followup_1h_enabled boolean DEFAULT false,
  p_booking_origin text DEFAULT 'manual',
  p_idempotency_key text DEFAULT NULL,
  p_aces_id integer DEFAULT NULL
)
RETURNS calendar.events
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := COALESCE(public.current_aces_id(), p_aces_id);
  v_lead crm.leads%ROWTYPE;
  v_slot record;
  v_existing calendar.events%ROWTYPE;
  v_event calendar.events%ROWTYPE;
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Conta nao identificada';
  END IF;

  IF p_booking_origin NOT IN ('manual', 'ai', 'api', 'import', 'external') THEN
    RAISE EXCEPTION 'Origem do agendamento invalida';
  END IF;

  IF p_status NOT IN ('scheduled', 'confirmed') THEN
    RAISE EXCEPTION 'Status inicial do agendamento invalido';
  END IF;

  IF NULLIF(btrim(p_idempotency_key), '') IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM calendar.events AS event
    WHERE event.aces_id = v_aces_id
      AND event.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      RETURN v_existing;
    END IF;
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.aces_id = v_aces_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado';
  END IF;

  IF current_user <> 'service_role' AND NOT crm.current_user_can_access_lead(p_lead_id) THEN
    RAISE EXCEPTION 'Acesso negado ao lead';
  END IF;

  SELECT * INTO v_slot
  FROM calendar.list_available_slots(
    p_professional_location_id,
    p_service_id,
    (p_start_time AT TIME ZONE COALESCE(
      (SELECT cs.timezone FROM calendar.settings AS cs WHERE cs.aces_id = v_aces_id),
      'America/Sao_Paulo'
    ))::date,
    (p_start_time AT TIME ZONE COALESCE(
      (SELECT cs.timezone FROM calendar.settings AS cs WHERE cs.aces_id = v_aces_id),
      'America/Sao_Paulo'
    ))::date,
    NULL,
    200,
    NULL,
    v_aces_id
  ) AS slot
  WHERE slot.slot_start = p_start_time
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE';
  END IF;

  BEGIN
    INSERT INTO calendar.events (
      aces_id,
      owner_user_id,
      created_by_user_id,
      source,
      title,
      description,
      start_time,
      end_time,
      status,
      location,
      meeting_url,
      lead_id,
      opportunity_id,
      followup_1h_enabled,
      empresa_id,
      professional_id,
      professional_location_id,
      service_id,
      booking_origin,
      duration_minutes_snapshot,
      price_cents_snapshot,
      idempotency_key,
      metadata
    )
    VALUES (
      v_aces_id,
      v_lead.owner_id,
      public.current_crm_user_id(),
      'crm',
      COALESCE(NULLIF(btrim(p_title), ''), v_slot.service_name || ' - ' || v_lead.name),
      NULLIF(btrim(p_description), ''),
      v_slot.slot_start,
      v_slot.slot_end,
      p_status,
      NULLIF(btrim(p_location), ''),
      NULLIF(btrim(p_meeting_url), ''),
      v_lead.id,
      p_opportunity_id,
      COALESCE(p_followup_1h_enabled, false),
      v_slot.empresa_id,
      v_slot.professional_id,
      p_professional_location_id,
      p_service_id,
      p_booking_origin,
      v_slot.duration_minutes,
      v_slot.price_cents,
      NULLIF(btrim(p_idempotency_key), ''),
      jsonb_build_object(
        'professional_name', v_slot.professional_name,
        'service_name', v_slot.service_name,
        'empresa_name', v_slot.empresa_name
      )
    )
    RETURNING * INTO v_event;
  EXCEPTION
    WHEN exclusion_violation OR unique_violation THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE';
  END;

  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION calendar.reschedule_professional_appointment(
  p_event_id uuid,
  p_start_time timestamptz
)
RETURNS calendar.events
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_event calendar.events%ROWTYPE;
BEGIN
  SELECT * INTO v_event
  FROM calendar.events AS event
  WHERE event.id = p_event_id
    AND event.aces_id = public.current_aces_id()
    AND event.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_event.professional_location_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento profissional nao encontrado';
  END IF;

  IF NOT crm.current_user_can_access_lead(v_event.lead_id) THEN
    RAISE EXCEPTION 'Acesso negado ao agendamento';
  END IF;

  BEGIN
    UPDATE calendar.events
    SET start_time = p_start_time,
        end_time = p_start_time + make_interval(mins => v_event.duration_minutes_snapshot)
    WHERE id = p_event_id
    RETURNING * INTO v_event;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE';
  END;

  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION calendar.list_available_slots(uuid, uuid, date, date, text, integer, uuid, integer)
  FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION calendar.create_professional_appointment(uuid, uuid, uuid, timestamptz, text, uuid, text, text, text, text, boolean, text, text, integer)
  FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION calendar.reschedule_professional_appointment(uuid, timestamptz)
  FROM PUBLIC, anon, authenticator;

GRANT EXECUTE ON FUNCTION calendar.list_available_slots(uuid, uuid, date, date, text, integer, uuid, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calendar.create_professional_appointment(uuid, uuid, uuid, timestamptz, text, uuid, text, text, text, text, boolean, text, text, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION calendar.reschedule_professional_appointment(uuid, timestamptz)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
