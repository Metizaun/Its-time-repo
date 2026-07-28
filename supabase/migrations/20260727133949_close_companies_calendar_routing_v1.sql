-- Close the optional companies, professional calendar and company routing v1.
-- All additions are backwards-compatible: tenants without companies or calendar
-- configuration keep their current instance-only behavior.

-- ---------------------------------------------------------------------------
-- 1. Legacy schema compatibility and lint fixes.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.billing_get_usage_snapshot(
  p_user_id uuid,
  p_reference_at timestamptz DEFAULT now()
)
RETURNS SETOF public.billing_usage_cycles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.user_profiles%ROWTYPE;
  v_cycle_start timestamptz;
  v_cycle_end timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;

  IF (SELECT auth.uid()) IS DISTINCT FROM p_user_id
    AND COALESCE((SELECT auth.jwt() ->> 'role'), '') <> 'service_role' THEN
    RAISE EXCEPTION 'ACCESS_DENIED';
  END IF;

  SELECT * INTO v_profile
  FROM public.user_profiles AS profile
  WHERE profile.user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT bounds.cycle_start_at, bounds.cycle_end_at
  INTO v_cycle_start, v_cycle_end
  FROM public.billing_cycle_bounds(
    COALESCE(p_reference_at, now()),
    COALESCE(v_profile.billing_anchor_day, 1),
    COALESCE(NULLIF(v_profile.billing_timezone, ''), 'America/Sao_Paulo')
  ) AS bounds;

  RETURN QUERY
  SELECT
    p_user_id,
    v_cycle_start,
    v_cycle_end,
    v_profile.aces_id::bigint,
    COALESCE(cycle.tokens_used, 0::bigint),
    COALESCE(cycle.credits_used, 0::numeric),
    COALESCE(cycle.usd_spent, 0::numeric),
    COALESCE(cycle.updated_at, now())
  FROM (SELECT 1) AS seed
  LEFT JOIN public.billing_usage_cycles AS cycle
    ON cycle.user_id = p_user_id
   AND cycle.cycle_start_at = v_cycle_start;
END;
$$;

REVOKE ALL ON FUNCTION public.billing_get_usage_snapshot(uuid, timestamptz)
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION public.billing_get_usage_snapshot(uuid, timestamptz)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION calendar.rpc_claim_due_followup_events(p_limit integer DEFAULT 25)
RETURNS TABLE (
  event_id uuid,
  aces_id integer,
  lead_id uuid,
  title text,
  description text,
  start_time timestamptz,
  end_time timestamptz,
  all_day boolean,
  location text,
  meeting_url text,
  metadata jsonb,
  lead_name text,
  contact_phone text,
  instance_name text,
  attempt_count integer
)
LANGUAGE plpgsql
SET search_path = calendar, crm, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_limit integer;
BEGIN
  IF COALESCE(p_limit, 25) <= 0 THEN
    RETURN;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);

  RETURN QUERY
  WITH candidates AS (
    SELECT e.id
    FROM calendar.events AS e
    WHERE e.deleted_at IS NULL
      AND e.followup_1h_enabled IS TRUE
      AND e.followup_1h_status = 'pending'
      AND e.status IN ('scheduled', 'confirmed')
      AND e.start_time - interval '1 hour' <= v_now
      AND e.start_time > v_now
      AND (
        e.followup_1h_last_attempt_at IS NULL
        OR e.followup_1h_last_attempt_at <= v_now - interval '5 minutes'
      )
    ORDER BY e.start_time, e.created_at
    LIMIT v_limit
    FOR UPDATE OF e SKIP LOCKED
  ),
  claimed AS (
    UPDATE calendar.events AS e
    SET
      followup_1h_status = 'sending',
      followup_1h_last_attempt_at = v_now,
      followup_1h_error = NULL,
      metadata = jsonb_set(
        jsonb_set(
          COALESCE(e.metadata, '{}'::jsonb),
          '{followup_1h_attempt_count}',
          to_jsonb(
            CASE
              WHEN COALESCE(e.metadata ->> 'followup_1h_attempt_count', '') ~ '^[0-9]+$'
                THEN (e.metadata ->> 'followup_1h_attempt_count')::integer + 1
              ELSE 1
            END
          ),
          true
        ),
        '{followup_1h_claimed_at}',
        to_jsonb(v_now::text),
        true
      ),
      updated_at = v_now
    FROM candidates
    WHERE e.id = candidates.id
    RETURNING e.*
  )
  SELECT
    claimed.id,
    claimed.aces_id,
    claimed.lead_id,
    claimed.title::text,
    claimed.description::text,
    claimed.start_time,
    claimed.end_time,
    claimed.all_day,
    claimed.location::text,
    claimed.meeting_url::text,
    claimed.metadata,
    lead.name::text,
    lead.contact_phone::text,
    lead.instancia::text,
    CASE
      WHEN COALESCE(claimed.metadata ->> 'followup_1h_attempt_count', '') ~ '^[0-9]+$'
        THEN (claimed.metadata ->> 'followup_1h_attempt_count')::integer
      ELSE 1
    END
  FROM claimed
  JOIN crm.leads AS lead ON lead.id = claimed.lead_id;
END;
$$;

-- Remove two variables that are not read by the current legacy function bodies.
DO $cleanup$
DECLARE
  v_definition text;
BEGIN
  SELECT pg_get_functiondef('crm.rpc_claim_due_automation_executions_v2(integer)'::regprocedure)
  INTO v_definition;
  v_definition := replace(v_definition, '  v_reason text;', '');
  EXECUTE v_definition;

  SELECT pg_get_functiondef(
    'public.rpc_create_lead(text,text,text,text,text,text,uuid,text,numeric,text)'::regprocedure
  ) INTO v_definition;
  v_definition := replace(v_definition, '  v_active_duplicate_lead crm.leads%ROWTYPE;', '');
  v_definition := replace(
    v_definition,
    E'SELECT *\n  INTO v_active_duplicate_lead\n  FROM crm.leads',
    E'PERFORM 1\n  FROM crm.leads'
  );
  EXECUTE v_definition;
END;
$cleanup$;

-- ---------------------------------------------------------------------------
-- 2. Lean company directory and deterministic tenant-scoped lookup.
-- ---------------------------------------------------------------------------

ALTER TABLE crm.empresas
  ADD COLUMN legal_name text,
  ADD COLUMN phone text,
  ADD COLUMN email text,
  ADD COLUMN postal_code text,
  ADD COLUMN timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

UPDATE crm.empresas SET legal_name = name WHERE legal_name IS NULL;

ALTER TABLE crm.empresas
  ALTER COLUMN legal_name SET NOT NULL,
  ADD CONSTRAINT empresas_legal_name_not_blank CHECK (length(btrim(legal_name)) > 0),
  ADD CONSTRAINT empresas_email_check
    CHECK (email IS NULL OR (email = btrim(email) AND position('@' IN email) > 1)),
  ADD CONSTRAINT empresas_postal_code_check
    CHECK (postal_code IS NULL OR postal_code ~ '^[0-9]{8}$');

CREATE OR REPLACE FUNCTION crm.normalize_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.aces_id := COALESCE(NEW.aces_id, public.current_aces_id());
  NEW.cnpj := crm.normalize_cnpj(NEW.cnpj);
  NEW.legal_name := NULLIF(btrim(NEW.legal_name), '');
  NEW.name := NULLIF(btrim(NEW.name), '');
  NEW.phone := NULLIF(btrim(NEW.phone), '');
  NEW.email := lower(NULLIF(btrim(NEW.email), ''));
  NEW.address := NULLIF(btrim(NEW.address), '');
  NEW.city := NULLIF(btrim(NEW.city), '');
  NEW.state := upper(NULLIF(btrim(NEW.state), ''));
  NEW.postal_code := NULLIF(regexp_replace(COALESCE(NEW.postal_code, ''), '[^0-9]', '', 'g'), '');
  NEW.timezone := COALESCE(NULLIF(btrim(NEW.timezone), ''), 'America/Sao_Paulo');

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.timezone) THEN
    RAISE EXCEPTION 'Timezone invalido';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, public.current_crm_user_id());
  ELSE
    NEW.updated_at := now();
  END IF;

  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM crm.users AS crm_user
    WHERE crm_user.id = NEW.created_by
      AND crm_user.aces_id = NEW.aces_id
  ) THEN
    RAISE EXCEPTION 'Usuario criador pertence a outra conta';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.lookup_company_directory(
  p_query text,
  p_service_query text DEFAULT NULL,
  p_professional_query text DEFAULT NULL,
  p_limit integer DEFAULT 4,
  p_aces_id integer DEFAULT NULL
)
RETURNS TABLE (
  company_id uuid,
  cnpj text,
  legal_name text,
  trade_name text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  postal_code text,
  timezone text,
  professionals jsonb,
  match_score real,
  is_ambiguous boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH input AS (
    SELECT
      NULLIF(crm.normalize_search_text(NULLIF(btrim(p_query), '')), '') AS company_query,
      NULLIF(crm.normalize_search_text(NULLIF(btrim(p_service_query), '')), '') AS service_query,
      NULLIF(crm.normalize_search_text(NULLIF(btrim(p_professional_query), '')), '') AS professional_query,
      LEAST(GREATEST(COALESCE(p_limit, 4), 1), 4) AS result_limit
  ),
  candidates AS (
    SELECT
      company.*,
      CASE
        WHEN input.company_query IS NULL THEN 0.5::real
        WHEN crm.normalize_search_text(company.cnpj) = input.company_query THEN 1::real
        WHEN crm.normalize_search_text(company.name) = input.company_query THEN 1::real
        WHEN crm.normalize_search_text(company.legal_name) = input.company_query THEN 0.98::real
        WHEN crm.normalize_search_text(company.name) LIKE '%' || input.company_query || '%' THEN 0.94::real
        WHEN crm.normalize_search_text(company.city) = input.company_query THEN 0.90::real
        ELSE extensions.similarity(company.search_key, input.company_query)::real
      END AS score
    FROM crm.empresas AS company
    CROSS JOIN input
    WHERE p_aces_id IS NOT NULL
      AND company.aces_id = p_aces_id
      AND company.is_active IS TRUE
      AND (
        input.company_query IS NULL
        OR company.search_key LIKE '%' || input.company_query || '%'
        OR extensions.similarity(company.search_key, input.company_query) >= 0.20
      )
      AND (
        input.professional_query IS NULL
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations AS location
          JOIN calendar.professionals AS professional
            ON professional.id = location.professional_id
           AND professional.aces_id = location.aces_id
          WHERE location.aces_id = company.aces_id
            AND location.empresa_id = company.id
            AND location.is_active IS TRUE
            AND location.is_ai_visible IS TRUE
            AND professional.is_active IS TRUE
            AND crm.normalize_search_text(professional.name || ' ' || COALESCE(professional.specialty, ''))
              LIKE '%' || input.professional_query || '%'
        )
      )
      AND (
        input.service_query IS NULL
        OR EXISTS (
          SELECT 1
          FROM calendar.professional_locations AS location
          JOIN calendar.professional_services AS binding
            ON binding.professional_location_id = location.id
           AND binding.aces_id = location.aces_id
           AND binding.is_active IS TRUE
           AND binding.is_ai_visible IS TRUE
          JOIN calendar.services AS service
            ON service.id = binding.service_id
           AND service.aces_id = binding.aces_id
           AND service.is_active IS TRUE
           AND service.is_ai_visible IS TRUE
          WHERE location.aces_id = company.aces_id
            AND location.empresa_id = company.id
            AND location.is_active IS TRUE
            AND location.is_ai_visible IS TRUE
            AND crm.normalize_search_text(service.name || ' ' || COALESCE(service.description, ''))
              LIKE '%' || input.service_query || '%'
        )
      )
  ),
  ranked AS (
    SELECT candidates.*, count(*) OVER () AS result_count
    FROM candidates
    ORDER BY candidates.score DESC, candidates.name
    LIMIT (SELECT result_limit FROM input)
  )
  SELECT
    ranked.id,
    ranked.cnpj,
    ranked.legal_name,
    ranked.name,
    ranked.phone,
    ranked.email,
    ranked.address,
    ranked.city,
    ranked.state,
    ranked.postal_code,
    ranked.timezone,
    COALESCE(directory.professionals, '[]'::jsonb),
    ranked.score,
    ranked.result_count > 1
  FROM ranked
  CROSS JOIN input
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(entry.value ORDER BY entry.professional_name) AS professionals
    FROM (
      SELECT
        professional.name AS professional_name,
        jsonb_build_object(
          'professional_id', professional.id,
          'professional_location_id', location.id,
          'name', professional.name,
          'specialty', professional.specialty,
          'services', COALESCE(services.items, '[]'::jsonb)
        ) AS value
      FROM calendar.professional_locations AS location
      JOIN calendar.professionals AS professional
        ON professional.id = location.professional_id
       AND professional.aces_id = location.aces_id
       AND professional.is_active IS TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(
          jsonb_build_object(
            'service_id', service.id,
            'name', service.name,
            'duration_minutes', COALESCE(binding.duration_minutes_override, service.duration_minutes),
            'price_cents', COALESCE(binding.price_cents_override, service.price_cents)
          )
          ORDER BY service.name
        ) AS items
        FROM calendar.professional_services AS binding
        JOIN calendar.services AS service
          ON service.id = binding.service_id
         AND service.aces_id = binding.aces_id
         AND service.is_active IS TRUE
         AND service.is_ai_visible IS TRUE
        WHERE binding.aces_id = ranked.aces_id
          AND binding.professional_location_id = location.id
          AND binding.is_active IS TRUE
          AND binding.is_ai_visible IS TRUE
          AND (
            input.service_query IS NULL
            OR crm.normalize_search_text(service.name || ' ' || COALESCE(service.description, ''))
              LIKE '%' || input.service_query || '%'
          )
      ) AS services ON TRUE
      WHERE location.aces_id = ranked.aces_id
        AND location.empresa_id = ranked.id
        AND location.is_active IS TRUE
        AND location.is_ai_visible IS TRUE
        AND (
          input.professional_query IS NULL
          OR crm.normalize_search_text(professional.name || ' ' || COALESCE(professional.specialty, ''))
            LIKE '%' || input.professional_query || '%'
        )
      ORDER BY professional.name
      LIMIT 4
    ) AS entry
  ) AS directory ON TRUE
  ORDER BY ranked.score DESC, ranked.name;
$$;

REVOKE ALL ON FUNCTION crm.lookup_company_directory(text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.lookup_company_directory(text, text, text, integer, integer)
  TO service_role;

-- The legacy implementation updated the old and new attendance stages in one
-- statement. PostgreSQL can check the partial unique index between row updates,
-- causing a transient duplicate `active_service` key. Clear the previous stage
-- first, then designate the new one inside the same transaction.
CREATE OR REPLACE FUNCTION crm.rpc_designate_attendance_stage(
  p_pipeline_id uuid,
  p_stage_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_aces_id integer;
  v_previous_stage_id uuid;
BEGIN
  IF NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem transferir a etapa de Atendimento';
  END IF;

  SELECT pipeline.aces_id INTO v_aces_id
  FROM crm.pipelines AS pipeline
  WHERE pipeline.id = p_pipeline_id
    AND pipeline.aces_id = public.current_aces_id()
    AND pipeline.is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pipeline nao encontrado para a conta atual';
  END IF;

  PERFORM 1
  FROM crm.pipeline_stages AS stage
  WHERE stage.id = p_stage_id
    AND stage.pipeline_id = p_pipeline_id
    AND stage.aces_id = v_aces_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa nao pertence ao pipeline informado';
  END IF;

  SELECT stage.id INTO v_previous_stage_id
  FROM crm.pipeline_stages AS stage
  WHERE stage.pipeline_id = p_pipeline_id
    AND stage.classifier_semantic_key = 'active_service'
  FOR UPDATE;

  IF v_previous_stage_id IS DISTINCT FROM p_stage_id THEN
    UPDATE crm.pipeline_stages
    SET
      classifier_semantic_key = NULL,
      classifier_is_destination = true,
      updated_at = now()
    WHERE id = v_previous_stage_id;

    UPDATE crm.pipeline_stages
    SET
      classifier_semantic_key = 'active_service',
      classifier_is_destination = false,
      updated_at = now()
    WHERE id = p_stage_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pipeline_id', p_pipeline_id,
    'stage_id', p_stage_id,
    'previous_stage_id', v_previous_stage_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION crm.rpc_designate_attendance_stage(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_designate_attendance_stage(uuid, uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Calendar Tool, conversation state and transactional cancellation.
-- ---------------------------------------------------------------------------

INSERT INTO agents.tool_definitions (
  tool_key,
  version,
  display_name,
  description,
  icon,
  config_schema,
  is_active
)
VALUES (
  'calendar',
  1,
  'Agenda',
  'Consulta disponibilidade e gerencia agendamentos profissionais.',
  'calendar-days',
  jsonb_build_object(
    'type', 'object',
    'properties', jsonb_build_object(
      'queryAvailability', jsonb_build_object('type', 'boolean', 'default', false),
      'create', jsonb_build_object('type', 'boolean', 'default', false),
      'reschedule', jsonb_build_object('type', 'boolean', 'default', false),
      'cancel', jsonb_build_object('type', 'boolean', 'default', false)
    )
  ),
  true
)
ON CONFLICT (tool_key, version) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    config_schema = EXCLUDED.config_schema,
    is_active = true,
    updated_at = now();

INSERT INTO agents.agent_tools (
  aces_id,
  agent_id,
  tool_key,
  tool_version,
  is_enabled,
  readiness,
  config
)
SELECT
  agent.aces_id,
  agent.id,
  'calendar',
  1,
  false,
  'needs_config',
  jsonb_build_object(
    'queryAvailability', false,
    'create', false,
    'reschedule', false,
    'cancel', false
  )
FROM agents.ai_agents AS agent
ON CONFLICT (agent_id, tool_key) DO NOTHING;

ALTER TABLE agents.ai_lead_state
  ADD COLUMN agenda_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN agenda_context_expires_at timestamptz,
  ADD CONSTRAINT ai_lead_state_agenda_context_object_check
    CHECK (jsonb_typeof(agenda_context) = 'object');

CREATE OR REPLACE FUNCTION calendar.cancel_professional_appointment(
  p_event_id uuid,
  p_reason text
)
RETURNS calendar.events
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_event calendar.events%ROWTYPE;
  v_reason text := NULLIF(btrim(p_reason), '');
BEGIN
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'Motivo do cancelamento e obrigatorio';
  END IF;

  SELECT * INTO v_event
  FROM calendar.events AS event
  WHERE event.id = p_event_id
    AND event.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_event.professional_location_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento profissional nao encontrado';
  END IF;

  IF current_user <> 'service_role' THEN
    IF v_event.aces_id <> public.current_aces_id()
      OR NOT crm.current_user_can_edit_lead(v_event.lead_id) THEN
      RAISE EXCEPTION 'Acesso negado ao agendamento';
    END IF;
  END IF;

  IF v_event.status = 'cancelled' THEN
    RETURN v_event;
  END IF;

  UPDATE calendar.events
  SET status = 'cancelled',
      cancel_reason = v_reason,
      metadata = jsonb_set(
        jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{cancelled_at}',
          to_jsonb(now()::text),
          true
        ),
        '{cancelled_by_user_id}',
        COALESCE(to_jsonb(public.current_crm_user_id()), 'null'::jsonb),
        true
      ),
      updated_at = now()
  WHERE id = p_event_id
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION calendar.cancel_professional_appointment(uuid, text)
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION calendar.cancel_professional_appointment(uuid, text)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION calendar.validate_settings_timezone()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.timezone := NULLIF(btrim(NEW.timezone), '');
  IF NEW.timezone IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names() AS timezone_name
    WHERE timezone_name.name = NEW.timezone
  ) THEN
    RAISE EXCEPTION 'Fuso horario invalido';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calendar_settings_timezone
BEFORE INSERT OR UPDATE OF timezone ON calendar.settings
FOR EACH ROW EXECUTE FUNCTION calendar.validate_settings_timezone();

CREATE OR REPLACE FUNCTION calendar.service_reschedule_professional_appointment(
  p_event_id uuid,
  p_start_time timestamptz,
  p_aces_id integer
)
RETURNS calendar.events
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_event calendar.events%ROWTYPE;
  v_slot record;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  SELECT * INTO v_event
  FROM calendar.events AS event
  WHERE event.id = p_event_id
    AND event.aces_id = p_aces_id
    AND event.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND OR v_event.professional_location_id IS NULL OR v_event.service_id IS NULL THEN
    RAISE EXCEPTION 'Agendamento profissional nao encontrado';
  END IF;

  SELECT * INTO v_slot
  FROM calendar.list_available_slots(
    v_event.professional_location_id,
    v_event.service_id,
    (p_start_time AT TIME ZONE COALESCE(
      (SELECT settings.timezone FROM calendar.settings AS settings WHERE settings.aces_id = p_aces_id),
      'America/Sao_Paulo'
    ))::date,
    (p_start_time AT TIME ZONE COALESCE(
      (SELECT settings.timezone FROM calendar.settings AS settings WHERE settings.aces_id = p_aces_id),
      'America/Sao_Paulo'
    ))::date,
    NULL,
    200,
    v_event.id,
    p_aces_id
  ) AS slot
  WHERE slot.slot_start = p_start_time
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SLOT_UNAVAILABLE';
  END IF;

  BEGIN
    UPDATE calendar.events
    SET start_time = v_slot.slot_start,
        end_time = v_slot.slot_end,
        updated_at = now(),
        metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{rescheduled_by}',
          '"ai"'::jsonb,
          true
        )
    WHERE id = v_event.id
    RETURNING * INTO v_event;
  EXCEPTION
    WHEN exclusion_violation THEN
      RAISE EXCEPTION 'SLOT_UNAVAILABLE';
  END;

  RETURN v_event;
END;
$$;

REVOKE ALL ON FUNCTION calendar.service_reschedule_professional_appointment(uuid, timestamptz, integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION calendar.service_reschedule_professional_appointment(uuid, timestamptz, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Normalized company queue and atomic claiming.
-- ---------------------------------------------------------------------------

ALTER TABLE crm.routing_events
  ADD COLUMN queue_status text,
  ADD COLUMN claimed_by_user_id uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN closed_at timestamptz;

UPDATE crm.routing_events
SET queue_status = 'closed',
    claimed_by_user_id = COALESCE(
      (
        SELECT (snapshot.value #>> '{}')::uuid
        FROM jsonb_array_elements(seller_ids_snapshot) WITH ORDINALITY AS snapshot(value, position)
        ORDER BY snapshot.position
        LIMIT 1
      ),
      (
        SELECT crm_user.id
        FROM crm.users AS crm_user
        WHERE crm_user.aces_id = routing_events.aces_id
          AND crm_user.role = 'ADMIN'::crm.user_role
        ORDER BY crm_user.created_at
        LIMIT 1
      )
    ),
    claimed_at = COALESCE(completed_at, created_at),
    closed_at = COALESCE(completed_at, created_at)
WHERE destination_mode = 'internal_company';

-- Historical malformed events without an eligible owner remain audit records,
-- but are explicitly cancelled instead of entering the operational queue.
UPDATE crm.routing_events
SET queue_status = 'cancelled',
    claimed_by_user_id = NULL,
    claimed_at = NULL,
    closed_at = COALESCE(completed_at, created_at)
WHERE destination_mode = 'internal_company'
  AND claimed_by_user_id IS NULL;

-- Add the constraints only after the historical rows have been normalized.
-- This keeps the migration safe for production databases that already contain
-- internal-company routing audit records.
ALTER TABLE crm.routing_events
  ADD CONSTRAINT routing_events_queue_status_check
    CHECK (queue_status IS NULL OR queue_status IN ('waiting', 'claimed', 'closed', 'cancelled')),
  ADD CONSTRAINT routing_events_queue_shape_check
    CHECK (
      (destination_mode = 'internal_company' AND queue_status IS NOT NULL)
      OR (destination_mode <> 'internal_company' AND queue_status IS NULL)
    ),
  ADD CONSTRAINT routing_events_claim_shape_check
    CHECK (
      (queue_status IN ('claimed', 'closed') AND claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL)
      OR (queue_status IN ('waiting', 'cancelled') AND claimed_by_user_id IS NULL)
      OR queue_status IS NULL
    );

CREATE INDEX idx_routing_events_queue
  ON crm.routing_events(aces_id, queue_status, created_at DESC)
  WHERE destination_mode = 'internal_company';

CREATE INDEX idx_routing_events_claimed_by
  ON crm.routing_events(aces_id, claimed_by_user_id, claimed_at DESC)
  WHERE claimed_by_user_id IS NOT NULL;

CREATE TABLE crm.routing_event_recipients (
  routing_event_id uuid NOT NULL REFERENCES crm.routing_events(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (routing_event_id, crm_user_id)
);

CREATE INDEX idx_routing_event_recipients_user
  ON crm.routing_event_recipients(aces_id, crm_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION crm.validate_routing_event_recipient()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM crm.routing_events AS routing_event
    JOIN crm.users AS crm_user
      ON crm_user.id = NEW.crm_user_id
     AND crm_user.aces_id = routing_event.aces_id
    WHERE routing_event.id = NEW.routing_event_id
      AND routing_event.aces_id = NEW.aces_id
      AND routing_event.destination_mode = 'internal_company'
  ) THEN
    RAISE EXCEPTION 'Destinatario do encaminhamento pertence a outra conta';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_routing_event_recipients_validate
BEFORE INSERT OR UPDATE ON crm.routing_event_recipients
FOR EACH ROW EXECUTE FUNCTION crm.validate_routing_event_recipient();

ALTER TABLE crm.routing_event_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY routing_event_recipients_select
  ON crm.routing_event_recipients
  FOR SELECT
  TO authenticated
  USING (
    aces_id = public.current_aces_id()
    AND (
      crm.current_user_is_account_admin()
      OR crm_user_id = public.current_crm_user_id()
    )
  );

DROP POLICY routing_events_account_select ON crm.routing_events;
CREATE POLICY routing_events_account_select
  ON crm.routing_events
  FOR SELECT
  TO authenticated
  USING (
    aces_id = public.current_aces_id()
    AND crm.current_user_can_access_lead(lead_id)
    AND (
      destination_mode <> 'internal_company'
      OR crm.current_user_is_account_admin()
      OR EXISTS (
        SELECT 1
        FROM crm.routing_event_recipients AS recipient
        WHERE recipient.routing_event_id = routing_events.id
          AND recipient.aces_id = routing_events.aces_id
          AND recipient.crm_user_id = public.current_crm_user_id()
      )
    )
  );

ALTER TABLE crm.notifications
  ADD COLUMN routing_event_id uuid REFERENCES crm.routing_events(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_notifications_routing_event_unique
  ON crm.notifications(routing_event_id)
  WHERE routing_event_id IS NOT NULL;

DROP POLICY notifications_read_accessible ON crm.notifications;
CREATE POLICY notifications_read_accessible
  ON crm.notifications
  FOR SELECT
  TO authenticated
  USING (
    published_at <= now()
    AND (
      (
        routing_event_id IS NULL
        AND (
          (category = 'notice' AND (aces_id IS NULL OR aces_id = public.current_aces_id()))
          OR (
            category = 'internal'
            AND aces_id = public.current_aces_id()
            AND lead_id IS NOT NULL
            AND crm.current_user_can_access_lead(lead_id)
          )
        )
      )
      OR (
        routing_event_id IS NOT NULL
        AND aces_id = public.current_aces_id()
        AND (
          crm.current_user_is_account_admin()
          OR EXISTS (
            SELECT 1
            FROM crm.routing_event_recipients AS recipient
            WHERE recipient.routing_event_id = notifications.routing_event_id
              AND recipient.aces_id = notifications.aces_id
              AND recipient.crm_user_id = public.current_crm_user_id()
          )
        )
      )
    )
  );

REVOKE ALL ON crm.routing_event_recipients
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.routing_event_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.routing_event_recipients TO service_role;

CREATE OR REPLACE FUNCTION crm.service_route_company_lead(
  p_aces_id integer,
  p_lead_id uuid,
  p_source_agent_id uuid,
  p_forwarding_destination_id uuid,
  p_reason text,
  p_context_snapshot jsonb DEFAULT '{}'::jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_lead crm.leads%ROWTYPE;
  v_destination agents.forwarding_destinations%ROWTYPE;
  v_company crm.empresas%ROWTYPE;
  v_routing_event crm.routing_events%ROWTYPE;
  v_seller_ids uuid[];
  v_seller_snapshot jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  IF p_aces_id IS NULL OR p_lead_id IS NULL OR p_forwarding_destination_id IS NULL THEN
    RAISE EXCEPTION 'Parametros de encaminhamento incompletos';
  END IF;

  IF p_context_snapshot IS NULL OR jsonb_typeof(p_context_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Contexto do encaminhamento deve ser um objeto';
  END IF;

  IF NULLIF(btrim(p_idempotency_key), '') IS NOT NULL THEN
    SELECT * INTO v_routing_event
    FROM crm.routing_events AS routing_event
    WHERE routing_event.aces_id = p_aces_id
      AND routing_event.idempotency_key = btrim(p_idempotency_key)
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', v_routing_event.status = 'completed',
        'fallback_required', v_routing_event.status = 'failed',
        'routing_event_id', v_routing_event.id,
        'queue_status', v_routing_event.queue_status,
        'seller_ids', v_routing_event.seller_ids_snapshot
      );
    END IF;
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads AS lead
  WHERE lead.id = p_lead_id
    AND lead.aces_id = p_aces_id
    AND COALESCE(lead.view, true) IS TRUE
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado';
  END IF;

  SELECT * INTO v_destination
  FROM agents.forwarding_destinations AS destination
  WHERE destination.id = p_forwarding_destination_id
    AND destination.aces_id = p_aces_id
    AND destination.mode = 'internal_company'
    AND destination.is_active IS TRUE;

  IF NOT FOUND OR v_destination.empresa_id IS NULL THEN
    RAISE EXCEPTION 'Destino empresarial nao encontrado';
  END IF;

  SELECT * INTO v_company
  FROM crm.empresas AS company
  WHERE company.id = v_destination.empresa_id
    AND company.aces_id = p_aces_id
    AND company.is_active IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empresa do destino nao encontrada ou inativa';
  END IF;

  SELECT
    array_agg(crm_user.id ORDER BY crm_user.name, crm_user.id),
    COALESCE(jsonb_agg(to_jsonb(crm_user.id) ORDER BY crm_user.name, crm_user.id), '[]'::jsonb)
  INTO v_seller_ids, v_seller_snapshot
  FROM agents.forwarding_destination_sellers AS selected
  JOIN crm.users AS crm_user
    ON crm_user.id = selected.crm_user_id
   AND crm_user.aces_id = selected.aces_id
   AND crm_user.role = 'VENDEDOR'::crm.user_role
  JOIN crm.empresa_memberships AS company_access
    ON company_access.crm_user_id = crm_user.id
   AND company_access.aces_id = crm_user.aces_id
   AND company_access.empresa_id = v_company.id
   AND company_access.is_active IS TRUE
  JOIN crm.instance_access_memberships AS instance_access
    ON instance_access.crm_user_id = crm_user.id
   AND instance_access.aces_id = crm_user.aces_id
   AND instance_access.instance_name = v_lead.instancia
   AND instance_access.is_active IS TRUE
   AND instance_access.access_level IN ('editor', 'admin')
  WHERE selected.forwarding_destination_id = v_destination.id
    AND selected.aces_id = p_aces_id;

  IF COALESCE(array_length(v_seller_ids, 1), 0) = 0 THEN
    INSERT INTO crm.routing_events (
      aces_id,
      lead_id,
      source_agent_id,
      forwarding_destination_id,
      empresa_id,
      destination_mode,
      status,
      queue_status,
      reason,
      seller_ids_snapshot,
      context_snapshot,
      idempotency_key,
      completed_at,
      closed_at,
      error_message
    ) VALUES (
      p_aces_id,
      p_lead_id,
      p_source_agent_id,
      v_destination.id,
      v_company.id,
      'internal_company',
      'failed',
      'cancelled',
      NULLIF(btrim(p_reason), ''),
      '[]'::jsonb,
      p_context_snapshot,
      NULLIF(btrim(p_idempotency_key), ''),
      now(),
      now(),
      'NO_ELIGIBLE_SELLERS'
    )
    RETURNING * INTO v_routing_event;

    RETURN jsonb_build_object(
      'success', false,
      'fallback_required', true,
      'routing_event_id', v_routing_event.id,
      'queue_status', v_routing_event.queue_status,
      'seller_ids', '[]'::jsonb
    );
  END IF;

  INSERT INTO crm.routing_events (
    aces_id,
    lead_id,
    source_agent_id,
    forwarding_destination_id,
    empresa_id,
    destination_mode,
    status,
    queue_status,
    reason,
    seller_ids_snapshot,
    context_snapshot,
    idempotency_key,
    completed_at
  ) VALUES (
    p_aces_id,
    p_lead_id,
    p_source_agent_id,
    v_destination.id,
    v_company.id,
    'internal_company',
    'completed',
    'waiting',
    NULLIF(btrim(p_reason), ''),
    v_seller_snapshot,
    p_context_snapshot,
    NULLIF(btrim(p_idempotency_key), ''),
    now()
  )
  RETURNING * INTO v_routing_event;

  INSERT INTO crm.routing_event_recipients(routing_event_id, aces_id, crm_user_id)
  SELECT v_routing_event.id, p_aces_id, seller_id
  FROM unnest(v_seller_ids) AS seller_id
  ON CONFLICT (routing_event_id, crm_user_id) DO NOTHING;

  UPDATE crm.leads
  SET empresa_id = v_company.id,
      interaction_mode = 'human',
      owner_id = NULL,
      updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = p_aces_id;

  UPDATE agents.ai_lead_state
  SET agenda_context = '{}'::jsonb,
      agenda_context_expires_at = NULL,
      updated_at = now()
  WHERE lead_id = p_lead_id;

  INSERT INTO crm.notifications (
    aces_id,
    category,
    event_type,
    title,
    description,
    lead_id,
    routing_event_id,
    action_path,
    idempotency_key
  ) VALUES (
    p_aces_id,
    'internal',
    'company_forwarding_waiting',
    'Novo atendimento encaminhado',
    COALESCE(v_lead.name, 'Lead') || ' aguarda atendimento em ' || v_company.name || '.',
    p_lead_id,
    v_routing_event.id,
    '/chat?lead=' || p_lead_id::text || '&routing=' || v_routing_event.id::text,
    'routing-event:' || v_routing_event.id::text
  );

  RETURN jsonb_build_object(
    'success', true,
    'fallback_required', false,
    'routing_event_id', v_routing_event.id,
    'queue_status', v_routing_event.queue_status,
    'seller_ids', v_seller_snapshot,
    'company_id', v_company.id,
    'company_name', v_company.name
  );
END;
$$;

REVOKE ALL ON FUNCTION crm.service_route_company_lead(integer, uuid, uuid, uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.service_route_company_lead(integer, uuid, uuid, uuid, text, jsonb, text)
  TO service_role;

CREATE OR REPLACE FUNCTION crm.rpc_list_routing_queue(
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  routing_event_id uuid,
  lead_id uuid,
  lead_name text,
  empresa_id uuid,
  empresa_name text,
  queue_status text,
  reason text,
  created_at timestamptz,
  claimed_by_user_id uuid,
  claimed_by_name text,
  is_recipient boolean,
  can_claim boolean
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    routing_event.id,
    routing_event.lead_id,
    lead.name::text,
    routing_event.empresa_id,
    company.name::text,
    routing_event.queue_status,
    routing_event.reason,
    routing_event.created_at,
    routing_event.claimed_by_user_id,
    claimed_by.name::text,
    recipient.crm_user_id IS NOT NULL,
    routing_event.queue_status = 'waiting'
      AND recipient.crm_user_id IS NOT NULL
      AND crm.current_user_can_access_instance(lead.instancia, 'editor')
  FROM crm.routing_events AS routing_event
  JOIN crm.leads AS lead
    ON lead.id = routing_event.lead_id
   AND lead.aces_id = routing_event.aces_id
  LEFT JOIN crm.empresas AS company
    ON company.id = routing_event.empresa_id
   AND company.aces_id = routing_event.aces_id
  LEFT JOIN crm.users AS claimed_by
    ON claimed_by.id = routing_event.claimed_by_user_id
   AND claimed_by.aces_id = routing_event.aces_id
  LEFT JOIN crm.routing_event_recipients AS recipient
    ON recipient.routing_event_id = routing_event.id
   AND recipient.aces_id = routing_event.aces_id
   AND recipient.crm_user_id = public.current_crm_user_id()
  WHERE routing_event.aces_id = public.current_aces_id()
    AND routing_event.destination_mode = 'internal_company'
    AND (p_status IS NULL OR routing_event.queue_status = p_status)
    AND (p_before IS NULL OR routing_event.created_at < p_before)
  ORDER BY
    CASE routing_event.queue_status WHEN 'waiting' THEN 0 WHEN 'claimed' THEN 1 ELSE 2 END,
    routing_event.created_at DESC,
    routing_event.id DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 100);
$$;

CREATE OR REPLACE FUNCTION crm.rpc_claim_routing_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_actor_id uuid := public.current_crm_user_id();
  v_event crm.routing_events%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
BEGIN
  IF v_aces_id IS NULL OR v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Usuario CRM nao encontrado';
  END IF;

  SELECT * INTO v_event
  FROM crm.routing_events AS routing_event
  WHERE routing_event.id = p_event_id
    AND routing_event.aces_id = v_aces_id
    AND routing_event.destination_mode = 'internal_company'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encaminhamento nao encontrado';
  END IF;

  IF v_event.queue_status <> 'waiting' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'queue_status', v_event.queue_status,
      'claimed_by_user_id', v_event.claimed_by_user_id
    );
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads AS lead
  WHERE lead.id = v_event.lead_id
    AND lead.aces_id = v_aces_id
  FOR UPDATE;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.routing_event_recipients AS recipient
    JOIN crm.users AS crm_user
      ON crm_user.id = recipient.crm_user_id
     AND crm_user.aces_id = recipient.aces_id
     AND crm_user.role = 'VENDEDOR'::crm.user_role
    JOIN crm.empresa_memberships AS company_access
      ON company_access.crm_user_id = crm_user.id
     AND company_access.aces_id = crm_user.aces_id
     AND company_access.empresa_id = v_event.empresa_id
     AND company_access.is_active IS TRUE
    WHERE recipient.routing_event_id = v_event.id
      AND recipient.aces_id = v_aces_id
      AND recipient.crm_user_id = v_actor_id
  ) OR NOT crm.current_user_can_access_instance(v_lead.instancia, 'editor') THEN
    RAISE EXCEPTION 'Usuario nao autorizado a assumir este atendimento';
  END IF;

  UPDATE crm.routing_events
  SET queue_status = 'claimed',
      claimed_by_user_id = v_actor_id,
      claimed_at = now()
  WHERE id = v_event.id
    AND queue_status = 'waiting'
  RETURNING * INTO v_event;

  IF NOT FOUND THEN
    SELECT * INTO v_event FROM crm.routing_events WHERE id = p_event_id;
    RETURN jsonb_build_object(
      'claimed', false,
      'queue_status', v_event.queue_status,
      'claimed_by_user_id', v_event.claimed_by_user_id
    );
  END IF;

  UPDATE crm.leads
  SET owner_id = v_actor_id,
      interaction_mode = 'human',
      updated_at = now()
  WHERE id = v_event.lead_id
    AND aces_id = v_aces_id;

  INSERT INTO crm.bi_outbox (
    aces_id, aggregate_type, aggregate_id, event_type, payload
  ) VALUES (
    v_aces_id,
    'routing_event',
    v_event.id,
    'company_forwarding.claimed',
    jsonb_build_object(
      'routing_event_id', v_event.id,
      'lead_id', v_event.lead_id,
      'claimed_by_user_id', v_actor_id
    )
  );

  RETURN jsonb_build_object(
    'claimed', true,
    'queue_status', v_event.queue_status,
    'claimed_by_user_id', v_actor_id,
    'claimed_at', v_event.claimed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_reassign_routing_event(
  p_event_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_event crm.routing_events%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
BEGIN
  IF v_aces_id IS NULL OR NOT crm.current_user_is_account_admin() THEN
    RAISE EXCEPTION 'Apenas administradores podem reatribuir atendimentos';
  END IF;

  SELECT * INTO v_event
  FROM crm.routing_events AS routing_event
  WHERE routing_event.id = p_event_id
    AND routing_event.aces_id = v_aces_id
    AND routing_event.destination_mode = 'internal_company'
    AND routing_event.queue_status IN ('waiting', 'claimed')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encaminhamento ativo nao encontrado';
  END IF;

  SELECT * INTO v_lead
  FROM crm.leads AS lead
  WHERE lead.id = v_event.lead_id
    AND lead.aces_id = v_aces_id;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.users AS crm_user
    JOIN crm.empresa_memberships AS company_access
      ON company_access.crm_user_id = crm_user.id
     AND company_access.aces_id = crm_user.aces_id
     AND company_access.empresa_id = v_event.empresa_id
     AND company_access.is_active IS TRUE
    JOIN crm.instance_access_memberships AS instance_access
      ON instance_access.crm_user_id = crm_user.id
     AND instance_access.aces_id = crm_user.aces_id
     AND instance_access.instance_name = v_lead.instancia
     AND instance_access.is_active IS TRUE
     AND instance_access.access_level IN ('editor', 'admin')
    WHERE crm_user.id = p_user_id
      AND crm_user.aces_id = v_aces_id
      AND crm_user.role = 'VENDEDOR'::crm.user_role
  ) THEN
    RAISE EXCEPTION 'Vendedor nao possui acesso ativo a empresa e a instancia';
  END IF;

  INSERT INTO crm.routing_event_recipients(routing_event_id, aces_id, crm_user_id)
  VALUES (v_event.id, v_aces_id, p_user_id)
  ON CONFLICT (routing_event_id, crm_user_id) DO NOTHING;

  UPDATE crm.routing_events
  SET queue_status = 'claimed',
      claimed_by_user_id = p_user_id,
      claimed_at = now()
  WHERE id = v_event.id;

  UPDATE crm.leads
  SET owner_id = p_user_id,
      interaction_mode = 'human',
      updated_at = now()
  WHERE id = v_event.lead_id
    AND aces_id = v_aces_id;

  RETURN jsonb_build_object(
    'reassigned', true,
    'queue_status', 'claimed',
    'claimed_by_user_id', p_user_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_close_routing_event(p_event_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_actor_id uuid := public.current_crm_user_id();
  v_event crm.routing_events%ROWTYPE;
BEGIN
  SELECT * INTO v_event
  FROM crm.routing_events AS routing_event
  WHERE routing_event.id = p_event_id
    AND routing_event.aces_id = v_aces_id
    AND routing_event.destination_mode = 'internal_company'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Encaminhamento nao encontrado';
  END IF;

  IF NOT crm.current_user_is_account_admin()
    AND v_event.claimed_by_user_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'Usuario nao autorizado a finalizar este encaminhamento';
  END IF;

  IF v_event.queue_status = 'closed' THEN
    RETURN jsonb_build_object('closed', true, 'closed_at', v_event.closed_at);
  END IF;

  IF v_event.queue_status <> 'claimed' THEN
    RAISE EXCEPTION 'Somente atendimentos assumidos podem ser finalizados';
  END IF;

  UPDATE crm.routing_events
  SET queue_status = 'closed',
      closed_at = now()
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN jsonb_build_object('closed', true, 'closed_at', v_event.closed_at);
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_list_routing_queue(text, integer, timestamptz)
  FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_claim_routing_event(uuid)
  FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_reassign_routing_event(uuid, uuid)
  FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_close_routing_event(uuid)
  FROM PUBLIC, anon, authenticator;

GRANT EXECUTE ON FUNCTION crm.rpc_list_routing_queue(text, integer, timestamptz)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_routing_event(uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_reassign_routing_event(uuid, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_close_routing_event(uuid)
  TO authenticated;

-- Service-only alert thresholds. The view exposes aggregate operational
-- counters and technical identifiers, never conversation content.
CREATE OR REPLACE VIEW crm.company_calendar_operational_alerts
WITH (security_invoker = true)
AS
WITH tool_failures AS (
  SELECT
    event.aces_id,
    'tool_failures_10m'::text AS alert_key,
    'warning'::text AS severity,
    count(*)::numeric AS metric,
    5::numeric AS threshold,
    jsonb_build_object('window_minutes', 10) AS metadata
  FROM crm.bi_outbox AS event
  WHERE event.created_at >= now() - interval '10 minutes'
    AND event.event_type IN (
      'company_lookup.failed',
      'calendar_availability.failed',
      'calendar_booking.failed',
      'company_forwarding.failed'
    )
  GROUP BY event.aces_id
  HAVING count(*) >= 5
), denied_mutations AS (
  SELECT
    event.aces_id,
    'unauthorized_calendar_mutation'::text AS alert_key,
    'critical'::text AS severity,
    count(*)::numeric AS metric,
    1::numeric AS threshold,
    jsonb_build_object('window_minutes', 10) AS metadata
  FROM crm.bi_outbox AS event
  WHERE event.created_at >= now() - interval '10 minutes'
    AND event.event_type = 'calendar_booking.denied'
  GROUP BY event.aces_id
), stale_queue AS (
  SELECT
    routing_event.aces_id,
    'routing_queue_waiting_15m'::text AS alert_key,
    'warning'::text AS severity,
    count(*)::numeric AS metric,
    1::numeric AS threshold,
    jsonb_build_object(
      'oldest_created_at', min(routing_event.created_at),
      'window_minutes', 15
    ) AS metadata
  FROM crm.routing_events AS routing_event
  WHERE routing_event.destination_mode = 'internal_company'
    AND routing_event.queue_status = 'waiting'
    AND routing_event.created_at <= now() - interval '15 minutes'
  GROUP BY routing_event.aces_id
), forwarding_rate AS (
  SELECT
    event.aces_id,
    count(*) FILTER (WHERE event.event_type = 'company_forwarding.fallback')::numeric
      / NULLIF(count(*) FILTER (
          WHERE event.event_type IN ('company_forwarding.waiting', 'company_forwarding.fallback')
        ), 0)::numeric AS fallback_rate,
    count(*) FILTER (
      WHERE event.event_type IN ('company_forwarding.waiting', 'company_forwarding.fallback')
    ) AS total
  FROM crm.bi_outbox AS event
  WHERE event.created_at >= now() - interval '30 minutes'
  GROUP BY event.aces_id
), fallback_alert AS (
  SELECT
    forwarding_rate.aces_id,
    'company_forwarding_fallback_rate_30m'::text AS alert_key,
    'warning'::text AS severity,
    forwarding_rate.fallback_rate AS metric,
    0.05::numeric AS threshold,
    jsonb_build_object('window_minutes', 30, 'total', forwarding_rate.total) AS metadata
  FROM forwarding_rate
  WHERE forwarding_rate.total > 0
    AND forwarding_rate.fallback_rate > 0.05
)
SELECT aces_id, alert_key, severity, metric, threshold, now() AS detected_at, metadata
FROM tool_failures
UNION ALL
SELECT aces_id, alert_key, severity, metric, threshold, now(), metadata
FROM denied_mutations
UNION ALL
SELECT aces_id, alert_key, severity, metric, threshold, now(), metadata
FROM stale_queue
UNION ALL
SELECT aces_id, alert_key, severity, metric, threshold, now(), metadata
FROM fallback_alert;

REVOKE ALL ON crm.company_calendar_operational_alerts
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON crm.company_calendar_operational_alerts TO service_role;

NOTIFY pgrst, 'reload schema';
