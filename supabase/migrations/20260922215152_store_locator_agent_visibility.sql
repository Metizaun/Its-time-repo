-- Store visibility is account-wide by default and can be overridden per AI.
-- A missing row means visible; false rows are explicit per-agent exclusions.

CREATE TABLE locator.agent_store_visibility (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES locator.stores(id) ON DELETE CASCADE,
  is_visible boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, store_id),
  CONSTRAINT locator_agent_store_visibility_account_unique UNIQUE (aces_id, agent_id, store_id)
);

COMMENT ON TABLE locator.agent_store_visibility IS
  'Per-agent visibility overrides for store locator branches. Missing rows inherit account-wide visibility.';
COMMENT ON COLUMN locator.agent_store_visibility.is_visible IS
  'False hides the branch only from this agent; true removes the override semantically.';

CREATE INDEX locator_agent_store_visibility_lookup_idx
  ON locator.agent_store_visibility (aces_id, agent_id, is_visible, store_id);
CREATE INDEX locator_agent_store_visibility_store_idx
  ON locator.agent_store_visibility (store_id);

CREATE OR REPLACE FUNCTION locator.enforce_agent_store_visibility_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_agent_aces_id integer;
  v_store_aces_id integer;
BEGIN
  SELECT aces_id INTO v_agent_aces_id
  FROM agents.ai_agents
  WHERE id = NEW.agent_id;

  SELECT aces_id INTO v_store_aces_id
  FROM locator.stores
  WHERE id = NEW.store_id;

  IF v_agent_aces_id IS DISTINCT FROM NEW.aces_id THEN
    RAISE EXCEPTION 'Agent does not belong to the requested account';
  END IF;

  IF v_store_aces_id IS DISTINCT FROM NEW.aces_id THEN
    RAISE EXCEPTION 'Store does not belong to the requested account';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER locator_agent_store_visibility_tenant_integrity
BEFORE INSERT OR UPDATE ON locator.agent_store_visibility
FOR EACH ROW EXECUTE FUNCTION locator.enforce_agent_store_visibility_tenant_integrity();

CREATE TRIGGER locator_agent_store_visibility_touch_updated_at
BEFORE UPDATE ON locator.agent_store_visibility
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION locator.find_nearest_stores_for_agent(
  p_aces_id integer,
  p_agent_id uuid,
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
    AND EXISTS (
      SELECT 1
      FROM agents.ai_agents AS agent
      WHERE agent.id = p_agent_id
        AND agent.aces_id = p_aces_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM locator.agent_store_visibility AS visibility
      WHERE visibility.aces_id = p_aces_id
        AND visibility.agent_id = p_agent_id
        AND visibility.store_id = store.id
        AND visibility.is_visible IS FALSE
    )
  ORDER BY store.location OPERATOR(extensions.<->) extensions.st_setsrid(
    extensions.st_makepoint(p_longitude, p_latitude),
    4326
  )::extensions.geography
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 5), 1), 20);
$$;

ALTER TABLE locator.agent_store_visibility ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE locator.agent_store_visibility FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION locator.find_nearest_stores_for_agent(integer, uuid, double precision, double precision, integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE locator.agent_store_visibility TO service_role;
GRANT EXECUTE ON FUNCTION locator.find_nearest_stores_for_agent(integer, uuid, double precision, double precision, integer) TO service_role;

NOTIFY pgrst, 'reload schema';
