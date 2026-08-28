-- Instagram Sets 5/6: administrative operations, audit and observability.

CREATE TABLE IF NOT EXISTS instagram.admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES instagram.channels(channel_id) ON DELETE CASCADE,
  actor_id uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('refresh', 'disable')),
  outcome text NOT NULL CHECK (outcome IN ('started', 'succeeded', 'failed')),
  error_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_admin_audit_channel_created
  ON instagram.admin_audit_events(channel_id, created_at DESC);

ALTER TABLE instagram.admin_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON instagram.admin_audit_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON instagram.admin_audit_events TO service_role;

CREATE OR REPLACE FUNCTION instagram.rpc_claim_manual_token_refresh(
  p_channel_id uuid,
  p_aces_id integer,
  p_worker_id text,
  p_min_token_age_hours integer DEFAULT 24,
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
  WITH candidate AS (
    SELECT channel.channel_id
    FROM instagram.channels AS channel
    JOIN crm.instance_channels AS binding
      ON binding.id = channel.channel_id
     AND binding.aces_id = channel.aces_id
    WHERE channel.channel_id = p_channel_id
      AND channel.aces_id = p_aces_id
      AND channel.health_status IN ('healthy', 'warning')
      AND binding.status = 'active'
      AND binding.capability <> 'disabled'
      AND channel.token_obtained_at IS NOT NULL
      AND channel.token_obtained_at <= now() - make_interval(hours => LEAST(GREATEST(p_min_token_age_hours, 1), 168))
      AND channel.token_expires_at > now()
      AND channel.next_refresh_at IS NOT NULL
      AND channel.next_refresh_at <= now()
      AND (channel.refresh_lease_expires_at IS NULL OR channel.refresh_lease_expires_at <= now())
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE instagram.channels AS channel
    SET refresh_claimed_by = left(p_worker_id, 120),
        refresh_claimed_at = now(),
        refresh_lease_expires_at = now() + make_interval(secs => LEAST(GREATEST(p_lease_seconds, 30), 600)),
        refresh_attempt_count = channel.refresh_attempt_count + 1
    FROM candidate
    WHERE channel.channel_id = candidate.channel_id
    RETURNING channel.*
  )
  SELECT claimed.channel_id, claimed.aces_id, claimed.ig_user_id,
         claimed.token_expires_at, credential.access_token_ciphertext,
         credential.iv, credential.auth_tag, credential.key_version
  FROM claimed
  JOIN instagram.channel_credentials AS credential
    ON credential.channel_id = claimed.channel_id;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_disable_channel(
  p_channel_id uuid,
  p_aces_id integer,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_binding crm.instance_channels%ROWTYPE;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM crm.users
    WHERE id = p_actor_id AND aces_id = p_aces_id AND role = 'ADMIN'::crm.user_role
  ) THEN
    RAISE EXCEPTION 'Administrador Instagram nao autorizado';
  END IF;

  SELECT * INTO STRICT v_binding
  FROM crm.instance_channels
  WHERE id = p_channel_id AND aces_id = p_aces_id AND provider = 'instagram'
  FOR UPDATE;

  UPDATE crm.instance_channels
  SET status = 'disabled', capability = 'disabled'
  WHERE id = p_channel_id AND aces_id = p_aces_id;

  UPDATE instagram.channels
  SET health_status = 'disabled',
      refresh_claimed_by = NULL,
      refresh_claimed_at = NULL,
      refresh_lease_expires_at = NULL,
      next_refresh_at = NULL
  WHERE channel_id = p_channel_id AND aces_id = p_aces_id;

  INSERT INTO instagram.admin_audit_events (aces_id, channel_id, actor_id, action, outcome)
  VALUES (p_aces_id, p_channel_id, p_actor_id, 'disable', 'succeeded');

  RETURN jsonb_build_object(
    'channelId', p_channel_id,
    'instanceName', v_binding.instance_name,
    'status', 'disabled'
  );
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_record_refresh_alert(
  p_channel_id uuid,
  p_aces_id integer,
  p_error_code text,
  p_reconnect_required boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_instance_name text;
  v_code text := left(COALESCE(NULLIF(btrim(p_error_code), ''), 'refresh_failed'), 120);
  v_key text := 'instagram_refresh_failure:' || p_channel_id::text || ':' || v_code || ':' || to_char(now(), 'YYYY-MM-DD');
BEGIN
  SELECT instance_name INTO v_instance_name
  FROM crm.instance_channels
  WHERE id = p_channel_id AND aces_id = p_aces_id AND provider = 'instagram';

  IF v_instance_name IS NULL THEN RETURN; END IF;

  INSERT INTO crm.notifications (
    aces_id, category, event_type, title, description, action_path, idempotency_key
  ) VALUES (
    p_aces_id,
    'notice',
    'instagram_refresh_failed',
    CASE WHEN p_reconnect_required THEN 'Reconexao do Instagram necessaria' ELSE 'Conexao do Instagram precisa de atencao' END,
    'A conexao Instagram da instancia ' || v_instance_name || ' precisa ser verificada no painel de conexoes.',
    '/admin?section=instances',
    v_key
  ) ON CONFLICT (idempotency_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION instagram.rpc_operational_metrics(
  p_aces_id integer,
  p_since timestamptz DEFAULT now() - interval '24 hours'
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'oauth', jsonb_build_object(
      'started', (SELECT count(*) FROM instagram.oauth_states WHERE aces_id = p_aces_id AND created_at >= p_since),
      'succeeded', (SELECT count(*) FROM instagram.oauth_states WHERE aces_id = p_aces_id AND status = 'succeeded' AND updated_at >= p_since),
      'failed', (SELECT count(*) FROM instagram.oauth_states WHERE aces_id = p_aces_id AND status = 'failed' AND updated_at >= p_since)
    ),
    'inbound', jsonb_build_object(
      'received', (SELECT count(*) FROM instagram.webhook_events WHERE aces_id = p_aces_id AND received_at >= p_since),
      'processed', (SELECT count(*) FROM instagram.webhook_events WHERE aces_id = p_aces_id AND status = 'processed' AND processed_at >= p_since),
      'failed', (SELECT count(*) FROM instagram.webhook_events WHERE aces_id = p_aces_id AND status = 'failed' AND updated_at >= p_since),
      'deadLetter', (SELECT count(*) FROM instagram.webhook_events WHERE aces_id = p_aces_id AND status = 'dead_letter' AND updated_at >= p_since)
    ),
    'outbound', jsonb_build_object(
      'sent', (SELECT count(*) FROM crm.message_history WHERE aces_id = p_aces_id AND provider = 'instagram' AND direction = 'outbound' AND sent_at >= p_since AND COALESCE(provider_status, '') <> 'failed'),
      'failed', (SELECT count(*) FROM crm.message_history WHERE aces_id = p_aces_id AND provider = 'instagram' AND direction = 'outbound' AND sent_at >= p_since AND (provider_status = 'failed' OR provider_error_code IS NOT NULL))
    ),
    'refresh', jsonb_build_object(
      'succeeded', (SELECT count(*) FROM instagram.admin_audit_events WHERE aces_id = p_aces_id AND action = 'refresh' AND outcome = 'succeeded' AND created_at >= p_since),
      'failed', (SELECT count(*) FROM instagram.admin_audit_events WHERE aces_id = p_aces_id AND action = 'refresh' AND outcome = 'failed' AND created_at >= p_since)
    ),
    'webhookPersistenceLatencyMs', COALESCE((
      SELECT round(avg(extract(epoch FROM (processed_at - received_at)) * 1000)::numeric, 2)
      FROM instagram.webhook_events
      WHERE aces_id = p_aces_id AND status = 'processed' AND processed_at IS NOT NULL AND received_at >= p_since
    ), 0)
  );
$$;

REVOKE ALL ON FUNCTION instagram.rpc_claim_manual_token_refresh(uuid, integer, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_disable_channel(uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_record_refresh_alert(uuid, integer, text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION instagram.rpc_operational_metrics(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION instagram.rpc_claim_manual_token_refresh(uuid, integer, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_disable_channel(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_record_refresh_alert(uuid, integer, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION instagram.rpc_operational_metrics(integer, timestamptz) TO service_role;

NOTIFY pgrst, 'reload schema';
