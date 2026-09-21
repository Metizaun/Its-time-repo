-- Agenda da Dr. Oculos Matriz: horario de referencia e fila por ordem de chegada.
-- A conta 5 e a unica conta configurada com esta politica neste momento.

ALTER TABLE calendar.settings
  ADD COLUMN IF NOT EXISTS allow_overlapping_bookings boolean NOT NULL DEFAULT false;

-- Mantem a protecao de conflito para as demais contas e libera concorrencia
-- somente para a conta Dr. Oculos, que usa os horarios como senhas/fila.
ALTER TABLE calendar.events
  DROP CONSTRAINT IF EXISTS calendar_events_professional_no_overlap;

ALTER TABLE calendar.events
  ADD CONSTRAINT calendar_events_professional_no_overlap
  EXCLUDE USING gist (
    professional_id WITH =,
    occupied_range WITH &&
  )
  WHERE (
    aces_id <> 5
    AND professional_id IS NOT NULL
    AND deleted_at IS NULL
    AND status IN ('scheduled', 'confirmed')
  );

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
  v_allow_overlapping_bookings boolean := false;
BEGIN
  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Conta nao identificada';
  END IF;

  SELECT COALESCE(cs.allow_overlapping_bookings, false)
  INTO v_allow_overlapping_bookings
  FROM calendar.settings AS cs
  WHERE cs.aces_id = v_aces_id;

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
    LEFT JOIN calendar.settings AS cs ON cs.aces_id = v_aces_id
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
      OR (p_period = 'morning' AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time < time '12:00')
      OR (p_period = 'afternoon'
        AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time >= time '12:00'
        AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time < time '18:00')
      OR (p_period = 'evening' AND (candidate.slot_start AT TIME ZONE candidate.timezone)::time >= time '18:00')
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
        AND tstzrange(exception.starts_at, exception.ends_at, '[)') && tstzrange(
          candidate.slot_start - make_interval(mins => candidate.buffer_before_minutes),
          candidate.slot_end + make_interval(mins => candidate.buffer_after_minutes),
          '[)'
        )
    )
    AND (
      v_allow_overlapping_bookings
      OR NOT EXISTS (
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
    )
  ORDER BY candidate.slot_start, candidate.professional_name
  LIMIT v_limit;
END;
$$;

-- Cadastro generico: o horario e apenas uma referencia para a fila da Matriz.
-- Este bloco e dado especifico de producao. Em replay de uma base vazia, a
-- conta e a empresa ainda nao existem e o seed deve ser simplesmente omitido.
DO $seed$
BEGIN
  IF EXISTS (SELECT 1 FROM crm.accounts WHERE id = 5)
     AND EXISTS (
       SELECT 1
       FROM crm.empresas
       WHERE id = '182af266-f6b6-4579-9d88-43bf1db0cd27'
         AND aces_id = 5
     ) THEN
INSERT INTO calendar.settings (
  aces_id, timezone, minimum_notice_minutes, booking_horizon_days,
  slot_interval_minutes, ai_booking_enabled, allow_overlapping_bookings
)
VALUES (5, 'America/Sao_Paulo', 0, 90, 60, true, true)
ON CONFLICT (aces_id) DO UPDATE SET
  timezone = EXCLUDED.timezone,
  slot_interval_minutes = EXCLUDED.slot_interval_minutes,
  ai_booking_enabled = EXCLUDED.ai_booking_enabled,
  allow_overlapping_bookings = EXCLUDED.allow_overlapping_bookings,
  updated_at = now();

INSERT INTO calendar.professionals (id, aces_id, name, specialty, is_active)
VALUES (
  '50000000-0000-0000-0000-000000000501',
  5,
  'Atendimento Matriz',
  'Ordem de chegada',
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  specialty = EXCLUDED.specialty,
  is_active = true,
  updated_at = now();

INSERT INTO calendar.professional_locations (
  id, aces_id, professional_id, empresa_id, location_name, is_active, is_ai_visible
)
VALUES (
  '50000000-0000-0000-0000-000000000511',
  5,
  '50000000-0000-0000-0000-000000000501',
  '182af266-f6b6-4579-9d88-43bf1db0cd27',
  'Dr. Oculos - Matriz',
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  empresa_id = EXCLUDED.empresa_id,
  location_name = EXCLUDED.location_name,
  is_active = true,
  is_ai_visible = true,
  updated_at = now();

INSERT INTO calendar.services (
  id, aces_id, name, description, duration_minutes, price_cents,
  buffer_before_minutes, buffer_after_minutes, is_active, is_ai_visible
)
VALUES (
  '50000000-0000-0000-0000-000000000531',
  5,
  'Agendamento na Matriz',
  'Agendamento simbolico; o atendimento presencial ocorre por ordem de chegada.',
  60,
  NULL,
  0,
  0,
  true,
  true
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  duration_minutes = EXCLUDED.duration_minutes,
  price_cents = NULL,
  is_active = true,
  is_ai_visible = true,
  updated_at = now();

INSERT INTO calendar.professional_services (
  aces_id, professional_location_id, service_id, duration_minutes_override,
  price_cents_override, buffer_before_minutes_override, buffer_after_minutes_override,
  is_active, is_ai_visible
)
VALUES (
  5,
  '50000000-0000-0000-0000-000000000511',
  '50000000-0000-0000-0000-000000000531',
  60,
  NULL,
  0,
  0,
  true,
  true
)
ON CONFLICT (professional_location_id, service_id) DO UPDATE SET
  duration_minutes_override = 60,
  price_cents_override = NULL,
  buffer_before_minutes_override = 0,
  buffer_after_minutes_override = 0,
  is_active = true,
  is_ai_visible = true,
  updated_at = now();

DELETE FROM calendar.availability_rules
WHERE aces_id = 5
  AND professional_location_id = '50000000-0000-0000-0000-000000000511';

INSERT INTO calendar.availability_rules (
  aces_id, professional_location_id, weekday, start_time, end_time, is_active
)
VALUES
  (5, '50000000-0000-0000-0000-000000000511', 1, '08:00', '10:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 1, '13:00', '15:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 2, '08:00', '10:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 2, '13:00', '15:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 3, '08:00', '10:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 3, '13:00', '15:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 4, '08:00', '10:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 4, '13:00', '15:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 5, '08:00', '10:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 5, '13:00', '15:00', true),
  (5, '50000000-0000-0000-0000-000000000511', 6, '08:00', '11:00', true);

UPDATE agents.agent_tools AS tool
SET is_enabled = true,
    readiness = 'ready',
    config = COALESCE(tool.config, '{}'::jsonb) || jsonb_build_object(
      'queryAvailability', true,
      'create', true,
      'reschedule', false,
      'cancel', false
    ),
    last_validated_at = now()
FROM agents.ai_agents AS agent
WHERE tool.agent_id = agent.id
  AND tool.aces_id = 5
  AND tool.tool_key = 'calendar'
  AND agent.instance_name = 'cobranca';

UPDATE agents.ai_agents
SET system_prompt = CASE
  WHEN position('REGRAS DA AGENDA DA MATRIZ' IN system_prompt) > 0 THEN system_prompt
  ELSE system_prompt || E'\n\nREGRAS DA AGENDA DA MATRIZ\nOs horarios da Matriz sao referencias simbolicas para registrar o agendamento. Eles nao representam limite de vagas: mais de uma pessoa pode agendar no mesmo horario. Informe que o atendimento presencial e por ordem de chegada. Nunca diga que um horario esta lotado apenas porque ja existe outro agendamento no mesmo horario.'
END,
    updated_at = now()
WHERE aces_id = 5
  AND instance_name = 'cobranca';

  END IF;
END;
$seed$;

NOTIFY pgrst, 'reload schema';
