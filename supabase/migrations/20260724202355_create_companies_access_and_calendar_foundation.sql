-- Optional company access and professional calendar foundation.
--
-- The migration is backwards-compatible: existing leads keep empresa_id NULL,
-- which preserves the current instance-only access rules.

-- ---------------------------------------------------------------------------
-- 1. Alphanumeric CNPJ support and lean operational companies.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION crm.normalize_cnpj(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT NULLIF(
    upper(regexp_replace(COALESCE(p_value, ''), '[^0-9A-Za-z]', '', 'g')),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION crm.is_valid_cnpj(p_value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  v_cnpj text := crm.normalize_cnpj(p_value);
  v_weights_first integer[] := ARRAY[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  v_weights_second integer[] := ARRAY[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  v_sum integer := 0;
  v_remainder integer;
  v_first_digit integer;
  v_second_digit integer;
  v_character_value integer;
BEGIN
  IF v_cnpj IS NULL OR v_cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' THEN
    RETURN FALSE;
  END IF;

  IF v_cnpj ~ '^([0-9])\1{13}$' THEN
    RETURN FALSE;
  END IF;

  FOR v_index IN 1..12 LOOP
    v_character_value := ascii(substr(v_cnpj, v_index, 1)) - 48;
    v_sum := v_sum + (v_character_value * v_weights_first[v_index]);
  END LOOP;

  v_remainder := v_sum % 11;
  v_first_digit := CASE WHEN v_remainder < 2 THEN 0 ELSE 11 - v_remainder END;

  IF v_first_digit <> substr(v_cnpj, 13, 1)::integer THEN
    RETURN FALSE;
  END IF;

  v_sum := 0;
  FOR v_index IN 1..12 LOOP
    v_character_value := ascii(substr(v_cnpj, v_index, 1)) - 48;
    v_sum := v_sum + (v_character_value * v_weights_second[v_index]);
  END LOOP;
  v_sum := v_sum + (v_first_digit * v_weights_second[13]);

  v_remainder := v_sum % 11;
  v_second_digit := CASE WHEN v_remainder < 2 THEN 0 ELSE 11 - v_remainder END;

  RETURN v_second_digit = substr(v_cnpj, 14, 1)::integer;
END;
$$;

REVOKE ALL ON FUNCTION crm.normalize_cnpj(text) FROM PUBLIC, anon, authenticator;
REVOKE ALL ON FUNCTION crm.is_valid_cnpj(text) FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION crm.normalize_cnpj(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION crm.is_valid_cnpj(text) TO authenticated, service_role;

CREATE TABLE crm.empresas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  cnpj text NOT NULL,
  name text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresas_account_id_unique UNIQUE (aces_id, id),
  CONSTRAINT empresas_account_cnpj_unique UNIQUE (aces_id, cnpj),
  CONSTRAINT empresas_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT empresas_address_not_blank CHECK (length(btrim(address)) > 0),
  CONSTRAINT empresas_city_not_blank CHECK (length(btrim(city)) > 0),
  CONSTRAINT empresas_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT empresas_cnpj_check CHECK (crm.is_valid_cnpj(cnpj))
);

CREATE INDEX idx_empresas_account_active_name
  ON crm.empresas(aces_id, is_active, name);

CREATE INDEX idx_empresas_account_city
  ON crm.empresas(aces_id, city)
  WHERE is_active IS TRUE;

CREATE OR REPLACE FUNCTION crm.normalize_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.aces_id := COALESCE(NEW.aces_id, public.current_aces_id());
  NEW.cnpj := crm.normalize_cnpj(NEW.cnpj);
  NEW.name := NULLIF(btrim(NEW.name), '');
  NEW.address := NULLIF(btrim(NEW.address), '');
  NEW.city := NULLIF(btrim(NEW.city), '');
  NEW.state := upper(NULLIF(btrim(NEW.state), ''));

  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(NEW.created_by, public.current_crm_user_id());
  ELSE
    NEW.updated_at := now();
  END IF;

  IF NEW.created_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM crm.users AS u
    WHERE u.id = NEW.created_by
      AND u.aces_id = NEW.aces_id
  ) THEN
    RAISE EXCEPTION 'Usuario criador pertence a outra conta';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_empresas_normalize
BEFORE INSERT OR UPDATE ON crm.empresas
FOR EACH ROW EXECUTE FUNCTION crm.normalize_empresa();

CREATE TABLE crm.empresa_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL REFERENCES crm.empresas(id) ON DELETE CASCADE,
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT empresa_memberships_unique UNIQUE (empresa_id, crm_user_id),
  CONSTRAINT empresa_memberships_revoked_check
    CHECK (is_active IS TRUE OR revoked_at IS NOT NULL)
);

CREATE INDEX idx_empresa_memberships_user
  ON crm.empresa_memberships(aces_id, crm_user_id, empresa_id)
  WHERE is_active IS TRUE;

CREATE INDEX idx_empresa_memberships_empresa
  ON crm.empresa_memberships(aces_id, empresa_id, crm_user_id)
  WHERE is_active IS TRUE;

CREATE OR REPLACE FUNCTION crm.validate_empresa_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM crm.empresas AS e
    WHERE e.id = NEW.empresa_id
      AND e.aces_id = NEW.aces_id
  ) THEN
    RAISE EXCEPTION 'Empresa pertence a outra conta';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.users AS u
    WHERE u.id = NEW.crm_user_id
      AND u.aces_id = NEW.aces_id
      AND u.role = 'VENDEDOR'::crm.user_role
  ) THEN
    RAISE EXCEPTION 'Usuario precisa ser um vendedor da mesma conta';
  END IF;

  IF NEW.granted_by IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM crm.users AS u
    WHERE u.id = NEW.granted_by
      AND u.aces_id = NEW.aces_id
  ) THEN
    RAISE EXCEPTION 'Usuario concedente pertence a outra conta';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_empresa_memberships_validate
BEFORE INSERT OR UPDATE ON crm.empresa_memberships
FOR EACH ROW EXECUTE FUNCTION crm.validate_empresa_membership();

CREATE OR REPLACE FUNCTION crm.current_user_has_empresa_access(p_empresa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_empresa_id IS NULL OR EXISTS (
    SELECT 1
    FROM crm.users AS u
    JOIN crm.empresas AS e
      ON e.aces_id = u.aces_id
     AND e.id = p_empresa_id
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND (
        u.role = 'ADMIN'::crm.user_role
        OR EXISTS (
          SELECT 1
          FROM crm.empresa_memberships AS em
          WHERE em.aces_id = u.aces_id
            AND em.empresa_id = e.id
            AND em.crm_user_id = u.id
            AND em.is_active IS TRUE
        )
      )
  );
$$;

REVOKE ALL ON FUNCTION crm.current_user_has_empresa_access(uuid)
  FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION crm.current_user_has_empresa_access(uuid)
  TO authenticated, service_role;

ALTER TABLE crm.empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.empresa_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY empresas_select
ON crm.empresas FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_has_empresa_access(id)
);

CREATE POLICY empresas_insert
ON crm.empresas FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
);

CREATE POLICY empresas_update
ON crm.empresas FOR UPDATE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
);

CREATE POLICY empresas_delete
ON crm.empresas FOR DELETE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
);

CREATE POLICY empresa_memberships_select
ON crm.empresa_memberships FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND (
    crm.current_user_is_account_admin()
    OR crm_user_id = public.current_crm_user_id()
  )
);

CREATE POLICY empresa_memberships_insert
ON crm.empresa_memberships FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.crm_user_belongs_to_current_account(crm_user_id)
);

CREATE POLICY empresa_memberships_update
ON crm.empresa_memberships FOR UPDATE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
  AND crm.crm_user_belongs_to_current_account(crm_user_id)
);

CREATE POLICY empresa_memberships_delete
ON crm.empresa_memberships FOR DELETE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.current_user_is_account_admin()
);

REVOKE ALL ON crm.empresas FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON crm.empresa_memberships FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.empresas TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.empresa_memberships TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Optional company scope on leads.
-- ---------------------------------------------------------------------------

ALTER TABLE crm.leads
  ADD COLUMN empresa_id uuid REFERENCES crm.empresas(id) ON DELETE SET NULL;

CREATE INDEX idx_leads_account_empresa
  ON crm.leads(aces_id, empresa_id, last_message_at DESC)
  WHERE empresa_id IS NOT NULL;

CREATE OR REPLACE FUNCTION crm.validate_lead_empresa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.empresa_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM crm.empresas AS e
    WHERE e.id = NEW.empresa_id
      AND e.aces_id = NEW.aces_id
      AND e.is_active IS TRUE
  ) THEN
    RAISE EXCEPTION 'Empresa do lead nao existe, esta inativa ou pertence a outra conta';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_leads_validate_empresa
BEFORE INSERT OR UPDATE OF aces_id, empresa_id ON crm.leads
FOR EACH ROW EXECUTE FUNCTION crm.validate_lead_empresa();

CREATE OR REPLACE FUNCTION crm.current_user_can_access_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads AS l
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND (
        crm.current_user_is_account_admin()
        OR (
          crm.current_user_can_access_instance(l.instancia, 'viewer')
          AND crm.current_user_has_empresa_access(l.empresa_id)
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION crm.current_user_can_edit_lead(p_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.leads AS l
    WHERE l.id = p_lead_id
      AND l.aces_id = public.current_aces_id()
      AND (
        crm.current_user_is_account_admin()
        OR (
          crm.current_user_can_access_instance(l.instancia, 'editor')
          AND crm.current_user_has_empresa_access(l.empresa_id)
        )
      )
  );
$$;

DROP POLICY IF EXISTS leads_insert ON crm.leads;
CREATE POLICY leads_insert
ON crm.leads FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_instance(instancia, 'editor')
  AND crm.crm_user_belongs_to_current_account(owner_id)
  AND crm.current_user_has_empresa_access(empresa_id)
  AND (
    crm.current_user_is_account_admin()
    OR owner_id IS NULL
    OR owner_id = public.current_crm_user_id()
  )
);

DROP POLICY IF EXISTS leads_update ON crm.leads;
CREATE POLICY leads_update
ON crm.leads FOR UPDATE TO authenticated
USING (crm.current_user_can_edit_lead(id))
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.current_user_can_access_instance(instancia, 'editor')
  AND crm.current_user_has_empresa_access(empresa_id)
  AND crm.crm_user_belongs_to_current_account(owner_id)
);

DO $view_order$
DECLARE
  v_aces_position integer;
  v_identity_columns text;
BEGIN
  SELECT column_definition.ordinal_position
  INTO v_aces_position
  FROM information_schema.columns AS column_definition
  WHERE column_definition.table_schema = 'crm'
    AND column_definition.table_name = 'v_lead_details'
    AND column_definition.column_name = 'aces_id';

  IF v_aces_position = 25 THEN
    v_identity_columns := $columns$
      l.aces_id,
      l.interaction_mode,
      CASE
        WHEN l.interaction_mode <> 'human' THEN NULL::text
        WHEN handoff_state.last_handoff_at IS NULL THEN 'clear'
        WHEN handoff_state.last_human_reply_at IS NULL THEN 'waiting_first_reply'
        WHEN handoff_state.last_lead_inbound_at IS NOT NULL
          AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
          THEN 'waiting_reply'
        ELSE 'clear'
      END AS manual_pending_state,
      CASE
        WHEN l.interaction_mode <> 'human' THEN NULL::timestamptz
        WHEN handoff_state.last_handoff_at IS NULL THEN NULL::timestamptz
        WHEN handoff_state.last_human_reply_at IS NULL THEN handoff_state.last_handoff_at
        WHEN handoff_state.last_lead_inbound_at IS NOT NULL
          AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
          THEN handoff_state.last_lead_inbound_at
        ELSE NULL::timestamptz
      END AS manual_pending_since
    $columns$;
  ELSIF v_aces_position = 28 THEN
    v_identity_columns := $columns$
      l.interaction_mode,
      CASE
        WHEN l.interaction_mode <> 'human' THEN NULL::text
        WHEN handoff_state.last_handoff_at IS NULL THEN 'clear'
        WHEN handoff_state.last_human_reply_at IS NULL THEN 'waiting_first_reply'
        WHEN handoff_state.last_lead_inbound_at IS NOT NULL
          AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
          THEN 'waiting_reply'
        ELSE 'clear'
      END AS manual_pending_state,
      CASE
        WHEN l.interaction_mode <> 'human' THEN NULL::timestamptz
        WHEN handoff_state.last_handoff_at IS NULL THEN NULL::timestamptz
        WHEN handoff_state.last_human_reply_at IS NULL THEN handoff_state.last_handoff_at
        WHEN handoff_state.last_lead_inbound_at IS NOT NULL
          AND handoff_state.last_lead_inbound_at > handoff_state.last_human_reply_at
          THEN handoff_state.last_lead_inbound_at
        ELSE NULL::timestamptz
      END AS manual_pending_since,
      l.aces_id
    $columns$;
  ELSE
    RAISE EXCEPTION
      'Assinatura inesperada de crm.v_lead_details: aces_id na posicao %',
      v_aces_position;
  END IF;

  EXECUTE format($view_sql$
    CREATE OR REPLACE VIEW crm.v_lead_details AS
    SELECT
      l.id,
      l.name AS lead_name,
      l.email,
      l.contact_phone,
      l."Fonte" AS source,
      l.status,
      l.stage_id,
      l.created_at,
      l.updated_at,
      l.last_message_at,
      l.last_city,
      l.last_region,
      l.last_country,
      l.lead_number,
      owner_user.name AS owner_name,
      l.owner_id,
      latest_opp.value,
      latest_opp.connection_level,
      latest_opp.status::text AS opportunity_status,
      l.notes,
      l.instancia AS instance_name,
      inst.color AS instance_color,
      latest_tag.last_tag_name,
      latest_tag.last_tag_urgencia,
      %s,
      l.empresa_id,
      empresa.name AS empresa_name,
      empresa.cnpj AS empresa_cnpj
    FROM crm.leads AS l
    LEFT JOIN crm.users AS owner_user
      ON owner_user.id = l.owner_id
     AND owner_user.aces_id = l.aces_id
    LEFT JOIN crm.instance AS inst
      ON inst.instancia = l.instancia
     AND inst.aces_id = l.aces_id
    LEFT JOIN crm.empresas AS empresa
      ON empresa.id = l.empresa_id
     AND empresa.aces_id = l.aces_id
    LEFT JOIN LATERAL (
      SELECT o.value, o.connection_level, o.status
      FROM crm.opportunities AS o
      WHERE o.lead_id = l.id
      ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
      LIMIT 1
    ) AS latest_opp ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        lt.tag_name AS last_tag_name,
        t.urgencia AS last_tag_urgencia
      FROM crm.lead_tags AS lt
      LEFT JOIN crm.tags AS t
        ON t.id = lt.tag_id
       AND t.aces_id = l.aces_id
      WHERE lt.lead_id = l.id
      ORDER BY lt.created_at DESC NULLS LAST
      LIMIT 1
    ) AS latest_tag ON TRUE
    LEFT JOIN LATERAL (
      WITH last_handoff AS (
        SELECT mh.sent_at
        FROM crm.message_history AS mh
        WHERE mh.lead_id = l.id
          AND mh.aces_id = l.aces_id
          AND mh.source_type = 'system'
          AND mh.content = 'Transferido para atendimento humano'
        ORDER BY mh.sent_at DESC, mh.id DESC
        LIMIT 1
      )
      SELECT
        lh.sent_at AS last_handoff_at,
        (
          SELECT mh.sent_at
          FROM crm.message_history AS mh
          WHERE mh.lead_id = l.id
            AND mh.aces_id = l.aces_id
            AND mh.source_type = 'human'
            AND mh.direction = 'outbound'
            AND mh.sent_at >= lh.sent_at
          ORDER BY mh.sent_at DESC, mh.id DESC
          LIMIT 1
        ) AS last_human_reply_at,
        (
          SELECT mh.sent_at
          FROM crm.message_history AS mh
          WHERE mh.lead_id = l.id
            AND mh.aces_id = l.aces_id
            AND mh.source_type = 'lead'
            AND mh.direction = 'inbound'
            AND mh.sent_at >= lh.sent_at
          ORDER BY mh.sent_at DESC, mh.id DESC
          LIMIT 1
        ) AS last_lead_inbound_at
      FROM last_handoff AS lh
    ) AS handoff_state ON TRUE
  $view_sql$, v_identity_columns);
END
$view_order$;

ALTER VIEW crm.v_lead_details SET (security_invoker = true);
GRANT SELECT ON crm.v_lead_details TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Professional calendar configuration.
-- ---------------------------------------------------------------------------

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA calendar
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM authenticated, authenticator;

CREATE TABLE calendar.settings (
  aces_id integer PRIMARY KEY REFERENCES crm.accounts(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  minimum_notice_minutes integer NOT NULL DEFAULT 60,
  booking_horizon_days integer NOT NULL DEFAULT 90,
  slot_interval_minutes integer NOT NULL DEFAULT 15,
  ai_booking_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_settings_notice_check CHECK (minimum_notice_minutes BETWEEN 0 AND 525600),
  CONSTRAINT calendar_settings_horizon_check CHECK (booking_horizon_days BETWEEN 1 AND 730),
  CONSTRAINT calendar_settings_interval_check CHECK (slot_interval_minutes IN (5, 10, 15, 20, 30, 60))
);

CREATE TABLE calendar.professionals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  specialty text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_professionals_account_id_unique UNIQUE (aces_id, id),
  CONSTRAINT calendar_professionals_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE INDEX idx_calendar_professionals_account_name
  ON calendar.professionals(aces_id, is_active, name);

CREATE TABLE calendar.professional_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  professional_id uuid NOT NULL REFERENCES calendar.professionals(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES crm.empresas(id) ON DELETE CASCADE,
  location_name text,
  is_active boolean NOT NULL DEFAULT true,
  is_ai_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_professional_locations_account_id_unique UNIQUE (aces_id, id),
  CONSTRAINT calendar_professional_location_name_check
    CHECK (empresa_id IS NOT NULL OR length(btrim(location_name)) > 0)
);

CREATE UNIQUE INDEX idx_professional_locations_company_unique
  ON calendar.professional_locations(professional_id, empresa_id)
  WHERE empresa_id IS NOT NULL;

CREATE UNIQUE INDEX idx_professional_locations_independent_unique
  ON calendar.professional_locations(professional_id)
  WHERE empresa_id IS NULL;

CREATE INDEX idx_professional_locations_account_company
  ON calendar.professional_locations(aces_id, empresa_id, is_active);

CREATE TABLE calendar.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_minutes integer NOT NULL DEFAULT 30,
  price_cents integer,
  buffer_before_minutes integer NOT NULL DEFAULT 0,
  buffer_after_minutes integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  is_ai_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_services_account_id_unique UNIQUE (aces_id, id),
  CONSTRAINT calendar_services_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT calendar_services_duration_check CHECK (duration_minutes BETWEEN 5 AND 1440),
  CONSTRAINT calendar_services_price_check CHECK (price_cents IS NULL OR price_cents >= 0),
  CONSTRAINT calendar_services_buffer_before_check CHECK (buffer_before_minutes BETWEEN 0 AND 720),
  CONSTRAINT calendar_services_buffer_after_check CHECK (buffer_after_minutes BETWEEN 0 AND 720)
);

CREATE INDEX idx_calendar_services_account_name
  ON calendar.services(aces_id, is_active, name);

CREATE TABLE calendar.professional_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  professional_location_id uuid NOT NULL REFERENCES calendar.professional_locations(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES calendar.services(id) ON DELETE CASCADE,
  duration_minutes_override integer,
  price_cents_override integer,
  buffer_before_minutes_override integer,
  buffer_after_minutes_override integer,
  is_active boolean NOT NULL DEFAULT true,
  is_ai_visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_professional_services_unique
    UNIQUE (professional_location_id, service_id),
  CONSTRAINT calendar_professional_services_duration_check
    CHECK (duration_minutes_override IS NULL OR duration_minutes_override BETWEEN 5 AND 1440),
  CONSTRAINT calendar_professional_services_price_check
    CHECK (price_cents_override IS NULL OR price_cents_override >= 0),
  CONSTRAINT calendar_professional_services_buffer_before_check
    CHECK (buffer_before_minutes_override IS NULL OR buffer_before_minutes_override BETWEEN 0 AND 720),
  CONSTRAINT calendar_professional_services_buffer_after_check
    CHECK (buffer_after_minutes_override IS NULL OR buffer_after_minutes_override BETWEEN 0 AND 720)
);

CREATE INDEX idx_professional_services_account_location
  ON calendar.professional_services(aces_id, professional_location_id, is_active);

CREATE TABLE calendar.availability_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  professional_location_id uuid NOT NULL REFERENCES calendar.professional_locations(id) ON DELETE CASCADE,
  weekday smallint NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  valid_from date,
  valid_until date,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_rules_weekday_check CHECK (weekday BETWEEN 0 AND 6),
  CONSTRAINT availability_rules_time_check CHECK (end_time > start_time),
  CONSTRAINT availability_rules_dates_check
    CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);

CREATE INDEX idx_availability_rules_location_weekday
  ON calendar.availability_rules(aces_id, professional_location_id, weekday)
  WHERE is_active IS TRUE;

CREATE TABLE calendar.availability_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  empresa_id uuid REFERENCES crm.empresas(id) ON DELETE CASCADE,
  professional_location_id uuid REFERENCES calendar.professional_locations(id) ON DELETE CASCADE,
  exception_type text NOT NULL DEFAULT 'block',
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_exceptions_type_check
    CHECK (exception_type IN ('block', 'pause', 'holiday', 'vacation')),
  CONSTRAINT availability_exceptions_range_check CHECK (ends_at > starts_at),
  CONSTRAINT availability_exceptions_scope_check
    CHECK (empresa_id IS NULL OR professional_location_id IS NULL)
);

CREATE INDEX idx_availability_exceptions_account_range
  ON calendar.availability_exceptions(aces_id, starts_at, ends_at)
  WHERE is_active IS TRUE;

CREATE OR REPLACE FUNCTION calendar.validate_tenant_reference()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_TABLE_NAME = 'professional_locations' THEN
    IF NOT EXISTS (
      SELECT 1 FROM calendar.professionals AS p
      WHERE p.id = NEW.professional_id AND p.aces_id = NEW.aces_id
    ) THEN
      RAISE EXCEPTION 'Profissional pertence a outra conta';
    END IF;

    IF NEW.empresa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM crm.empresas AS e
      WHERE e.id = NEW.empresa_id AND e.aces_id = NEW.aces_id
    ) THEN
      RAISE EXCEPTION 'Empresa pertence a outra conta';
    END IF;
  ELSIF TG_TABLE_NAME = 'professional_services' THEN
    IF NOT EXISTS (
      SELECT 1 FROM calendar.professional_locations AS pl
      WHERE pl.id = NEW.professional_location_id AND pl.aces_id = NEW.aces_id
    ) OR NOT EXISTS (
      SELECT 1 FROM calendar.services AS s
      WHERE s.id = NEW.service_id AND s.aces_id = NEW.aces_id
    ) THEN
      RAISE EXCEPTION 'Local profissional ou servico pertence a outra conta';
    END IF;
  ELSIF TG_TABLE_NAME = 'availability_rules' THEN
    IF NOT EXISTS (
      SELECT 1 FROM calendar.professional_locations AS pl
      WHERE pl.id = NEW.professional_location_id AND pl.aces_id = NEW.aces_id
    ) THEN
      RAISE EXCEPTION 'Local profissional pertence a outra conta';
    END IF;
  ELSIF TG_TABLE_NAME = 'availability_exceptions' THEN
    IF NEW.empresa_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM crm.empresas AS e
      WHERE e.id = NEW.empresa_id AND e.aces_id = NEW.aces_id
    ) THEN
      RAISE EXCEPTION 'Empresa pertence a outra conta';
    END IF;

    IF NEW.professional_location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM calendar.professional_locations AS pl
      WHERE pl.id = NEW.professional_location_id AND pl.aces_id = NEW.aces_id
    ) THEN
      RAISE EXCEPTION 'Local profissional pertence a outra conta';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_professional_locations_tenant
BEFORE INSERT OR UPDATE ON calendar.professional_locations
FOR EACH ROW EXECUTE FUNCTION calendar.validate_tenant_reference();

CREATE TRIGGER trg_professional_services_tenant
BEFORE INSERT OR UPDATE ON calendar.professional_services
FOR EACH ROW EXECUTE FUNCTION calendar.validate_tenant_reference();

CREATE TRIGGER trg_availability_rules_tenant
BEFORE INSERT OR UPDATE ON calendar.availability_rules
FOR EACH ROW EXECUTE FUNCTION calendar.validate_tenant_reference();

CREATE TRIGGER trg_availability_exceptions_tenant
BEFORE INSERT OR UPDATE ON calendar.availability_exceptions
FOR EACH ROW EXECUTE FUNCTION calendar.validate_tenant_reference();

CREATE TRIGGER trg_calendar_settings_updated_at
BEFORE UPDATE ON calendar.settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_calendar_professionals_updated_at
BEFORE UPDATE ON calendar.professionals
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_calendar_services_updated_at
BEFORE UPDATE ON calendar.services
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION calendar.enable_account_admin_rls(p_table regclass)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (aces_id = public.current_aces_id())',
    replace(p_table::text, '.', '_') || '_select',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())',
    replace(p_table::text, '.', '_') || '_insert',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin()) WITH CHECK (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())',
    replace(p_table::text, '.', '_') || '_update',
    p_table
  );
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR DELETE TO authenticated USING (aces_id = public.current_aces_id() AND crm.current_user_is_account_admin())',
    replace(p_table::text, '.', '_') || '_delete',
    p_table
  );
END;
$$;

SELECT calendar.enable_account_admin_rls('calendar.settings'::regclass);
SELECT calendar.enable_account_admin_rls('calendar.professionals'::regclass);
SELECT calendar.enable_account_admin_rls('calendar.professional_locations'::regclass);
SELECT calendar.enable_account_admin_rls('calendar.services'::regclass);
SELECT calendar.enable_account_admin_rls('calendar.professional_services'::regclass);
SELECT calendar.enable_account_admin_rls('calendar.availability_rules'::regclass);
SELECT calendar.enable_account_admin_rls('calendar.availability_exceptions'::regclass);

DROP FUNCTION calendar.enable_account_admin_rls(regclass);

REVOKE ALL ON calendar.settings FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON calendar.professionals FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON calendar.professional_locations FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON calendar.services FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON calendar.professional_services FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON calendar.availability_rules FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON calendar.availability_exceptions FROM PUBLIC, anon, authenticated, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.settings TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.professionals TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.professional_locations TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.services TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.professional_services TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.availability_rules TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON calendar.availability_exceptions TO authenticated, service_role;

ALTER TABLE calendar.events
  ADD COLUMN empresa_id uuid REFERENCES crm.empresas(id) ON DELETE SET NULL,
  ADD COLUMN professional_id uuid REFERENCES calendar.professionals(id) ON DELETE SET NULL,
  ADD COLUMN professional_location_id uuid REFERENCES calendar.professional_locations(id) ON DELETE SET NULL,
  ADD COLUMN service_id uuid REFERENCES calendar.services(id) ON DELETE SET NULL,
  ADD COLUMN booking_origin text NOT NULL DEFAULT 'manual',
  ADD COLUMN duration_minutes_snapshot integer,
  ADD COLUMN price_cents_snapshot integer,
  ADD COLUMN buffer_before_minutes_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN buffer_after_minutes_snapshot integer NOT NULL DEFAULT 0,
  ADD COLUMN idempotency_key text,
  ADD CONSTRAINT calendar_events_booking_origin_check
    CHECK (booking_origin IN ('manual', 'ai', 'api', 'import', 'external')),
  ADD CONSTRAINT calendar_events_duration_snapshot_check
    CHECK (duration_minutes_snapshot IS NULL OR duration_minutes_snapshot BETWEEN 5 AND 1440),
  ADD CONSTRAINT calendar_events_price_snapshot_check
    CHECK (price_cents_snapshot IS NULL OR price_cents_snapshot >= 0),
  ADD CONSTRAINT calendar_events_buffer_before_snapshot_check
    CHECK (buffer_before_minutes_snapshot BETWEEN 0 AND 720),
  ADD CONSTRAINT calendar_events_buffer_after_snapshot_check
    CHECK (buffer_after_minutes_snapshot BETWEEN 0 AND 720),
  ADD CONSTRAINT calendar_events_professional_shape_check
    CHECK (
      (professional_id IS NULL AND professional_location_id IS NULL AND service_id IS NULL)
      OR (professional_id IS NOT NULL AND professional_location_id IS NOT NULL AND service_id IS NOT NULL)
    );

CREATE UNIQUE INDEX idx_calendar_events_idempotency
  ON calendar.events(aces_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_calendar_events_professional_range
  ON calendar.events(aces_id, professional_id, start_time, end_time)
  WHERE professional_id IS NOT NULL
    AND deleted_at IS NULL
    AND status IN ('scheduled', 'confirmed');

CREATE INDEX idx_calendar_events_empresa_range
  ON calendar.events(aces_id, empresa_id, start_time)
  WHERE empresa_id IS NOT NULL AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
