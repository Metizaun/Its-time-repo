BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';

CREATE TABLE IF NOT EXISTS crm.website_widget_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE SET NULL,
  instance_name text NOT NULL REFERENCES crm.instance(instancia),
  welcome_message text,
  theme jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(theme) = 'object'),
  allowed_domains text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused')),
  created_by uuid REFERENCES crm.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_widget_connections_name_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT website_widget_connections_public_key_check
    CHECK (length(btrim(public_key)) BETWEEN 16 AND 200),
  CONSTRAINT website_widget_connections_welcome_check
    CHECK (welcome_message IS NULL OR length(btrim(welcome_message)) BETWEEN 1 AND 500),
  CONSTRAINT website_widget_connections_tenant_name_unique UNIQUE (aces_id, name),
  CONSTRAINT website_widget_connections_tenant_id_unique UNIQUE (aces_id, id)
);

CREATE INDEX IF NOT EXISTS idx_website_widget_connections_tenant_status
  ON crm.website_widget_connections(aces_id, status, created_at DESC);

-- A live row here means the visitor still has the widget open, so agent replies
-- must land in the widget instead of WhatsApp. When it lapses or is ended, the
-- conversation falls back to WhatsApp.
CREATE TABLE IF NOT EXISTS crm.website_widget_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL,
  connection_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  origin_domain text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'ended')),
  ended_reason text
    CHECK (ended_reason IS NULL OR ended_reason IN ('whatsapp_handoff', 'expired', 'closed')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_widget_sessions_connection_fkey
    FOREIGN KEY (connection_id, aces_id)
    REFERENCES crm.website_widget_connections(id, aces_id)
    ON DELETE CASCADE,
  CONSTRAINT website_widget_sessions_token_hash_check
    CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT website_widget_sessions_ended_reason_consistency
    CHECK (status = 'ended' OR ended_reason IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_website_widget_sessions_lead_live
  ON crm.website_widget_sessions(lead_id, status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_website_widget_sessions_tenant_created
  ON crm.website_widget_sessions(aces_id, created_at DESC);

-- The agent reply is dispatched by an in-memory timer, so a container restart
-- would otherwise drop it silently. One row per visitor message keeps the
-- pending answer durable and bounds how many times it may be retried.
CREATE TABLE IF NOT EXISTS crm.website_widget_reply_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL,
  session_id uuid NOT NULL REFERENCES crm.website_widget_sessions(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  inbound_message_id uuid REFERENCES crm.message_history(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'answered', 'exhausted')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_website_widget_reply_jobs_due
  ON crm.website_widget_reply_jobs(session_id, status, next_attempt_at);

CREATE TABLE IF NOT EXISTS crm.website_widget_rate_limits (
  connection_id uuid NOT NULL REFERENCES crm.website_widget_connections(id) ON DELETE CASCADE,
  ip_hash text NOT NULL,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  PRIMARY KEY (connection_id, ip_hash, window_started_at)
);

ALTER TABLE crm.website_widget_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.website_widget_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.website_widget_reply_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.website_widget_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  crm.website_widget_connections,
  crm.website_widget_sessions,
  crm.website_widget_reply_jobs,
  crm.website_widget_rate_limits
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  crm.website_widget_connections,
  crm.website_widget_sessions,
  crm.website_widget_reply_jobs,
  crm.website_widget_rate_limits
  TO service_role;

CREATE OR REPLACE FUNCTION crm.website_widget_touch_updated_at()
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

REVOKE ALL ON FUNCTION crm.website_widget_touch_updated_at()
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.website_widget_touch_updated_at() TO service_role;

DROP TRIGGER IF EXISTS trg_website_widget_connections_updated_at ON crm.website_widget_connections;
CREATE TRIGGER trg_website_widget_connections_updated_at
BEFORE UPDATE ON crm.website_widget_connections
FOR EACH ROW EXECUTE FUNCTION crm.website_widget_touch_updated_at();

DROP TRIGGER IF EXISTS trg_website_widget_sessions_updated_at ON crm.website_widget_sessions;
CREATE TRIGGER trg_website_widget_sessions_updated_at
BEFORE UPDATE ON crm.website_widget_sessions
FOR EACH ROW EXECUTE FUNCTION crm.website_widget_touch_updated_at();

DROP TRIGGER IF EXISTS trg_website_widget_reply_jobs_updated_at ON crm.website_widget_reply_jobs;
CREATE TRIGGER trg_website_widget_reply_jobs_updated_at
BEFORE UPDATE ON crm.website_widget_reply_jobs
FOR EACH ROW EXECUTE FUNCTION crm.website_widget_touch_updated_at();

CREATE OR REPLACE FUNCTION crm.consume_website_widget_rate_limit(
  p_connection_id uuid,
  p_ip text,
  p_limit integer DEFAULT 120
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_window timestamptz := date_trunc('minute', now());
  v_count integer;
BEGIN
  DELETE FROM crm.website_widget_rate_limits
  WHERE window_started_at < now() - interval '10 minutes';

  INSERT INTO crm.website_widget_rate_limits (
    connection_id, ip_hash, window_started_at, request_count
  ) VALUES (
    p_connection_id,
    encode(extensions.digest(COALESCE(p_ip, 'unknown'), 'sha256'), 'hex'),
    v_window,
    1
  )
  ON CONFLICT (connection_id, ip_hash, window_started_at)
  DO UPDATE SET request_count = crm.website_widget_rate_limits.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN v_count <= LEAST(GREATEST(COALESCE(p_limit, 120), 1), 10000);
END;
$$;

REVOKE ALL ON FUNCTION crm.consume_website_widget_rate_limit(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.consume_website_widget_rate_limit(uuid, text, integer)
  TO service_role;

-- Claims at most one overdue answer for retry. SKIP LOCKED keeps concurrent API
-- replicas from re-dispatching the same visitor message.
CREATE OR REPLACE FUNCTION crm.claim_website_widget_reply_job(
  p_session_id uuid,
  p_max_attempts integer DEFAULT 3,
  p_backoff_seconds integer DEFAULT 25
)
RETURNS TABLE (
  id uuid,
  lead_id uuid,
  inbound_message_id uuid,
  attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  UPDATE crm.website_widget_reply_jobs AS j
  SET attempts = j.attempts + 1,
      next_attempt_at = now() + make_interval(
        secs => GREATEST(COALESCE(p_backoff_seconds, 25), 5) * (j.attempts + 1)
      ),
      updated_at = now()
  WHERE j.id = (
    SELECT candidate.id
    FROM crm.website_widget_reply_jobs AS candidate
    WHERE candidate.session_id = p_session_id
      AND candidate.status = 'pending'
      AND candidate.next_attempt_at <= now()
      AND candidate.attempts < GREATEST(COALESCE(p_max_attempts, 3), 1)
    ORDER BY candidate.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING j.id, j.lead_id, j.inbound_message_id, j.attempts;
END;
$$;

REVOKE ALL ON FUNCTION crm.claim_website_widget_reply_job(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated, authenticator;
GRANT EXECUTE ON FUNCTION crm.claim_website_widget_reply_job(uuid, integer, integer)
  TO service_role;

DO $$
BEGIN
  ALTER TABLE crm.message_history DROP CONSTRAINT IF EXISTS message_history_provider_check;
  ALTER TABLE crm.message_history
    ADD CONSTRAINT message_history_provider_check
    CHECK (provider IN ('evolution', 'meta', 'gupshup', 'instagram', 'website'));
END;
$$;

COMMIT;
