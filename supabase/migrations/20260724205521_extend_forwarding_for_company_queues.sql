-- Extend the existing Encaminhamento Tool with company queues.

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION crm.normalize_search_text(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT lower(extensions.unaccent(COALESCE(p_value, '')));
$$;

REVOKE ALL ON FUNCTION crm.normalize_search_text(text) FROM PUBLIC, anon, authenticator;
GRANT EXECUTE ON FUNCTION crm.normalize_search_text(text) TO authenticated, service_role;

ALTER TABLE crm.empresas
  ADD COLUMN search_key text
  GENERATED ALWAYS AS (
    crm.normalize_search_text(cnpj || ' ' || name || ' ' || address || ' ' || city || ' ' || state)
  ) STORED;

SET search_path = public, extensions, crm;
CREATE INDEX idx_empresas_search_key_trgm
  ON crm.empresas USING gin (search_key gin_trgm_ops);
RESET search_path;

ALTER TABLE agents.forwarding_destinations
  DROP CONSTRAINT forwarding_destinations_mode_check,
  DROP CONSTRAINT forwarding_destinations_target_check,
  ADD COLUMN empresa_id uuid REFERENCES crm.empresas(id) ON DELETE RESTRICT,
  ADD CONSTRAINT forwarding_destinations_mode_check
    CHECK (mode IN ('external_notification', 'agent', 'internal_company')),
  ADD CONSTRAINT forwarding_destinations_target_check
    CHECK (
      (mode = 'external_notification'
        AND target_phone IS NOT NULL
        AND target_agent_id IS NULL
        AND empresa_id IS NULL)
      OR (mode = 'agent'
        AND target_agent_id IS NOT NULL
        AND target_phone IS NULL
        AND empresa_id IS NULL)
      OR (mode = 'internal_company'
        AND empresa_id IS NOT NULL
        AND target_phone IS NULL
        AND target_agent_id IS NULL)
    );

CREATE INDEX idx_forwarding_destinations_company
  ON agents.forwarding_destinations(aces_id, empresa_id)
  WHERE mode = 'internal_company' AND is_active IS TRUE;

CREATE TABLE agents.forwarding_destination_sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  forwarding_destination_id uuid NOT NULL
    REFERENCES agents.forwarding_destinations(id) ON DELETE CASCADE,
  crm_user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forwarding_destination_sellers_unique
    UNIQUE (forwarding_destination_id, crm_user_id)
);

CREATE INDEX idx_forwarding_destination_sellers_user
  ON agents.forwarding_destination_sellers(aces_id, crm_user_id);

CREATE OR REPLACE FUNCTION agents.validate_forwarding_destination_seller()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_empresa_id uuid;
BEGIN
  SELECT destination.empresa_id
  INTO v_empresa_id
  FROM agents.forwarding_destinations AS destination
  WHERE destination.id = NEW.forwarding_destination_id
    AND destination.aces_id = NEW.aces_id
    AND destination.mode = 'internal_company';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Destino de empresa nao encontrado na conta';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.users AS crm_user
    JOIN crm.empresa_memberships AS membership
      ON membership.crm_user_id = crm_user.id
     AND membership.aces_id = crm_user.aces_id
     AND membership.empresa_id = v_empresa_id
     AND membership.is_active IS TRUE
    WHERE crm_user.id = NEW.crm_user_id
      AND crm_user.aces_id = NEW.aces_id
      AND crm_user.role = 'VENDEDOR'
  ) THEN
    RAISE EXCEPTION 'Vendedor nao possui acesso ativo a empresa do destino';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_forwarding_destination_sellers_validate
BEFORE INSERT OR UPDATE ON agents.forwarding_destination_sellers
FOR EACH ROW EXECUTE FUNCTION agents.validate_forwarding_destination_seller();

CREATE TABLE crm.routing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  source_agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  forwarding_destination_id uuid
    REFERENCES agents.forwarding_destinations(id) ON DELETE SET NULL,
  empresa_id uuid REFERENCES crm.empresas(id) ON DELETE SET NULL,
  target_agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  destination_mode text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  reason text,
  seller_ids_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_message text,
  CONSTRAINT routing_events_mode_check
    CHECK (destination_mode IN ('internal_company', 'agent', 'external_notification', 'generic_handoff')),
  CONSTRAINT routing_events_status_check
    CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  CONSTRAINT routing_events_sellers_array_check
    CHECK (jsonb_typeof(seller_ids_snapshot) = 'array'),
  CONSTRAINT routing_events_context_object_check
    CHECK (jsonb_typeof(context_snapshot) = 'object')
);

ALTER TABLE crm.routing_events
  ADD CONSTRAINT routing_events_account_idempotency_unique
  UNIQUE (aces_id, idempotency_key);

CREATE INDEX idx_routing_events_lead_created
  ON crm.routing_events(aces_id, lead_id, created_at DESC);

ALTER TABLE agents.forwarding_destination_sellers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.routing_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY forwarding_destination_sellers_service_only
  ON agents.forwarding_destination_sellers
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY routing_events_account_select
  ON crm.routing_events
  FOR SELECT
  TO authenticated
  USING (
    aces_id = public.current_aces_id()
    AND crm.current_user_can_access_lead(lead_id)
  );

REVOKE ALL ON agents.forwarding_destination_sellers
  FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON crm.routing_events
  FROM PUBLIC, anon, authenticated, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON agents.forwarding_destination_sellers TO service_role;
GRANT SELECT ON crm.routing_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.routing_events TO service_role;

NOTIFY pgrst, 'reload schema';
