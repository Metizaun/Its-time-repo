SET lock_timeout = '10s';
SET statement_timeout = '5min';

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron;

ALTER TABLE agents.ai_agents
  ALTER COLUMN model SET DEFAULT 'gemini-3.1-flash-lite';

UPDATE agents.ai_agents
SET model = 'gemini-3.1-flash-lite',
    updated_at = now()
WHERE model IN ('gemini-2.5-flash', 'gemini-2.5-flash-lite');

CREATE SCHEMA IF NOT EXISTS locator;

COMMENT ON SCHEMA locator IS
  'Private branch directory, geospatial lookup cache and lead branch preferences.';

REVOKE ALL ON SCHEMA locator FROM PUBLIC;
GRANT USAGE ON SCHEMA locator TO anon, authenticated, authenticator, service_role;

CREATE TABLE locator.stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  address_line text NOT NULL,
  address_number text,
  address_complement text,
  neighborhood text NOT NULL,
  city text NOT NULL,
  state char(2) NOT NULL,
  postal_code text NOT NULL,
  phone text,
  weekly_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  hours_exceptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  hours_notes text,
  formatted_address text,
  address_hash text NOT NULL,
  location extensions.geography(Point, 4326),
  geocode_status text NOT NULL DEFAULT 'pending',
  geocode_provider text,
  geocode_accuracy text,
  geocode_error text,
  geocoded_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  ai_visible boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locator_stores_display_name_check CHECK (length(btrim(display_name)) BETWEEN 2 AND 160),
  CONSTRAINT locator_stores_state_check CHECK (state ~ '^[A-Z]{2}$'),
  CONSTRAINT locator_stores_postal_code_check CHECK (postal_code ~ '^[0-9]{8}$'),
  CONSTRAINT locator_stores_weekly_hours_object_check CHECK (jsonb_typeof(weekly_hours) = 'object'),
  CONSTRAINT locator_stores_hours_exceptions_array_check CHECK (jsonb_typeof(hours_exceptions) = 'array'),
  CONSTRAINT locator_stores_geocode_status_check
    CHECK (geocode_status IN ('pending', 'ready', 'failed', 'needs_review')),
  CONSTRAINT locator_stores_geocode_consistency_check
    CHECK (
      (geocode_status = 'ready' AND location IS NOT NULL AND ai_visible = is_active)
      OR (geocode_status = 'needs_review' AND location IS NOT NULL AND ai_visible IS FALSE)
      OR (geocode_status IN ('pending', 'failed') AND location IS NULL AND ai_visible IS FALSE)
    )
);

COMMENT ON TABLE locator.stores IS
  'Branches used only by the store locator Tool. These rows are intentionally separate from crm.empresas.';
COMMENT ON COLUMN locator.stores.address_hash IS
  'SHA-256 of the normalized geocoding address; unchanged hashes do not trigger a new geocode.';
COMMENT ON COLUMN locator.stores.ai_visible IS
  'True only for active branches with a successful, reviewed geocode.';

CREATE UNIQUE INDEX locator_stores_account_name_address_uidx
  ON locator.stores (aces_id, lower(display_name), address_hash);
CREATE INDEX locator_stores_account_status_idx
  ON locator.stores (aces_id, geocode_status, display_name);
CREATE INDEX locator_stores_active_city_idx
  ON locator.stores (aces_id, state, city, neighborhood)
  WHERE is_active AND ai_visible;
CREATE INDEX locator_stores_location_gix
  ON locator.stores USING gist (location)
  WHERE is_active AND ai_visible;

CREATE TABLE locator.route_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  origin_key text NOT NULL,
  store_id uuid NOT NULL REFERENCES locator.stores(id) ON DELETE CASCADE,
  travel_mode text NOT NULL DEFAULT 'DRIVE',
  distance_meters integer NOT NULL,
  duration_seconds integer NOT NULL,
  provider text NOT NULL DEFAULT 'google_routes',
  provider_route_token text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locator_route_cache_unique UNIQUE (aces_id, origin_key, store_id, travel_mode),
  CONSTRAINT locator_route_cache_mode_check CHECK (travel_mode = 'DRIVE'),
  CONSTRAINT locator_route_cache_distance_check CHECK (distance_meters >= 0),
  CONSTRAINT locator_route_cache_duration_check CHECK (duration_seconds >= 0)
);

CREATE INDEX locator_route_cache_lookup_idx
  ON locator.route_cache (aces_id, origin_key, expires_at DESC);
CREATE INDEX locator_route_cache_expiry_idx
  ON locator.route_cache (expires_at);

CREATE TABLE locator.lead_store_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES locator.stores(id) ON DELETE RESTRICT,
  preference_type text NOT NULL,
  confirmed_by text NOT NULL DEFAULT 'lead',
  source_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locator_lead_store_preferences_type_check
    CHECK (preference_type IN ('favorite', 'secondary')),
  CONSTRAINT locator_lead_store_preferences_confirmed_by_check
    CHECK (confirmed_by IN ('lead', 'operator'))
);

CREATE UNIQUE INDEX locator_lead_store_preferences_current_type_uidx
  ON locator.lead_store_preferences (aces_id, lead_id, preference_type)
  WHERE superseded_at IS NULL;
CREATE INDEX locator_lead_store_preferences_lead_idx
  ON locator.lead_store_preferences (aces_id, lead_id, confirmed_at DESC);
CREATE INDEX locator_lead_store_preferences_store_idx
  ON locator.lead_store_preferences (store_id, confirmed_at DESC);

CREATE TABLE locator.lead_location_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  source_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  raw_location_text text NOT NULL,
  normalized_location_text text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  location extensions.geography(Point, 4326) NOT NULL,
  neighborhood text,
  city text,
  state char(2),
  geocode_provider text NOT NULL DEFAULT 'google_geocoding',
  recommended_store_id uuid REFERENCES locator.stores(id) ON DELETE SET NULL,
  recommended_store_address_hash text,
  candidate_store_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  selected_store_id uuid REFERENCES locator.stores(id) ON DELETE SET NULL,
  route_distance_meters integer,
  route_duration_seconds integer,
  captured_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '12 months'),
  CONSTRAINT locator_lead_location_state_check CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  CONSTRAINT locator_lead_location_latitude_check CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT locator_lead_location_longitude_check CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT locator_lead_location_expiry_check CHECK (expires_at > captured_at),
  CONSTRAINT locator_lead_location_distance_check
    CHECK (route_distance_meters IS NULL OR route_distance_meters >= 0),
  CONSTRAINT locator_lead_location_duration_check
    CHECK (route_duration_seconds IS NULL OR route_duration_seconds >= 0)
);

COMMENT ON TABLE locator.lead_location_events IS
  'Exact lead location events retained for 12 months for future aggregate analytics. No heatmap or Ads export is implemented here.';

CREATE INDEX locator_lead_location_events_lead_idx
  ON locator.lead_location_events (aces_id, lead_id, captured_at DESC);
CREATE INDEX locator_lead_location_events_expiry_idx
  ON locator.lead_location_events (expires_at);
CREATE INDEX locator_lead_location_events_location_gix
  ON locator.lead_location_events USING gist (location);

CREATE OR REPLACE FUNCTION locator.enforce_store_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_store_aces_id integer;
  v_lead_aces_id integer;
BEGIN
  IF NEW.store_id IS NOT NULL THEN
    SELECT aces_id INTO v_store_aces_id
    FROM locator.stores
    WHERE id = NEW.store_id;

    IF v_store_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Store does not belong to the requested account';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'lead_store_preferences' THEN
    SELECT aces_id INTO v_lead_aces_id
    FROM crm.leads
    WHERE id = NEW.lead_id;

    IF v_lead_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Lead does not belong to the requested account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER locator_route_cache_tenant_integrity
BEFORE INSERT OR UPDATE ON locator.route_cache
FOR EACH ROW EXECUTE FUNCTION locator.enforce_store_tenant_integrity();

CREATE TRIGGER locator_lead_store_preferences_tenant_integrity
BEFORE INSERT OR UPDATE ON locator.lead_store_preferences
FOR EACH ROW EXECUTE FUNCTION locator.enforce_store_tenant_integrity();

CREATE OR REPLACE FUNCTION locator.enforce_location_event_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_lead_aces_id integer;
  v_store_aces_id integer;
  v_agent_aces_id integer;
BEGIN
  SELECT aces_id INTO v_lead_aces_id
  FROM crm.leads
  WHERE id = NEW.lead_id;

  IF v_lead_aces_id IS DISTINCT FROM NEW.aces_id THEN
    RAISE EXCEPTION 'Lead does not belong to the requested account';
  END IF;

  IF NEW.agent_id IS NOT NULL THEN
    SELECT aces_id INTO v_agent_aces_id FROM agents.ai_agents WHERE id = NEW.agent_id;
    IF v_agent_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Agent does not belong to the requested account';
    END IF;
  END IF;

  IF NEW.recommended_store_id IS NOT NULL THEN
    SELECT aces_id INTO v_store_aces_id FROM locator.stores WHERE id = NEW.recommended_store_id;
    IF v_store_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Recommended store does not belong to the requested account';
    END IF;
  END IF;

  IF NEW.selected_store_id IS NOT NULL THEN
    SELECT aces_id INTO v_store_aces_id FROM locator.stores WHERE id = NEW.selected_store_id;
    IF v_store_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Selected store does not belong to the requested account';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.candidate_store_ids) AS candidate_store_id
    LEFT JOIN locator.stores AS candidate_store ON candidate_store.id = candidate_store_id
    WHERE candidate_store.aces_id IS DISTINCT FROM NEW.aces_id
  ) THEN
    RAISE EXCEPTION 'Candidate store does not belong to the requested account';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER locator_lead_location_events_tenant_integrity
BEFORE INSERT OR UPDATE ON locator.lead_location_events
FOR EACH ROW EXECUTE FUNCTION locator.enforce_location_event_tenant_integrity();

CREATE TRIGGER locator_stores_touch_updated_at
BEFORE UPDATE ON locator.stores
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER locator_route_cache_touch_updated_at
BEFORE UPDATE ON locator.route_cache
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION locator.find_nearest_stores(
  p_aces_id integer,
  p_latitude double precision,
  p_longitude double precision,
  p_limit integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  display_name text,
  address_line text,
  address_number text,
  address_complement text,
  neighborhood text,
  city text,
  state char(2),
  postal_code text,
  phone text,
  address_hash text,
  weekly_hours jsonb,
  hours_exceptions jsonb,
  hours_notes text,
  latitude double precision,
  longitude double precision,
  straight_line_distance_meters double precision
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    store.id,
    store.display_name,
    store.address_line,
    store.address_number,
    store.address_complement,
    store.neighborhood,
    store.city,
    store.state,
    store.postal_code,
    store.phone,
    store.address_hash,
    store.weekly_hours,
    store.hours_exceptions,
    store.hours_notes,
    extensions.st_y(store.location::extensions.geometry) AS latitude,
    extensions.st_x(store.location::extensions.geometry) AS longitude,
    extensions.st_distance(
      store.location,
      extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography
    ) AS straight_line_distance_meters
  FROM locator.stores AS store
  WHERE store.aces_id = p_aces_id
    AND store.is_active
    AND store.ai_visible
    AND store.geocode_status = 'ready'
  ORDER BY store.location OPERATOR(extensions.<->) extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude),
    4326
  )::extensions.geography
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
$$;

CREATE OR REPLACE FUNCTION locator.set_lead_store_preference(
  p_aces_id integer,
  p_lead_id uuid,
  p_store_id uuid,
  p_preference_type text,
  p_confirmed_by text DEFAULT 'lead',
  p_source_message_id uuid DEFAULT NULL
)
RETURNS locator.lead_store_preferences
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_preference locator.lead_store_preferences;
BEGIN
  IF p_preference_type NOT IN ('favorite', 'secondary') THEN
    RAISE EXCEPTION 'Invalid preference type';
  END IF;

  UPDATE locator.lead_store_preferences
  SET superseded_at = now()
  WHERE aces_id = p_aces_id
    AND lead_id = p_lead_id
    AND preference_type = p_preference_type
    AND superseded_at IS NULL
    AND store_id <> p_store_id;

  SELECT * INTO v_preference
  FROM locator.lead_store_preferences
  WHERE aces_id = p_aces_id
    AND lead_id = p_lead_id
    AND preference_type = p_preference_type
    AND store_id = p_store_id
    AND superseded_at IS NULL;

  IF v_preference.id IS NULL THEN
    INSERT INTO locator.lead_store_preferences (
      aces_id,
      lead_id,
      store_id,
      preference_type,
      confirmed_by,
      source_message_id
    )
    VALUES (
      p_aces_id,
      p_lead_id,
      p_store_id,
      p_preference_type,
      p_confirmed_by,
      p_source_message_id
    )
    RETURNING * INTO v_preference;
  END IF;

  RETURN v_preference;
END;
$$;

CREATE OR REPLACE FUNCTION locator.purge_expired_location_data(p_batch_size integer DEFAULT 5000)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH expired AS (
    SELECT id
    FROM locator.lead_location_events
    WHERE expires_at <= now()
    ORDER BY expires_at
    LIMIT LEAST(GREATEST(COALESCE(p_batch_size, 5000), 1), 50000)
  )
  DELETE FROM locator.lead_location_events AS event
  USING expired
  WHERE event.id = expired.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'locator_purge_expired_location_data_daily';
EXCEPTION
  WHEN undefined_table OR invalid_schema_name THEN
    NULL;
END;
$$;

SELECT cron.schedule(
  'locator_purge_expired_location_data_daily',
  '40 6 * * *',
  $$SELECT locator.purge_expired_location_data(50000);$$
);

ALTER TABLE locator.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE locator.route_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE locator.lead_store_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE locator.lead_location_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA locator FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA locator FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA locator TO service_role;
GRANT EXECUTE ON FUNCTION locator.find_nearest_stores(integer, double precision, double precision, integer) TO service_role;
GRANT EXECUTE ON FUNCTION locator.set_lead_store_preference(integer, uuid, uuid, text, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION locator.purge_expired_location_data(integer) TO service_role;

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
  'store_locator',
  1,
  'Busca de filiais',
  'Localiza e recomenda a filial mais adequada pelo tempo de carro.',
  'map-pinned',
  jsonb_build_object(
    'type', 'object',
    'properties', jsonb_build_object(
      'candidateLimit', jsonb_build_object('type', 'integer', 'minimum', 1, 'maximum', 10, 'default', 5),
      'routeCacheMinutes', jsonb_build_object('type', 'integer', 'minimum', 5, 'maximum', 120, 'default', 30),
      'travelMode', jsonb_build_object('type', 'string', 'enum', jsonb_build_array('DRIVE'), 'default', 'DRIVE'),
      'locationRetentionMonths', jsonb_build_object('type', 'integer', 'const', 12)
    ),
    'additionalProperties', false
  ),
  true
)
ON CONFLICT (tool_key, version) DO UPDATE
SET display_name = EXCLUDED.display_name,
    description = EXCLUDED.description,
    icon = EXCLUDED.icon,
    config_schema = EXCLUDED.config_schema,
    is_active = EXCLUDED.is_active,
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
  'store_locator',
  1,
  false,
  'needs_config',
  '{"candidateLimit":5,"routeCacheMinutes":30,"travelMode":"DRIVE","locationRetentionMonths":12}'::jsonb
FROM agents.ai_agents AS agent
ON CONFLICT (agent_id, tool_key) DO NOTHING;

INSERT INTO agents.agent_template_tools (
  template_key,
  template_version,
  tool_key,
  tool_version,
  display_order,
  default_enabled,
  default_readiness,
  default_config
)
SELECT
  template.template_key,
  template.version,
  'store_locator',
  1,
  COALESCE((SELECT max(existing.display_order) + 10
            FROM agents.agent_template_tools AS existing
            WHERE existing.template_key = template.template_key
              AND existing.template_version = template.version), 10),
  false,
  'needs_config',
  '{"candidateLimit":5,"routeCacheMinutes":30,"travelMode":"DRIVE","locationRetentionMonths":12}'::jsonb
FROM agents.agent_templates AS template
WHERE template.is_active
ON CONFLICT (template_key, template_version, tool_key) DO NOTHING;

ALTER ROLE authenticator SET pgrst.db_schemas =
  'public,storage,graphql_public,crm,meta,calendar,agents,bi,locator,gupshup,rb,instagram';

NOTIFY pgrst, 'reload config';
NOTIFY pgrst, 'reload schema';

;
