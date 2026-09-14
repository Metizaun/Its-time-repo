-- Agenda Universal v1: privileged administrative operations.

CREATE TABLE agenda_sync.connection_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id uuid NOT NULL,
  aces_id integer NOT NULL,
  actor_id uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_connection_audit_connection_fk
    FOREIGN KEY (aces_id, connection_id)
    REFERENCES agenda_sync.connections(aces_id, id) ON DELETE CASCADE,
  CONSTRAINT agenda_connection_audit_action_check CHECK (length(btrim(action)) BETWEEN 1 AND 100),
  CONSTRAINT agenda_connection_audit_details_check CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX agenda_connection_audit_account_connection_idx
  ON agenda_sync.connection_audit(aces_id, connection_id, created_at DESC);

ALTER TABLE agenda_sync.connection_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agenda_sync.connection_audit FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT ON agenda_sync.connection_audit TO service_role;

CREATE OR REPLACE FUNCTION agenda_sync.assert_admin_actor(
  p_aces_id integer,
  p_actor_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF p_aces_id IS NULL OR p_aces_id <= 0 OR p_actor_id IS NULL THEN
    RAISE EXCEPTION 'AGENDA_ADMIN_CONTEXT_INVALID' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.users AS crm_user
    WHERE crm_user.id = p_actor_id
      AND crm_user.aces_id = p_aces_id
      AND crm_user.role::text = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'AGENDA_ADMIN_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.assert_connection_scope(
  p_aces_id integer,
  p_scope_mode text,
  p_unit_ids uuid[],
  p_assignment_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_unit_ids uuid[] := COALESCE(p_unit_ids, ARRAY[]::uuid[]);
  v_assignment_ids uuid[] := COALESCE(p_assignment_ids, ARRAY[]::uuid[]);
  v_requested integer;
  v_found integer;
BEGIN
  IF p_scope_mode NOT IN ('all_resources', 'selected_scope') THEN
    RAISE EXCEPTION 'AGENDA_SCOPE_MODE_INVALID' USING ERRCODE = '22023';
  END IF;

  IF p_scope_mode = 'all_resources' AND (cardinality(v_unit_ids) > 0 OR cardinality(v_assignment_ids) > 0) THEN
    RAISE EXCEPTION 'AGENDA_ALL_RESOURCES_SCOPE_MUST_BE_EMPTY' USING ERRCODE = '22023';
  END IF;

  SELECT count(DISTINCT requested.id) INTO v_requested FROM unnest(v_unit_ids) AS requested(id);
  SELECT count(*) INTO v_found
  FROM crm.empresas AS company
  WHERE company.aces_id = p_aces_id
    AND company.id = ANY(v_unit_ids);
  IF v_found <> v_requested THEN
    RAISE EXCEPTION 'AGENDA_SCOPE_UNIT_INVALID' USING ERRCODE = '23503';
  END IF;

  SELECT count(DISTINCT requested.id) INTO v_requested FROM unnest(v_assignment_ids) AS requested(id);
  SELECT count(*) INTO v_found
  FROM calendar.professional_locations AS assignment
  WHERE assignment.aces_id = p_aces_id
    AND assignment.empresa_id IS NULL
    AND assignment.id = ANY(v_assignment_ids);
  IF v_found <> v_requested THEN
    RAISE EXCEPTION 'AGENDA_SCOPE_ASSIGNMENT_INVALID' USING ERRCODE = '23503';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.create_connection(
  p_aces_id integer,
  p_actor_id uuid,
  p_name text,
  p_outbound_url text,
  p_scope_mode text,
  p_unit_ids uuid[],
  p_assignment_ids uuid[],
  p_default_timezone text,
  p_inbound_ciphertext bytea,
  p_inbound_iv bytea,
  p_inbound_auth_tag bytea,
  p_inbound_key_version text,
  p_outbound_ciphertext bytea,
  p_outbound_iv bytea,
  p_outbound_auth_tag bytea,
  p_outbound_key_version text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_connection_id uuid;
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id, p_actor_id);
  PERFORM agenda_sync.assert_connection_scope(p_aces_id, p_scope_mode, p_unit_ids, p_assignment_ids);

  IF NULLIF(btrim(p_name), '') IS NULL OR length(btrim(p_name)) > 200 THEN
    RAISE EXCEPTION 'AGENDA_CONNECTION_NAME_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_outbound_url !~ '^https://[^[:space:]]+$' OR length(p_outbound_url) > 2048 THEN
    RAISE EXCEPTION 'AGENDA_OUTBOUND_URL_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_default_timezone), '') IS NULL OR length(p_default_timezone) > 100 THEN
    RAISE EXCEPTION 'AGENDA_TIMEZONE_INVALID' USING ERRCODE = '22023';
  END IF;

  INSERT INTO agenda_sync.connections (
    aces_id, name, outbound_url, scope_mode, default_timezone, created_by
  ) VALUES (
    p_aces_id, btrim(p_name), p_outbound_url, p_scope_mode,
    btrim(p_default_timezone), p_actor_id
  )
  RETURNING id INTO v_connection_id;

  INSERT INTO agenda_sync.connection_units (connection_id, aces_id, unit_id)
  SELECT v_connection_id, p_aces_id, requested.id
  FROM (SELECT DISTINCT unnest(COALESCE(p_unit_ids, ARRAY[]::uuid[])) AS id) AS requested;

  INSERT INTO agenda_sync.connection_assignments (connection_id, aces_id, assignment_id)
  SELECT v_connection_id, p_aces_id, requested.id
  FROM (SELECT DISTINCT unnest(COALESCE(p_assignment_ids, ARRAY[]::uuid[])) AS id) AS requested;

  INSERT INTO agenda_sync.credentials (
    connection_id, aces_id, direction, ciphertext, iv, auth_tag, key_version
  ) VALUES
    (v_connection_id, p_aces_id, 'inbound', p_inbound_ciphertext, p_inbound_iv, p_inbound_auth_tag, p_inbound_key_version),
    (v_connection_id, p_aces_id, 'outbound', p_outbound_ciphertext, p_outbound_iv, p_outbound_auth_tag, p_outbound_key_version);

  INSERT INTO agenda_sync.connection_audit (connection_id, aces_id, actor_id, action, details)
  VALUES (
    v_connection_id, p_aces_id, p_actor_id, 'connection.created',
    jsonb_build_object('scopeMode', p_scope_mode, 'unitCount', cardinality(COALESCE(p_unit_ids, ARRAY[]::uuid[])),
      'assignmentCount', cardinality(COALESCE(p_assignment_ids, ARRAY[]::uuid[])))
  );

  RETURN v_connection_id;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.update_connection(
  p_aces_id integer,
  p_actor_id uuid,
  p_connection_id uuid,
  p_name text,
  p_outbound_url text,
  p_scope_mode text,
  p_unit_ids uuid[],
  p_assignment_ids uuid[],
  p_default_timezone text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_connection agenda_sync.connections%ROWTYPE;
  v_scope_changed boolean;
  v_existing_units uuid[];
  v_existing_assignments uuid[];
  v_unit_ids uuid[];
  v_assignment_ids uuid[];
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id, p_actor_id);
  SELECT * INTO v_connection
  FROM agenda_sync.connections
  WHERE id = p_connection_id AND aces_id = p_aces_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_connection.status NOT IN ('draft', 'paused', 'error') THEN
    RAISE EXCEPTION 'AGENDA_CONNECTION_ACTIVE_UPDATE_FORBIDDEN' USING ERRCODE = '55000';
  END IF;
  PERFORM agenda_sync.assert_connection_scope(p_aces_id, p_scope_mode, p_unit_ids, p_assignment_ids);
  IF NULLIF(btrim(p_name), '') IS NULL OR length(btrim(p_name)) > 200 THEN
    RAISE EXCEPTION 'AGENDA_CONNECTION_NAME_INVALID' USING ERRCODE = '22023';
  END IF;
  IF p_outbound_url !~ '^https://[^[:space:]]+$' OR length(p_outbound_url) > 2048 THEN
    RAISE EXCEPTION 'AGENDA_OUTBOUND_URL_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(btrim(p_default_timezone), '') IS NULL OR length(p_default_timezone) > 100 THEN
    RAISE EXCEPTION 'AGENDA_TIMEZONE_INVALID' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(unit_id ORDER BY unit_id), ARRAY[]::uuid[])
  INTO v_existing_units FROM agenda_sync.connection_units WHERE connection_id = p_connection_id;
  SELECT COALESCE(array_agg(assignment_id ORDER BY assignment_id), ARRAY[]::uuid[])
  INTO v_existing_assignments FROM agenda_sync.connection_assignments WHERE connection_id = p_connection_id;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_unit_ids
  FROM (SELECT DISTINCT unnest(COALESCE(p_unit_ids, ARRAY[]::uuid[])) AS id) AS normalized;
  SELECT COALESCE(array_agg(id ORDER BY id), ARRAY[]::uuid[]) INTO v_assignment_ids
  FROM (SELECT DISTINCT unnest(COALESCE(p_assignment_ids, ARRAY[]::uuid[])) AS id) AS normalized;

  v_scope_changed := v_connection.outbound_url IS DISTINCT FROM p_outbound_url
    OR v_connection.scope_mode IS DISTINCT FROM p_scope_mode
    OR v_existing_units IS DISTINCT FROM v_unit_ids
    OR v_existing_assignments IS DISTINCT FROM v_assignment_ids;

  UPDATE agenda_sync.connections
  SET name = btrim(p_name), outbound_url = p_outbound_url, scope_mode = p_scope_mode,
      default_timezone = btrim(p_default_timezone),
      scope_revision = scope_revision + CASE WHEN v_scope_changed THEN 1 ELSE 0 END,
      tested_at = CASE WHEN v_scope_changed THEN NULL ELSE tested_at END,
      resync_watermark = CASE WHEN v_scope_changed THEN NULL ELSE resync_watermark END,
      resync_completed_at = CASE WHEN v_scope_changed THEN NULL ELSE resync_completed_at END,
      updated_at = now()
  WHERE id = p_connection_id AND aces_id = p_aces_id;

  DELETE FROM agenda_sync.connection_units WHERE connection_id = p_connection_id AND aces_id = p_aces_id;
  INSERT INTO agenda_sync.connection_units (connection_id, aces_id, unit_id)
  SELECT p_connection_id, p_aces_id, requested.id FROM unnest(v_unit_ids) AS requested(id);
  DELETE FROM agenda_sync.connection_assignments WHERE connection_id = p_connection_id AND aces_id = p_aces_id;
  INSERT INTO agenda_sync.connection_assignments (connection_id, aces_id, assignment_id)
  SELECT p_connection_id, p_aces_id, requested.id FROM unnest(v_assignment_ids) AS requested(id);

  INSERT INTO agenda_sync.connection_audit (connection_id, aces_id, actor_id, action, details)
  VALUES (p_connection_id, p_aces_id, p_actor_id, 'connection.updated',
    jsonb_build_object('scopeChanged', v_scope_changed, 'scopeMode', p_scope_mode));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.rotate_connection_credential(
  p_aces_id integer,
  p_actor_id uuid,
  p_connection_id uuid,
  p_direction text,
  p_ciphertext bytea,
  p_iv bytea,
  p_auth_tag bytea,
  p_key_version text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id, p_actor_id);
  IF p_direction NOT IN ('inbound', 'outbound') THEN
    RAISE EXCEPTION 'AGENDA_CREDENTIAL_DIRECTION_INVALID' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agenda_sync.connections
    WHERE id = p_connection_id AND aces_id = p_aces_id AND status <> 'disabled'
  ) THEN
    RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  UPDATE agenda_sync.credentials
  SET previous_ciphertext = ciphertext,
      previous_iv = iv,
      previous_auth_tag = auth_tag,
      previous_key_version = key_version,
      previous_valid_until = now() + interval '24 hours',
      ciphertext = p_ciphertext,
      iv = p_iv,
      auth_tag = p_auth_tag,
      key_version = p_key_version,
      rotated_at = now(),
      updated_at = now()
  WHERE connection_id = p_connection_id
    AND aces_id = p_aces_id
    AND direction = p_direction;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CREDENTIAL_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  INSERT INTO agenda_sync.connection_audit (connection_id, aces_id, actor_id, action, details)
  VALUES (p_connection_id, p_aces_id, p_actor_id, 'credential.rotated', jsonb_build_object('direction', p_direction));
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.enqueue_connection_test(
  p_aces_id integer,
  p_actor_id uuid,
  p_connection_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_connection agenda_sync.connections%ROWTYPE;
  v_event_id uuid := gen_random_uuid();
  v_sequence bigint;
  v_envelope jsonb;
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id, p_actor_id);
  SELECT * INTO v_connection FROM agenda_sync.connections
  WHERE id = p_connection_id AND aces_id = p_aces_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  IF v_connection.status NOT IN ('draft', 'paused', 'error') OR v_connection.outbound_url IS NULL THEN
    RAISE EXCEPTION 'AGENDA_CONNECTION_TEST_FORBIDDEN' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM agenda_sync.credentials
    WHERE connection_id = p_connection_id AND aces_id = p_aces_id AND direction = 'outbound'
  ) THEN
    RAISE EXCEPTION 'AGENDA_OUTBOUND_CREDENTIAL_MISSING' USING ERRCODE = '55000';
  END IF;

  v_sequence := v_connection.next_sequence + 1;
  UPDATE agenda_sync.connections SET next_sequence = v_sequence, updated_at = now()
  WHERE id = p_connection_id AND aces_id = p_aces_id;
  v_envelope := jsonb_build_object(
    'schemaVersion', '1.0', 'eventId', v_event_id, 'eventType', 'integration.test',
    'occurredAt', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'resource', jsonb_build_object('message', 'Its Time Agenda Universal connection test')
  );
  INSERT INTO agenda_sync.outbox (
    connection_id, aces_id, sequence, event_id, event_type, envelope, payload_hash
  ) VALUES (
    p_connection_id, p_aces_id, v_sequence, v_event_id, 'integration.test', v_envelope,
    encode(extensions.digest(convert_to(v_envelope::text, 'UTF8'), 'sha256'), 'hex')
  );
  INSERT INTO agenda_sync.connection_audit (connection_id, aces_id, actor_id, action, details)
  VALUES (p_connection_id, p_aces_id, p_actor_id, 'connection.test_queued', jsonb_build_object('eventId', v_event_id));
  RETURN v_event_id;
END;
$$;

CREATE OR REPLACE FUNCTION agenda_sync.set_connection_operation(
  p_aces_id integer,
  p_actor_id uuid,
  p_connection_id uuid,
  p_operation text
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_connection agenda_sync.connections%ROWTYPE;
  v_status text;
BEGIN
  PERFORM agenda_sync.assert_admin_actor(p_aces_id, p_actor_id);
  SELECT * INTO v_connection FROM agenda_sync.connections
  WHERE id = p_connection_id AND aces_id = p_aces_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONNECTION_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;

  IF p_operation = 'pause' THEN
    IF v_connection.status NOT IN ('active', 'syncing', 'error') THEN
      RAISE EXCEPTION 'AGENDA_CONNECTION_PAUSE_FORBIDDEN' USING ERRCODE = '55000';
    END IF;
    v_status := 'paused';
  ELSIF p_operation IN ('activate', 'resume') THEN
    IF v_connection.status NOT IN ('draft', 'paused', 'error') OR v_connection.tested_at IS NULL THEN
      RAISE EXCEPTION 'AGENDA_CONNECTION_ACTIVATION_REQUIRES_TEST' USING ERRCODE = '55000';
    END IF;
    IF v_connection.scope_mode = 'selected_scope'
      AND NOT EXISTS (SELECT 1 FROM agenda_sync.connection_units WHERE connection_id = p_connection_id)
      AND NOT EXISTS (SELECT 1 FROM agenda_sync.connection_assignments WHERE connection_id = p_connection_id)
    THEN
      RAISE EXCEPTION 'AGENDA_CONNECTION_SCOPE_EMPTY' USING ERRCODE = '55000';
    END IF;
    v_status := 'syncing';
  ELSIF p_operation = 'disable' THEN
    v_status := 'disabled';
  ELSE
    RAISE EXCEPTION 'AGENDA_CONNECTION_OPERATION_INVALID' USING ERRCODE = '22023';
  END IF;

  UPDATE agenda_sync.connections SET status = v_status, updated_at = now()
  WHERE id = p_connection_id AND aces_id = p_aces_id;
  INSERT INTO agenda_sync.connection_audit (connection_id, aces_id, actor_id, action, details)
  VALUES (p_connection_id, p_aces_id, p_actor_id, 'connection.' || p_operation,
    jsonb_build_object('previousStatus', v_connection.status, 'status', v_status));
  RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION agenda_sync.assert_admin_actor(integer, uuid) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION agenda_sync.assert_connection_scope(integer, text, uuid[], uuid[]) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION agenda_sync.create_connection(integer, uuid, text, text, text, uuid[], uuid[], text, bytea, bytea, bytea, text, bytea, bytea, bytea, text) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION agenda_sync.update_connection(integer, uuid, uuid, text, text, text, uuid[], uuid[], text) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION agenda_sync.rotate_connection_credential(integer, uuid, uuid, text, bytea, bytea, bytea, text) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION agenda_sync.enqueue_connection_test(integer, uuid, uuid) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION agenda_sync.set_connection_operation(integer, uuid, uuid, text) FROM PUBLIC, anon, authenticated, authenticator;

GRANT EXECUTE ON FUNCTION agenda_sync.assert_admin_actor(integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.assert_connection_scope(integer, text, uuid[], uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.create_connection(integer, uuid, text, text, text, uuid[], uuid[], text, bytea, bytea, bytea, text, bytea, bytea, bytea, text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.update_connection(integer, uuid, uuid, text, text, text, uuid[], uuid[], text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.rotate_connection_credential(integer, uuid, uuid, text, bytea, bytea, bytea, text) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.enqueue_connection_test(integer, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION agenda_sync.set_connection_operation(integer, uuid, uuid, text) TO service_role;
