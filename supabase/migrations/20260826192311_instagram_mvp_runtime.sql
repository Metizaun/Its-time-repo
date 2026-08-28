-- Instagram MVP runtime: OAuth lifecycle, durable inbound queue and token refresh leases.
-- The instagram schema remains backend-only and all RPCs are service_role-only.

ALTER TABLE crm.instance
  DROP CONSTRAINT IF EXISTS instance_connection_mode_check;

ALTER TABLE crm.instance
  ADD CONSTRAINT instance_connection_mode_check
  CHECK (connection_mode IN ('local', 'external_webhook', 'instagram'));

ALTER TABLE instagram.channels
  ADD COLUMN next_refresh_at timestamptz,
  ADD COLUMN refresh_attempt_count integer NOT NULL DEFAULT 0
    CHECK (refresh_attempt_count >= 0),
  ADD COLUMN refresh_claimed_by text,
  ADD COLUMN refresh_claimed_at timestamptz,
  ADD COLUMN refresh_lease_expires_at timestamptz;

ALTER TABLE instagram.webhook_events
  ADD COLUMN normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(normalized_payload) = 'object');

ALTER TABLE instagram.webhook_events
  DROP CONSTRAINT IF EXISTS webhook_events_status_check;

ALTER TABLE instagram.webhook_events
  ADD CONSTRAINT webhook_events_status_check
  CHECK (status IN ('pending', 'processing', 'processed', 'ignored', 'failed', 'dead_letter'));

-- Instagram starts as manual-only. Keep the existing automation engine intact
-- for every other provider and do not enroll Instagram messages implicitly.
CREATE OR REPLACE FUNCTION crm.trg_handle_message_history_automation_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'crm'
AS $function$
DECLARE
  v_direction text := CASE
    WHEN lower(COALESCE(NEW.direction, '')) IN ('outbound', 'out') THEN 'outbound'
    ELSE 'inbound'
  END;
BEGIN
  IF NEW.provider = 'instagram' THEN
    RETURN NEW;
  END IF;

  PERFORM crm.upsert_lead_automation_state_from_message(NEW.id);

  IF v_direction = 'outbound' THEN
    PERFORM crm.handle_entry_event(NEW.lead_id, 'last_outbound');
  ELSE
    PERFORM crm.handle_inbound_exit_for_lead(NEW.lead_id);
    PERFORM crm.handle_entry_event(NEW.lead_id, 'last_inbound');
  END IF;

  RETURN NEW;
END;
$function$;

CREATE INDEX idx_instagram_channels_refresh_claim
  ON instagram.channels(next_refresh_at, refresh_lease_expires_at)
  WHERE health_status IN ('healthy', 'warning');

CREATE OR REPLACE FUNCTION instagram.rpc_begin_oauth(
  p_aces_id integer,
  p_instance_name text,
  p_initiated_by uuid,
  p_state_hash bytea,
  p_nonce_hash bytea,
  p_return_path text,
  p_redirect_uri text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_instance_name text := NULLIF(btrim(COALESCE(p_instance_name, '')), '');
  v_instance crm.instance%ROWTYPE;
  v_channel crm.instance_channels%ROWTYPE;
  v_state instagram.oauth_states%ROWTYPE;
BEGIN
  IF v_instance_name IS NULL OR length(v_instance_name) > 100 THEN
    RAISE EXCEPTION 'Nome da instancia Instagram invalido';
  END IF;

  IF p_expires_at <= now() OR p_expires_at > now() + interval '15 minutes' THEN
    RAISE EXCEPTION 'Expiracao OAuth invalida';
  END IF;

  IF p_return_path !~ '^/[A-Za-z0-9/_?&=.%-]*$' THEN
    RAISE EXCEPTION 'Caminho de retorno invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM crm.users
    WHERE id = p_initiated_by
      AND aces_id = p_aces_id
      AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Administrador invalido para OAuth';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.instance
    WHERE instancia = v_instance_name
      AND aces_id <> p_aces_id
  ) THEN
    RAISE EXCEPTION 'Nome de instancia ja utilizado';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.instance
    WHERE instancia = v_instance_name
      AND aces_id = p_aces_id
      AND connection_mode <> 'instagram'
  ) THEN
    RAISE EXCEPTION 'Nome de instancia pertence a outro canal';
  END IF;

  INSERT INTO crm.instance (
    instancia, aces_id, created_by, status, setup_status, setup_started_at,
    setup_expires_at, connection_mode, last_error
  ) VALUES (
    v_instance_name, p_aces_id, p_initiated_by, 'connecting', 'pending_qr', now(),
    p_expires_at, 'instagram', NULL
  )
  ON CONFLICT (instancia) DO UPDATE SET
    status = 'connecting',
    setup_status = 'pending_qr',
    setup_started_at = now(),
    setup_expires_at = EXCLUDED.setup_expires_at,
    connection_mode = 'instagram',
    last_error = NULL
  WHERE crm.instance.aces_id = EXCLUDED.aces_id
  RETURNING * INTO v_instance;

  IF v_instance.instancia IS NULL THEN
    RAISE EXCEPTION 'Nao foi possivel preparar a instancia Instagram';
  END IF;

  INSERT INTO crm.instance_channels (
    aces_id, instance_name, channel_type, provider, capability, status
  ) VALUES (
    p_aces_id, v_instance_name, 'instagram', 'instagram', 'manual_only', 'draft'
  )
  ON CONFLICT (aces_id, instance_name) DO UPDATE SET
    channel_type = 'instagram',
    provider = 'instagram',
    capability = 'manual_only',
    status = 'draft'
  RETURNING * INTO v_channel;

  UPDATE instagram.oauth_states
  SET status = 'expired', consumed_at = COALESCE(consumed_at, now())
  WHERE aces_id = p_aces_id
    AND instance_name = v_instance_name
    AND status IN ('pending', 'exchanging');

  INSERT INTO instagram.oauth_states (
    state_hash, nonce_hash, aces_id, instance_name, initiated_by,
    return_path, redirect_uri, expires_at, status
  ) VALUES (
    p_state_hash, p_nonce_hash, p_aces_id, v_instance_name, p_initiated_by,
    p_return_path, p_redirect_uri, p_expires_at, 'pending'
  )
  RETURNING * INTO v_state;

  RETURN jsonb_build_object(
    'stateId', v_state.id,
    'channelId', v_channel.id,
    'expiresAt', v_state.expires_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_claim_oauth(
  p_state_hash bytea,
  p_authorization_code_hash bytea
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_state instagram.oauth_states%ROWTYPE;
BEGIN
  UPDATE instagram.oauth_states
  SET status = 'exchanging',
      authorization_code_hash = p_authorization_code_hash,
      consumed_at = now()
  WHERE state_hash = p_state_hash
    AND status = 'pending'
    AND expires_at > now()
    AND authorization_code_hash IS NULL
  RETURNING * INTO v_state;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estado OAuth invalido, expirado ou ja utilizado';
  END IF;

  RETURN jsonb_build_object(
    'stateId', v_state.id,
    'acesId', v_state.aces_id,
    'instanceName', v_state.instance_name,
    'initiatedBy', v_state.initiated_by,
    'returnPath', v_state.return_path,
    'redirectUri', v_state.redirect_uri,
    'nonceHash', encode(v_state.nonce_hash, 'hex')
  );
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_complete_oauth(
  p_state_id uuid,
  p_ig_user_id text,
  p_ig_username text,
  p_access_token_ciphertext bytea,
  p_iv bytea,
  p_auth_tag bytea,
  p_key_version text,
  p_token_obtained_at timestamptz,
  p_token_expires_at timestamptz,
  p_next_refresh_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_state instagram.oauth_states%ROWTYPE;
  v_binding crm.instance_channels%ROWTYPE;
  v_channel instagram.channels%ROWTYPE;
  v_ig_user_id text := NULLIF(btrim(COALESCE(p_ig_user_id, '')), '');
BEGIN
  IF v_ig_user_id IS NULL THEN
    RAISE EXCEPTION 'Conta Instagram invalida';
  END IF;

  SELECT * INTO v_state
  FROM instagram.oauth_states
  WHERE id = p_state_id
    AND status = 'exchanging'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OAuth nao esta em processamento';
  END IF;

  SELECT * INTO STRICT v_binding
  FROM crm.instance_channels
  WHERE aces_id = v_state.aces_id
    AND instance_name = v_state.instance_name
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM instagram.channels
    WHERE ig_user_id = v_ig_user_id
      AND channel_id <> v_binding.id
  ) THEN
    RAISE EXCEPTION 'Conta Instagram ja conectada';
  END IF;

  INSERT INTO instagram.channels (
    channel_id, aces_id, ig_user_id, ig_username, token_obtained_at,
    token_expires_at, last_refreshed_at, next_refresh_at, health_status,
    refresh_attempt_count, last_error_code, last_error_at
  ) VALUES (
    v_binding.id, v_binding.aces_id, v_ig_user_id, NULLIF(btrim(p_ig_username), ''),
    p_token_obtained_at, p_token_expires_at, p_token_obtained_at,
    p_next_refresh_at, 'healthy', 0, NULL, NULL
  )
  ON CONFLICT (channel_id) DO UPDATE SET
    ig_user_id = EXCLUDED.ig_user_id,
    ig_username = EXCLUDED.ig_username,
    token_obtained_at = EXCLUDED.token_obtained_at,
    token_expires_at = EXCLUDED.token_expires_at,
    last_refreshed_at = EXCLUDED.last_refreshed_at,
    next_refresh_at = EXCLUDED.next_refresh_at,
    health_status = 'healthy',
    refresh_attempt_count = 0,
    refresh_claimed_by = NULL,
    refresh_claimed_at = NULL,
    refresh_lease_expires_at = NULL,
    last_error_code = NULL,
    last_error_at = NULL
  RETURNING * INTO v_channel;

  INSERT INTO instagram.channel_credentials (
    channel_id, access_token_ciphertext, iv, auth_tag, key_version, rotated_at
  ) VALUES (
    v_binding.id, p_access_token_ciphertext, p_iv, p_auth_tag, p_key_version, now()
  )
  ON CONFLICT (channel_id) DO UPDATE SET
    access_token_ciphertext = EXCLUDED.access_token_ciphertext,
    iv = EXCLUDED.iv,
    auth_tag = EXCLUDED.auth_tag,
    key_version = EXCLUDED.key_version,
    rotated_at = now();

  UPDATE crm.instance_channels
  SET status = 'active', capability = 'manual_only'
  WHERE id = v_binding.id;

  UPDATE crm.instance
  SET status = 'connected', setup_status = 'connected', setup_expires_at = NULL,
      connection_mode = 'instagram', last_error = NULL
  WHERE aces_id = v_state.aces_id
    AND instancia = v_state.instance_name;

  UPDATE instagram.oauth_states
  SET status = 'succeeded', completed_channel_id = v_binding.id
  WHERE id = v_state.id;

  RETURN jsonb_build_object(
    'channelId', v_channel.channel_id,
    'acesId', v_channel.aces_id,
    'instanceName', v_state.instance_name,
    'igUserId', v_channel.ig_user_id,
    'igUsername', v_channel.ig_username,
    'returnPath', v_state.return_path
  );
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_fail_oauth(
  p_state_id uuid,
  p_error_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  UPDATE instagram.oauth_states
  SET status = 'failed', error_code = left(COALESCE(p_error_code, 'oauth_failed'), 120)
  WHERE id = p_state_id
    AND status IN ('pending', 'exchanging');

  UPDATE crm.instance AS instance
  SET status = 'error', last_error = left(COALESCE(p_error_code, 'oauth_failed'), 300)
  FROM instagram.oauth_states AS oauth_state
  WHERE oauth_state.id = p_state_id
    AND instance.aces_id = oauth_state.aces_id
    AND instance.instancia = oauth_state.instance_name;
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_claim_webhook_events(
  p_worker_id text,
  p_limit integer DEFAULT 10,
  p_lease_seconds integer DEFAULT 60
)
RETURNS SETOF instagram.webhook_events
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT id
    FROM instagram.webhook_events
    WHERE status IN ('pending', 'failed')
      AND available_at <= now()
      AND (lease_expires_at IS NULL OR lease_expires_at <= now())
      AND attempt_count < 5
    ORDER BY received_at, id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 50)
  )
  UPDATE instagram.webhook_events AS event
  SET status = 'processing',
      claimed_by = left(p_worker_id, 120),
      claimed_at = now(),
      lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 15), 300)),
      attempt_count = event.attempt_count + 1
  FROM candidates
  WHERE event.id = candidates.id
  RETURNING event.*;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_complete_webhook_event(
  p_event_id uuid,
  p_worker_id text,
  p_status text DEFAULT 'processed'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  IF p_status NOT IN ('processed', 'ignored') THEN
    RAISE EXCEPTION 'Status final de webhook invalido';
  END IF;

  UPDATE instagram.webhook_events
  SET status = p_status, processed_at = now(), claimed_by = NULL,
      claimed_at = NULL, lease_expires_at = NULL, last_error_code = NULL
  WHERE id = p_event_id
    AND status = 'processing'
    AND claimed_by = p_worker_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_fail_webhook_event(
  p_event_id uuid,
  p_worker_id text,
  p_error_code text,
  p_retry_delay_seconds integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE instagram.webhook_events
  SET status = CASE WHEN attempt_count >= 5 THEN 'dead_letter' ELSE 'failed' END,
      available_at = now() + make_interval(secs => LEAST(GREATEST(p_retry_delay_seconds, 5), 3600)),
      claimed_by = NULL, claimed_at = NULL, lease_expires_at = NULL,
      last_error_code = left(COALESCE(p_error_code, 'processing_failed'), 120),
      last_error_at = now()
  WHERE id = p_event_id
    AND status = 'processing'
    AND claimed_by = p_worker_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_claim_token_refreshes(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 120
)
RETURNS TABLE (
  channel_id uuid,
  aces_id integer,
  ig_user_id text,
  token_expires_at timestamptz,
  access_token_ciphertext bytea,
  iv bytea,
  auth_tag bytea,
  key_version text
)
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT channel.channel_id
    FROM instagram.channels AS channel
    WHERE channel.health_status IN ('healthy', 'warning')
      AND channel.next_refresh_at IS NOT NULL
      AND channel.next_refresh_at <= now()
      AND (channel.refresh_lease_expires_at IS NULL OR channel.refresh_lease_expires_at <= now())
    ORDER BY channel.next_refresh_at, channel.channel_id
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(p_limit, 1), 20)
  ), claimed AS (
    UPDATE instagram.channels AS channel
    SET refresh_claimed_by = left(p_worker_id, 120),
        refresh_claimed_at = now(),
        refresh_lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 600)),
        refresh_attempt_count = channel.refresh_attempt_count + 1
    FROM candidates
    WHERE channel.channel_id = candidates.channel_id
    RETURNING channel.*
  )
  SELECT claimed.channel_id, claimed.aces_id, claimed.ig_user_id,
         claimed.token_expires_at, credential.access_token_ciphertext,
         credential.iv, credential.auth_tag, credential.key_version
  FROM claimed
  JOIN instagram.channel_credentials AS credential
    ON credential.channel_id = claimed.channel_id;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_complete_token_refresh(
  p_channel_id uuid,
  p_worker_id text,
  p_access_token_ciphertext bytea,
  p_iv bytea,
  p_auth_tag bytea,
  p_key_version text,
  p_token_expires_at timestamptz,
  p_next_refresh_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE instagram.channels
  SET token_expires_at = p_token_expires_at, last_refreshed_at = now(),
      next_refresh_at = p_next_refresh_at, health_status = 'healthy',
      refresh_attempt_count = 0, refresh_claimed_by = NULL,
      refresh_claimed_at = NULL, refresh_lease_expires_at = NULL,
      last_error_code = NULL, last_error_at = NULL
  WHERE channel_id = p_channel_id
    AND refresh_claimed_by = p_worker_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE instagram.channel_credentials
    SET access_token_ciphertext = p_access_token_ciphertext,
        iv = p_iv, auth_tag = p_auth_tag, key_version = p_key_version,
        rotated_at = now()
    WHERE channel_id = p_channel_id;
  END IF;

  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_fail_token_refresh(
  p_channel_id uuid,
  p_worker_id text,
  p_error_code text,
  p_reconnect_required boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE instagram.channels
  SET health_status = CASE WHEN p_reconnect_required THEN 'reconnect_required' ELSE 'warning' END,
      next_refresh_at = CASE
        WHEN p_reconnect_required THEN NULL
        ELSE now() + make_interval(mins => LEAST(1440, 15 * (2 ^ LEAST(refresh_attempt_count, 6))::integer))
      END,
      refresh_claimed_by = NULL, refresh_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      last_error_code = left(COALESCE(p_error_code, 'refresh_failed'), 120),
      last_error_at = now()
  WHERE channel_id = p_channel_id
    AND refresh_claimed_by = p_worker_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF p_reconnect_required AND v_updated = 1 THEN
    UPDATE crm.instance_channels
    SET status = 'reconnect_required'
    WHERE id = p_channel_id;
  END IF;

  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION instagram.rpc_begin_oauth(integer, text, uuid, bytea, bytea, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_claim_oauth(bytea, bytea)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_complete_oauth(uuid, text, text, bytea, bytea, bytea, text, timestamptz, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_fail_oauth(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_claim_webhook_events(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_complete_webhook_event(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_fail_webhook_event(uuid, text, text, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_claim_token_refreshes(text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_complete_token_refresh(uuid, text, bytea, bytea, bytea, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_fail_token_refresh(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION instagram.rpc_begin_oauth(integer, text, uuid, bytea, bytea, text, text, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_claim_oauth(bytea, bytea)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_complete_oauth(uuid, text, text, bytea, bytea, bytea, text, timestamptz, timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_fail_oauth(uuid, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_claim_webhook_events(text, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_complete_webhook_event(uuid, text, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_fail_webhook_event(uuid, text, text, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_claim_token_refreshes(text, integer, integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_complete_token_refresh(uuid, text, bytea, bytea, bytea, text, timestamptz, timestamptz)
  TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_fail_token_refresh(uuid, text, text, boolean)
  TO service_role;

NOTIFY pgrst, 'reload schema';
