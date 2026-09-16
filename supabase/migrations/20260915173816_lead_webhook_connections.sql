BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE TABLE IF NOT EXISTS crm.lead_webhook_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  default_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_webhook_connections_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT lead_webhook_connections_public_id_check CHECK (length(btrim(public_id)) BETWEEN 16 AND 200),
  CONSTRAINT lead_webhook_connections_tenant_name_unique UNIQUE (aces_id, name),
  CONSTRAINT lead_webhook_connections_tenant_id_unique UNIQUE (aces_id, id)
);

CREATE INDEX IF NOT EXISTS idx_lead_webhook_connections_tenant_status
  ON crm.lead_webhook_connections(aces_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS crm.lead_webhook_credentials (
  connection_id uuid PRIMARY KEY,
  aces_id integer NOT NULL,
  ciphertext bytea NOT NULL,
  iv bytea NOT NULL,
  auth_tag bytea NOT NULL,
  key_version text NOT NULL,
  previous_ciphertext bytea,
  previous_iv bytea,
  previous_auth_tag bytea,
  previous_key_version text,
  previous_valid_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_webhook_credentials_connection_fkey
    FOREIGN KEY (connection_id, aces_id)
    REFERENCES crm.lead_webhook_connections(id, aces_id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm.lead_webhook_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'processed'
    CHECK (status IN ('processed', 'failed')),
  lead_id uuid REFERENCES crm.leads(id) ON DELETE SET NULL,
  agent_id uuid,
  lead_created boolean NOT NULL DEFAULT false,
  ignored_tags jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(ignored_tags) = 'array'),
  response jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(response) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_webhook_receipts_connection_fkey
    FOREIGN KEY (connection_id, aces_id)
    REFERENCES crm.lead_webhook_connections(id, aces_id)
    ON DELETE CASCADE,
  CONSTRAINT lead_webhook_receipts_idempotency_key_check
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  CONSTRAINT lead_webhook_receipts_payload_hash_check
    CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lead_webhook_receipts_idempotency
  ON crm.lead_webhook_receipts(connection_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_lead_webhook_receipts_tenant_created
  ON crm.lead_webhook_receipts(aces_id, created_at DESC);

ALTER TABLE crm.lead_webhook_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_webhook_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lead_webhook_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE crm.lead_webhook_connections, crm.lead_webhook_credentials, crm.lead_webhook_receipts
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE crm.lead_webhook_connections, crm.lead_webhook_credentials, crm.lead_webhook_receipts
  TO service_role;

CREATE OR REPLACE FUNCTION crm.lead_webhook_connections_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION crm.lead_webhook_credentials_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION crm.lead_webhook_connections_updated_at() FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION crm.lead_webhook_credentials_updated_at() FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.lead_webhook_connections_updated_at() TO service_role;
GRANT EXECUTE ON FUNCTION crm.lead_webhook_credentials_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_lead_webhook_connections_updated_at ON crm.lead_webhook_connections;
CREATE TRIGGER trg_lead_webhook_connections_updated_at
BEFORE UPDATE ON crm.lead_webhook_connections
FOR EACH ROW EXECUTE FUNCTION crm.lead_webhook_connections_updated_at();

DROP TRIGGER IF EXISTS trg_lead_webhook_credentials_updated_at ON crm.lead_webhook_credentials;
CREATE TRIGGER trg_lead_webhook_credentials_updated_at
BEFORE UPDATE ON crm.lead_webhook_credentials
FOR EACH ROW EXECUTE FUNCTION crm.lead_webhook_credentials_updated_at();

-- A lead received through this endpoint must be stored without entering the
-- existing stage automation engine. Part 2 will explicitly decide when the
-- selected agent should act on the lead.
CREATE OR REPLACE FUNCTION crm.trg_handle_lead_automation_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_now timestamptz := now();
  v_webhook_ingest boolean := current_setting('crm.lead_webhook_ingest', true) = 'true';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.stage_id IS NOT NULL THEN
      INSERT INTO crm.lead_stage_events (
        aces_id, lead_id, stage_id, event_type, occurred_at, created_at
      )
      VALUES (
        NEW.aces_id, NEW.id, NEW.stage_id, 'entered',
        COALESCE(NEW.updated_at, NEW.created_at, v_now),
        COALESCE(NEW.updated_at, NEW.created_at, v_now)
      );
    END IF;

    PERFORM crm.upsert_lead_automation_state_from_lead(NEW.id);

    IF NOT v_webhook_ingest
       AND NEW.stage_id IS NOT NULL
       AND COALESCE(NEW.view, TRUE) = TRUE THEN
      PERFORM crm.handle_entry_event(NEW.id, 'stage_entered_at');
    END IF;

    RETURN NEW;
  END IF;

  IF COALESCE(OLD.view, TRUE) = TRUE AND COALESCE(NEW.view, TRUE) = FALSE THEN
    PERFORM crm.upsert_lead_automation_state_from_lead(NEW.id);
    PERFORM crm.revalidate_active_enrollments_for_lead(NEW.id);
    RETURN NEW;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    IF OLD.stage_id IS NOT NULL THEN
      INSERT INTO crm.lead_stage_events (
        aces_id, lead_id, stage_id, event_type, occurred_at, created_at
      )
      VALUES (NEW.aces_id, NEW.id, OLD.stage_id, 'left', v_now, v_now);
    END IF;

    IF NEW.stage_id IS NOT NULL THEN
      INSERT INTO crm.lead_stage_events (
        aces_id, lead_id, stage_id, event_type, occurred_at, created_at
      )
      VALUES (NEW.aces_id, NEW.id, NEW.stage_id, 'entered', v_now, v_now);
    END IF;
  END IF;

  PERFORM crm.upsert_lead_automation_state_from_lead(NEW.id);
  PERFORM crm.revalidate_active_enrollments_for_lead(NEW.id);

  IF NOT v_webhook_ingest
     AND NEW.stage_id IS DISTINCT FROM OLD.stage_id
     AND NEW.stage_id IS NOT NULL
     AND COALESCE(NEW.view, TRUE) = TRUE THEN
    PERFORM crm.handle_entry_event(NEW.id, 'stage_entered_at');
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION crm.trg_handle_lead_automation_v2() FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.trg_handle_lead_automation_v2() TO service_role;

CREATE OR REPLACE FUNCTION crm.rpc_ingest_lead_webhook(
  p_public_id text,
  p_idempotency_key text,
  p_payload_hash text,
  p_name text,
  p_contact_phone text,
  p_email text DEFAULT NULL,
  p_observation text DEFAULT NULL,
  p_tags text[] DEFAULT ARRAY[]::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection crm.lead_webhook_connections%ROWTYPE;
  v_agent agents.ai_agents%ROWTYPE;
  v_stage crm.pipeline_stages%ROWTYPE;
  v_receipt crm.lead_webhook_receipts%ROWTYPE;
  v_lead crm.leads%ROWTYPE;
  v_lead_id uuid;
  v_phone_identity text;
  v_note text;
  v_ignored_tags jsonb := '[]'::jsonb;
  v_tag text;
  v_tag_id uuid;
  v_tag_name text;
  v_created boolean := false;
  v_response jsonb;
BEGIN
  IF NULLIF(btrim(COALESCE(p_public_id, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_idempotency_key, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_payload_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_REQUEST_INVALID';
  END IF;

  -- Serialize retries of one event before checking the receipt table.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(btrim(p_public_id)),
    pg_catalog.hashtext(btrim(p_idempotency_key))
  );

  SELECT *
  INTO v_connection
  FROM crm.lead_webhook_connections AS connection
  WHERE connection.public_id = btrim(p_public_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_CONNECTION_NOT_FOUND';
  END IF;

  IF v_connection.status <> 'active' THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_CONNECTION_PAUSED';
  END IF;

  SELECT *
  INTO v_receipt
  FROM crm.lead_webhook_receipts AS receipt
  WHERE receipt.connection_id = v_connection.id
    AND receipt.idempotency_key = btrim(p_idempotency_key)
  FOR UPDATE;

  IF FOUND THEN
    IF v_receipt.payload_hash <> lower(btrim(p_payload_hash)) THEN
      RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_IDEMPOTENCY_CONFLICT';
    END IF;

    RETURN COALESCE(v_receipt.response, '{}'::jsonb)
      || jsonb_build_object('duplicate', true);
  END IF;

  SELECT *
  INTO v_agent
  FROM agents.ai_agents AS agent
  WHERE agent.id = v_connection.agent_id
    AND agent.aces_id = v_connection.aces_id
  LIMIT 1;

  IF NOT FOUND
     OR v_agent.agent_type <> 'primary'
     OR v_agent.is_active IS NOT TRUE
     OR NULLIF(btrim(COALESCE(v_agent.instance_name, '')), '') IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_AGENT_UNAVAILABLE';
  END IF;

  SELECT *
  INTO v_stage
  FROM crm.pipeline_stages AS stage
  WHERE stage.id = v_connection.default_stage_id
    AND stage.aces_id = v_connection.aces_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_STAGE_UNAVAILABLE';
  END IF;

  v_phone_identity := crm.normalize_phone_identity(p_contact_phone);
  IF v_phone_identity IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'LEAD_WEBHOOK_PHONE_INVALID';
  END IF;

  v_note := CASE
    WHEN NULLIF(btrim(COALESCE(p_observation, '')), '') IS NULL THEN NULL
    ELSE format(
      '[%s] %s:%s%s',
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      v_connection.name,
      E'\n',
      btrim(p_observation)
    )
  END;

  PERFORM pg_catalog.set_config('crm.lead_webhook_ingest', 'true', true);

  SELECT *
  INTO v_lead
  FROM crm.leads AS lead
  WHERE lead.aces_id = v_connection.aces_id
    AND lead.phone_identity = v_phone_identity
    AND COALESCE(lead.view, TRUE) IS TRUE
  ORDER BY lead.updated_at DESC NULLS LAST, lead.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    UPDATE crm.leads AS lead
    SET
      name = btrim(p_name),
      contact_phone = btrim(p_contact_phone),
      email = COALESCE(NULLIF(btrim(COALESCE(p_email, '')), ''), lead.email),
      notes = CASE
        WHEN v_note IS NULL THEN lead.notes
        WHEN NULLIF(btrim(COALESCE(lead.notes, '')), '') IS NULL THEN v_note
        ELSE lead.notes || E'\n\n' || v_note
      END,
      updated_at = now()
    WHERE lead.id = v_lead.id
    RETURNING * INTO v_lead;
    v_lead_id := v_lead.id;
  ELSE
    INSERT INTO crm.leads (
      aces_id,
      name,
      contact_phone,
      email,
      status,
      stage_id,
      instancia,
      "Fonte",
      notes,
      view,
      first_touch_attribution
    )
    VALUES (
      v_connection.aces_id,
      btrim(p_name),
      btrim(p_contact_phone),
      NULLIF(btrim(COALESCE(p_email, '')), ''),
      v_stage.name,
      v_stage.id,
      btrim(v_agent.instance_name),
      v_connection.name,
      v_note,
      TRUE,
      jsonb_build_object(
        'sourceType', 'lead_webhook',
        'connectionName', v_connection.name,
        'agentId', v_agent.id,
        'agentName', v_agent.name,
        'instanceName', v_agent.instance_name
      )
    )
    RETURNING * INTO v_lead;
    v_lead_id := v_lead.id;
    v_created := true;
  END IF;

  FOREACH v_tag IN ARRAY COALESCE(p_tags, ARRAY[]::text[]) LOOP
    v_tag_name := NULLIF(btrim(v_tag), '');
    IF v_tag_name IS NULL THEN
      CONTINUE;
    END IF;

    SELECT tag.id, tag.name
    INTO v_tag_id, v_tag_name
    FROM crm.tags AS tag
    WHERE tag.aces_id = v_connection.aces_id
      AND lower(btrim(tag.name)) = lower(v_tag_name)
    ORDER BY tag.created_at NULLS LAST, tag.id
    LIMIT 1;

    IF NOT FOUND THEN
      v_ignored_tags := v_ignored_tags || jsonb_build_array(v_tag);
      CONTINUE;
    END IF;

    INSERT INTO crm.lead_tags (lead_id, tag_id, tag_name)
    VALUES (v_lead_id, v_tag_id, v_tag_name)
    ON CONFLICT (lead_id, tag_id) DO NOTHING;
  END LOOP;

  v_response := jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'lead_id', v_lead_id,
    'created', v_created,
    'ignored_tags', v_ignored_tags
  );

  INSERT INTO crm.lead_webhook_receipts (
    aces_id,
    connection_id,
    idempotency_key,
    payload_hash,
    status,
    lead_id,
    agent_id,
    lead_created,
    ignored_tags,
    response
  )
  VALUES (
    v_connection.aces_id,
    v_connection.id,
    btrim(p_idempotency_key),
    lower(btrim(p_payload_hash)),
    'processed',
    v_lead_id,
    v_agent.id,
    v_created,
    v_ignored_tags,
    v_response
  );

  RETURN v_response;
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_ingest_lead_webhook(text, text, text, text, text, text, text, text[])
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.rpc_ingest_lead_webhook(text, text, text, text, text, text, text, text[])
  TO service_role;

COMMENT ON TABLE crm.lead_webhook_connections IS
  'Entrada de leads por webhook. A conexao aponta para um agente primary; a instancia e derivada do agente.';
COMMENT ON TABLE crm.lead_webhook_receipts IS
  'Recibos idempotentes dos eventos de entrada de leads; nao armazena o payload bruto.';

COMMIT;
