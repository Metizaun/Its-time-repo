-- Agenda Universal v1: private persistence model.
-- Runtime functions, capture triggers and worker claims are introduced in later checkpoints.

CREATE SCHEMA IF NOT EXISTS agenda_sync;

REVOKE ALL ON SCHEMA agenda_sync FROM PUBLIC, anon, authenticated, authenticator;
GRANT USAGE ON SCHEMA agenda_sync TO service_role, authenticator;

ALTER TABLE crm.empresas
  ADD COLUMN IF NOT EXISTS agenda_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE calendar.professionals
  ADD COLUMN IF NOT EXISTS agenda_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE calendar.professional_locations
  ADD COLUMN IF NOT EXISTS agenda_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'empresas_agenda_metadata_object_check'
      AND conrelid = 'crm.empresas'::regclass
  ) THEN
    ALTER TABLE crm.empresas
      ADD CONSTRAINT empresas_agenda_metadata_object_check
      CHECK (jsonb_typeof(agenda_metadata) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'professionals_agenda_metadata_object_check'
      AND conrelid = 'calendar.professionals'::regclass
  ) THEN
    ALTER TABLE calendar.professionals
      ADD CONSTRAINT professionals_agenda_metadata_object_check
      CHECK (jsonb_typeof(agenda_metadata) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'professional_locations_agenda_metadata_object_check'
      AND conrelid = 'calendar.professional_locations'::regclass
  ) THEN
    ALTER TABLE calendar.professional_locations
      ADD CONSTRAINT professional_locations_agenda_metadata_object_check
      CHECK (jsonb_typeof(agenda_metadata) = 'object');
  END IF;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM calendar.availability_exceptions
    WHERE empresa_id IS NULL
      AND professional_location_id IS NULL
  ) THEN
    RAISE EXCEPTION
      'Agenda Universal preflight failed: availability_exceptions must have empresa_id or professional_location_id';
  END IF;
END;
$$;

ALTER TABLE calendar.availability_exceptions
  DROP CONSTRAINT IF EXISTS availability_exceptions_scope_check;

ALTER TABLE calendar.availability_exceptions
  ADD CONSTRAINT availability_exceptions_scope_check
  CHECK (num_nonnulls(empresa_id, professional_location_id) = 1);

CREATE TABLE agenda_sync.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  outbound_url text,
  scope_mode text NOT NULL DEFAULT 'selected_scope',
  status text NOT NULL DEFAULT 'draft',
  default_timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  next_sequence bigint NOT NULL DEFAULT 0,
  scope_revision bigint NOT NULL DEFAULT 1,
  tested_at timestamptz,
  resync_watermark bigint,
  resync_started_at timestamptz,
  resync_completed_at timestamptz,
  last_delivered_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_connections_public_id_unique UNIQUE (public_id),
  CONSTRAINT agenda_connections_public_id_entropy_check CHECK (public_id ~ '^[0-9a-f]{48}$'),
  CONSTRAINT agenda_connections_account_id_unique UNIQUE (aces_id, id),
  CONSTRAINT agenda_connections_name_not_blank CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT agenda_connections_outbound_url_length CHECK (outbound_url IS NULL OR length(outbound_url) <= 2048),
  CONSTRAINT agenda_connections_scope_mode_check CHECK (scope_mode IN ('all_resources', 'selected_scope')),
  CONSTRAINT agenda_connections_status_check CHECK (status IN ('draft', 'syncing', 'active', 'paused', 'error', 'disabled')),
  CONSTRAINT agenda_connections_sequence_check CHECK (next_sequence >= 0),
  CONSTRAINT agenda_connections_scope_revision_check CHECK (scope_revision > 0),
  CONSTRAINT agenda_connections_error_message_length CHECK (last_error_message IS NULL OR length(last_error_message) <= 2000)
);

CREATE INDEX agenda_connections_account_status_idx
  ON agenda_sync.connections(aces_id, status, created_at DESC);

CREATE TABLE agenda_sync.connection_units (
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  unit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, unit_id),
  CONSTRAINT agenda_connection_units_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_connection_units_unit_fk
    FOREIGN KEY (aces_id, unit_id)
    REFERENCES crm.empresas(aces_id, id) ON DELETE CASCADE
);

CREATE INDEX agenda_connection_units_scope_idx
  ON agenda_sync.connection_units(aces_id, unit_id, connection_id);

CREATE TABLE agenda_sync.connection_assignments (
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  assignment_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, assignment_id),
  CONSTRAINT agenda_connection_assignments_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_connection_assignments_assignment_fk
    FOREIGN KEY (aces_id, assignment_id)
    REFERENCES calendar.professional_locations(aces_id, id) ON DELETE CASCADE
);

CREATE INDEX agenda_connection_assignments_scope_idx
  ON agenda_sync.connection_assignments(aces_id, assignment_id, connection_id);

CREATE TABLE agenda_sync.credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  direction text NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL,
  previous_ciphertext bytea,
  previous_iv bytea,
  previous_auth_tag bytea,
  previous_key_version text,
  previous_valid_until timestamptz,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_credentials_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_credentials_connection_direction_unique UNIQUE (connection_id, direction),
  CONSTRAINT agenda_credentials_direction_check CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT agenda_credentials_current_crypto_shape_check
    CHECK (octet_length(iv) = 12 AND octet_length(auth_tag) = 16 AND octet_length(ciphertext) > 0),
  CONSTRAINT agenda_credentials_previous_crypto_shape_check CHECK (
    (previous_ciphertext IS NULL AND previous_iv IS NULL AND previous_auth_tag IS NULL
      AND previous_key_version IS NULL AND previous_valid_until IS NULL)
    OR
    (previous_ciphertext IS NOT NULL AND previous_iv IS NOT NULL AND previous_auth_tag IS NOT NULL
      AND previous_key_version IS NOT NULL AND previous_valid_until IS NOT NULL
      AND octet_length(previous_iv) = 12 AND octet_length(previous_auth_tag) = 16
      AND octet_length(previous_ciphertext) > 0)
  )
);

CREATE TABLE agenda_sync.resource_versions (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, resource_type, resource_id),
  CONSTRAINT agenda_resource_versions_type_check
    CHECK (resource_type IN ('unit', 'professional', 'availability', 'patient', 'appointment')),
  CONSTRAINT agenda_resource_versions_positive_check CHECK (version >= 0)
);

CREATE TABLE agenda_sync.outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  sequence bigint NOT NULL,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  resource_type text,
  resource_id uuid,
  resource_version bigint,
  envelope jsonb NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count smallint NOT NULL DEFAULT 0,
  first_attempt_at timestamptz,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_until timestamptz,
  locked_by text,
  delivered_at timestamptz,
  dead_lettered_at timestamptz,
  last_http_status integer,
  last_error_code text,
  last_error_message text,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  resolution text,
  resolution_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_outbox_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_outbox_connection_event_unique UNIQUE (connection_id, event_id),
  CONSTRAINT agenda_outbox_connection_sequence_unique UNIQUE (connection_id, sequence),
  CONSTRAINT agenda_outbox_account_connection_id_unique UNIQUE (aces_id, connection_id, id),
  CONSTRAINT agenda_outbox_sequence_check CHECK (sequence > 0),
  CONSTRAINT agenda_outbox_resource_shape_check CHECK (
    (event_type = 'integration.test' AND resource_type IS NULL AND resource_id IS NULL AND resource_version IS NULL)
    OR
    (event_type <> 'integration.test' AND resource_type IS NOT NULL AND resource_id IS NOT NULL AND resource_version > 0)
  ),
  CONSTRAINT agenda_outbox_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT agenda_outbox_envelope_object_check CHECK (jsonb_typeof(envelope) = 'object'),
  CONSTRAINT agenda_outbox_status_check CHECK (status IN ('pending', 'delivering', 'delivered', 'dead_letter', 'skipped')),
  CONSTRAINT agenda_outbox_attempt_count_check CHECK (attempt_count BETWEEN 0 AND 8),
  CONSTRAINT agenda_outbox_http_status_check CHECK (last_http_status IS NULL OR last_http_status BETWEEN 100 AND 599),
  CONSTRAINT agenda_outbox_resolution_check CHECK (
    (resolution IS NULL AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL)
    OR
    (resolution IN ('retry', 'skip') AND resolved_at IS NOT NULL
      AND resolution_reason IS NOT NULL AND length(btrim(resolution_reason)) BETWEEN 1 AND 2000)
  ),
  CONSTRAINT agenda_outbox_error_message_length CHECK (last_error_message IS NULL OR length(last_error_message) <= 2000)
);

CREATE INDEX agenda_outbox_claim_idx
  ON agenda_sync.outbox(connection_id, sequence, available_at)
  WHERE status IN ('pending', 'delivering');

CREATE INDEX agenda_outbox_account_status_idx
  ON agenda_sync.outbox(aces_id, status, created_at DESC);

CREATE TABLE agenda_sync.deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  outbox_id uuid NOT NULL,
  event_id uuid NOT NULL,
  attempt_number smallint NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  outcome text NOT NULL,
  http_status integer,
  response_excerpt text,
  error_code text,
  error_message text,
  worker_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_deliveries_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_deliveries_outbox_fk
    FOREIGN KEY (aces_id, connection_id, outbox_id)
    REFERENCES agenda_sync.outbox(aces_id, connection_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_deliveries_attempt_unique UNIQUE (outbox_id, attempt_number),
  CONSTRAINT agenda_deliveries_attempt_check CHECK (attempt_number BETWEEN 1 AND 8),
  CONSTRAINT agenda_deliveries_duration_check CHECK (duration_ms >= 0),
  CONSTRAINT agenda_deliveries_time_range_check CHECK (finished_at >= started_at),
  CONSTRAINT agenda_deliveries_outcome_check CHECK (outcome IN ('delivered', 'retry', 'permanent_failure', 'dead_letter')),
  CONSTRAINT agenda_deliveries_http_status_check CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
  CONSTRAINT agenda_deliveries_response_length CHECK (response_excerpt IS NULL OR length(response_excerpt) <= 2000),
  CONSTRAINT agenda_deliveries_error_length CHECK (error_message IS NULL OR length(error_message) <= 2000)
);

CREATE INDEX agenda_deliveries_connection_created_idx
  ON agenda_sync.deliveries(aces_id, connection_id, created_at DESC);

CREATE TABLE agenda_sync.inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  event_id uuid NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL,
  appointment_id uuid,
  base_resource_version bigint,
  outcome text NOT NULL DEFAULT 'processing',
  response_status integer,
  error_code text,
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  CONSTRAINT agenda_inbound_events_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_inbound_events_connection_event_unique UNIQUE (connection_id, event_id),
  CONSTRAINT agenda_inbound_events_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT agenda_inbound_events_base_version_check CHECK (base_resource_version IS NULL OR base_resource_version > 0),
  CONSTRAINT agenda_inbound_events_outcome_check
    CHECK (outcome IN ('processing', 'accepted', 'duplicate', 'ignored', 'rejected', 'conflict')),
  CONSTRAINT agenda_inbound_events_response_status_check CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599),
  CONSTRAINT agenda_inbound_events_error_length CHECK (error_message IS NULL OR length(error_message) <= 2000)
);

CREATE INDEX agenda_inbound_events_connection_received_idx
  ON agenda_sync.inbound_events(aces_id, connection_id, received_at DESC);

ALTER TABLE agenda_sync.connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.connection_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.connection_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.resource_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_sync.inbound_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON ALL TABLES IN SCHEMA agenda_sync FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA agenda_sync FROM PUBLIC, anon, authenticated, authenticator;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA agenda_sync TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA agenda_sync TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA agenda_sync
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, authenticator;
ALTER DEFAULT PRIVILEGES IN SCHEMA agenda_sync
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, authenticator;

-- This project accesses private schemas through supabase-js/PostgREST. The
-- authenticator may discover the schema, but it receives no table privileges.
ALTER ROLE authenticator SET pgrst.db_schemas =
  'public,storage,graphql_public,crm,meta,calendar,agents,bi,locator,gupshup,rb,instagram,collections,agenda_sync';
ALTER ROLE authenticator SET pgrst.db_extra_search_path =
  'public,extensions,crm,agents,bi,locator,meta,calendar,gupshup,rb,instagram,collections,agenda_sync';
NOTIFY pgrst, 'reload config';
