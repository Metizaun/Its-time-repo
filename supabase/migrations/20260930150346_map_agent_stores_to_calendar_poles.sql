CREATE TABLE locator.agent_store_calendar_poles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  source_store_id uuid NOT NULL REFERENCES locator.stores(id) ON DELETE CASCADE,
  pole_store_id uuid NOT NULL REFERENCES locator.stores(id) ON DELETE CASCADE,
  professional_location_id uuid NOT NULL REFERENCES calendar.professional_locations(id) ON DELETE CASCADE,
  pole_address_override text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_store_calendar_poles_unique
    UNIQUE (aces_id, agent_id, source_store_id, professional_location_id),
  CONSTRAINT agent_store_calendar_poles_address_check
    CHECK (pole_address_override IS NULL OR length(btrim(pole_address_override)) BETWEEN 5 AND 500)
);

COMMENT ON TABLE locator.agent_store_calendar_poles IS
  'Per-agent routing from a customer-selected store to one or more appointment poles and calendar locations.';

CREATE INDEX agent_store_calendar_poles_lookup_idx
  ON locator.agent_store_calendar_poles (aces_id, agent_id, source_store_id, is_active);

CREATE OR REPLACE FUNCTION locator.enforce_agent_store_calendar_pole_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_agent_aces_id integer;
  v_source_aces_id integer;
  v_pole_aces_id integer;
  v_location_aces_id integer;
BEGIN
  SELECT agent.aces_id INTO v_agent_aces_id
  FROM agents.ai_agents AS agent
  WHERE agent.id = NEW.agent_id;

  SELECT store.aces_id INTO v_source_aces_id
  FROM locator.stores AS store
  WHERE store.id = NEW.source_store_id;

  SELECT store.aces_id INTO v_pole_aces_id
  FROM locator.stores AS store
  WHERE store.id = NEW.pole_store_id;

  SELECT location.aces_id INTO v_location_aces_id
  FROM calendar.professional_locations AS location
  WHERE location.id = NEW.professional_location_id;

  IF NEW.aces_id IS DISTINCT FROM v_agent_aces_id
    OR NEW.aces_id IS DISTINCT FROM v_source_aces_id
    OR NEW.aces_id IS DISTINCT FROM v_pole_aces_id
    OR NEW.aces_id IS DISTINCT FROM v_location_aces_id THEN
    RAISE EXCEPTION 'STORE_CALENDAR_TENANT_MISMATCH'
      USING ERRCODE = '23514';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_store_calendar_poles_tenant_integrity
BEFORE INSERT OR UPDATE ON locator.agent_store_calendar_poles
FOR EACH ROW EXECUTE FUNCTION locator.enforce_agent_store_calendar_pole_tenant();

ALTER TABLE locator.agent_store_calendar_poles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE locator.agent_store_calendar_poles FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT ON TABLE locator.agent_store_calendar_poles TO service_role;

DO $seed$
DECLARE
  v_agent_id uuid;
  v_agent_count integer;
  v_seeded_rows integer;
BEGIN
  SELECT count(*) INTO v_agent_count
  FROM agents.ai_agents AS agent
  WHERE agent.aces_id = 13
    AND lower(agent.name) = 'emilia'
    AND agent.agent_type = 'primary'
    AND agent.is_active;

  IF v_agent_count = 0 THEN
    RAISE NOTICE 'Account 13 Emilia agent is absent; skipping tenant-specific route seed';
    RETURN;
  ELSIF v_agent_count <> 1 THEN
    RAISE EXCEPTION 'Expected one active primary Emilia agent for account 13; found %', v_agent_count;
  END IF;

  SELECT agent.id INTO v_agent_id
  FROM agents.ai_agents AS agent
  WHERE agent.aces_id = 13
    AND lower(agent.name) = 'emilia'
    AND agent.agent_type = 'primary'
    AND agent.is_active
  ORDER BY agent.created_at
  LIMIT 1;

  WITH route_config(source_name, pole_name, calendar_name, address_override) AS (
    VALUES
      ('Atacadão dos Óculos - Loja 01', 'Atacadão dos Óculos - Loja 01', 'Guarapari - Muquiçaba', NULL::text),
      ('Atacadão dos Óculos - Loja 07', 'Atacadão dos Óculos - Loja 07', 'Vila Velha - Terra Vermelha', NULL::text),
      ('Atacadão dos Óculos - Loja 08', 'Atacadão dos Óculos - Loja 08', 'Viana - Marcílio de Noronha', 'Av. Vitória, 47, CEP 29135-368, ao lado da Papelaria Beger, Marcílio de Noronha, Viana - ES'),
      ('Atacadão dos Óculos - Loja 09', 'Atacadão dos Óculos - Loja 09', 'Guarapari - Aeroporto', NULL::text),
      ('Atacadão dos Óculos - Loja 14', 'Atacadão dos Óculos - Loja 14', 'Vila Velha - Nossa Senhora da Penha', NULL::text),
      ('Atacadão dos Óculos - Loja 18', 'Atacadão dos Óculos - Loja 18', 'Vila Velha - Itapoã', NULL::text),
      ('Atacadão dos Óculos - Loja 22', 'Atacadão dos Óculos - Loja 22', 'Serra - Porto Canoa', NULL::text),
      ('Atacadão dos Óculos - Loja 24', 'Atacadão dos Óculos - Loja 24', 'Serra - Parque Res. Laranjeiras', NULL::text),
      ('Atacadão dos Óculos - Loja 28', 'Atacadão dos Óculos - Loja 28', 'Vila Velha - Centro', NULL::text),
      ('Atacadão dos Óculos - Loja 29', 'Atacadão dos Óculos - Loja 29', 'Guarapari - Centro', NULL::text),
      ('Atacadão dos Óculos - Loja 33', 'Atacadão dos Óculos - Loja 33', 'Cariacica - Campo Grande', NULL::text),
      ('Atacadão dos Óculos - Loja 02', 'Atacadão dos Óculos - Loja 01', 'Guarapari - Muquiçaba', NULL::text),
      ('Atacadão dos Óculos - Loja 02', 'Atacadão dos Óculos - Loja 09', 'Guarapari - Aeroporto', NULL::text),
      ('Atacadão dos Óculos - Loja 02', 'Atacadão dos Óculos - Loja 29', 'Guarapari - Centro', NULL::text),
      ('Atacadão dos Óculos - Loja 06', 'Atacadão dos Óculos - Loja 01', 'Guarapari - Muquiçaba', NULL::text),
      ('Atacadão dos Óculos - Loja 06', 'Atacadão dos Óculos - Loja 09', 'Guarapari - Aeroporto', NULL::text),
      ('Atacadão dos Óculos - Loja 06', 'Atacadão dos Óculos - Loja 29', 'Guarapari - Centro', NULL::text),
      ('Atacadão dos Óculos - Loja 19', 'Atacadão dos Óculos - Loja 01', 'Guarapari - Muquiçaba', NULL::text),
      ('Atacadão dos Óculos - Loja 19', 'Atacadão dos Óculos - Loja 09', 'Guarapari - Aeroporto', NULL::text),
      ('Atacadão dos Óculos - Loja 19', 'Atacadão dos Óculos - Loja 29', 'Guarapari - Centro', NULL::text),
      ('Atacadão dos Óculos - Loja 27', 'Atacadão dos Óculos - Loja 01', 'Guarapari - Muquiçaba', NULL::text),
      ('Atacadão dos Óculos - Loja 27', 'Atacadão dos Óculos - Loja 09', 'Guarapari - Aeroporto', NULL::text),
      ('Atacadão dos Óculos - Loja 27', 'Atacadão dos Óculos - Loja 29', 'Guarapari - Centro', NULL::text),
      ('Atacadão dos Óculos - Loja 32', 'Atacadão dos Óculos - Loja 07', 'Vila Velha - Terra Vermelha', NULL::text),
      ('Atacadão dos Óculos - Loja 32', 'Atacadão dos Óculos - Loja 14', 'Vila Velha - Nossa Senhora da Penha', NULL::text),
      ('Atacadão dos Óculos - Loja 32', 'Atacadão dos Óculos - Loja 18', 'Vila Velha - Itapoã', NULL::text),
      ('Atacadão dos Óculos - Loja 32', 'Atacadão dos Óculos - Loja 28', 'Vila Velha - Centro', NULL::text)
  )
  INSERT INTO locator.agent_store_calendar_poles (
    aces_id,
    agent_id,
    source_store_id,
    pole_store_id,
    professional_location_id,
    pole_address_override,
    is_active
  )
  SELECT
    13,
    v_agent_id,
    source_store.id,
    pole_store.id,
    calendar_location.id,
    route_config.address_override,
    true
  FROM route_config
  JOIN locator.stores AS source_store
    ON source_store.aces_id = 13
   AND source_store.display_name = route_config.source_name
   AND source_store.is_active
  JOIN locator.stores AS pole_store
    ON pole_store.aces_id = 13
   AND pole_store.display_name = route_config.pole_name
   AND pole_store.is_active
  JOIN calendar.professional_locations AS calendar_location
    ON calendar_location.aces_id = 13
   AND calendar_location.location_name = route_config.calendar_name
   AND calendar_location.is_active
   AND calendar_location.is_ai_visible
  ON CONFLICT (aces_id, agent_id, source_store_id, professional_location_id)
  DO UPDATE SET
    pole_store_id = EXCLUDED.pole_store_id,
    pole_address_override = EXCLUDED.pole_address_override,
    is_active = true,
    updated_at = now();

  GET DIAGNOSTICS v_seeded_rows = ROW_COUNT;
  IF v_seeded_rows <> 27 THEN
    RAISE EXCEPTION 'Expected 27 Emilia store-to-calendar pole routes for account 13; seeded %', v_seeded_rows;
  END IF;
END;
$seed$;
