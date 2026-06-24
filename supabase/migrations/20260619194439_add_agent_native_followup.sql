-- Native hidden follow-up support for AI agents.
-- Existing manual follow_up_tasks rows remain untouched; the worker only claims source = 'agent_followup'.

ALTER TABLE crm.follow_up_tasks
  ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES crm.ai_agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS requested_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requested_text text,
  ADD COLUMN IF NOT EXISTS message_text text,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_error_message text,
  ADD COLUMN IF NOT EXISTS provider_payload_summary jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_tasks_source_check'
      AND conrelid = 'crm.follow_up_tasks'::regclass
  ) THEN
    ALTER TABLE crm.follow_up_tasks DROP CONSTRAINT follow_up_tasks_source_check;
  END IF;

  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_source_check
    CHECK (source IN ('manual', 'agent_followup'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_tasks_status_check'
      AND conrelid = 'crm.follow_up_tasks'::regclass
  ) THEN
    ALTER TABLE crm.follow_up_tasks DROP CONSTRAINT follow_up_tasks_status_check;
  END IF;

  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_status_check
    CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled', 'skipped'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_tasks_attempt_count_check'
      AND conrelid = 'crm.follow_up_tasks'::regclass
  ) THEN
    ALTER TABLE crm.follow_up_tasks DROP CONSTRAINT follow_up_tasks_attempt_count_check;
  END IF;

  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_attempt_count_check
    CHECK (attempt_count >= 0);

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_tasks_provider_check'
      AND conrelid = 'crm.follow_up_tasks'::regclass
  ) THEN
    ALTER TABLE crm.follow_up_tasks DROP CONSTRAINT follow_up_tasks_provider_check;
  END IF;

  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_provider_check
    CHECK (provider IS NULL OR provider IN ('evolution', 'meta'));

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'follow_up_tasks_metadata_object_check'
      AND conrelid = 'crm.follow_up_tasks'::regclass
  ) THEN
    ALTER TABLE crm.follow_up_tasks DROP CONSTRAINT follow_up_tasks_metadata_object_check;
  END IF;

  ALTER TABLE crm.follow_up_tasks
    ADD CONSTRAINT follow_up_tasks_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object');
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_follow_up_tasks_agent_idempotency
  ON crm.follow_up_tasks(aces_id, idempotency_key)
  WHERE source = 'agent_followup' AND idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_agent_due
  ON crm.follow_up_tasks(status, due_at, last_attempt_at)
  WHERE source = 'agent_followup' AND completed IS NOT TRUE;

CREATE INDEX IF NOT EXISTS idx_follow_up_tasks_agent_lead
  ON crm.follow_up_tasks(lead_id, due_at DESC)
  WHERE source = 'agent_followup';

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'crm'
    AND t.relname = 'outbound_echo_registry'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) LIKE '%origin%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE crm.outbound_echo_registry DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE crm.outbound_echo_registry
    ADD CONSTRAINT outbound_echo_registry_origin_check
    CHECK (origin IN ('manual', 'ai', 'automation', 'calendar_followup', 'agent_followup'));
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_claim_due_agent_followups(p_limit integer DEFAULT 25)
RETURNS TABLE (
  task_id uuid,
  aces_id integer,
  lead_id uuid,
  agent_id uuid,
  due_at timestamptz,
  requested_text text,
  message_text text,
  attempt_count integer,
  lead_name text,
  lead_phone text,
  instance_name text,
  agent_name text,
  agent_active boolean,
  agent_model text,
  manual_ai_enabled boolean,
  freeze_until timestamptz,
  last_lead_inbound_at timestamptz
)
LANGUAGE plpgsql
SET search_path = crm, public
AS $$
DECLARE
  v_now timestamptz := now();
  v_limit integer;
BEGIN
  IF COALESCE(p_limit, 25) <= 0 THEN
    RETURN;
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 25), 1), 100);

  RETURN QUERY
  WITH candidates AS (
    SELECT t.id
    FROM crm.follow_up_tasks t
    WHERE t.source = 'agent_followup'
      AND t.status = 'pending'
      AND t.completed IS NOT TRUE
      AND t.due_at <= v_now
      AND (
        t.last_attempt_at IS NULL
        OR t.last_attempt_at <= v_now - interval '5 minutes'
      )
    ORDER BY t.due_at ASC, t.created_at ASC, t.id ASC
    LIMIT v_limit
    FOR UPDATE OF t SKIP LOCKED
  ),
  claimed AS (
    UPDATE crm.follow_up_tasks t
    SET
      status = 'processing',
      attempt_count = t.attempt_count + 1,
      last_attempt_at = v_now,
      last_error = NULL,
      metadata = jsonb_set(
        jsonb_set(
          COALESCE(t.metadata, '{}'::jsonb),
          '{last_claimed_at}',
          to_jsonb(v_now::text),
          true
        ),
        '{claim_count}',
        to_jsonb(t.attempt_count + 1),
        true
      )
    FROM candidates c
    WHERE t.id = c.id
    RETURNING t.*
  )
  SELECT
    c.id AS task_id,
    c.aces_id,
    c.lead_id,
    c.agent_id,
    c.due_at,
    c.requested_text,
    c.message_text,
    c.attempt_count,
    l.name::text AS lead_name,
    l.contact_phone::text AS lead_phone,
    COALESCE(a.instance_name, l.instancia)::text AS instance_name,
    a.name::text AS agent_name,
    COALESCE(a.is_active, false) AS agent_active,
    a.model::text AS agent_model,
    als.manual_ai_enabled,
    als.freeze_until,
    (
      SELECT max(mh.sent_at)
      FROM crm.message_history mh
      WHERE mh.lead_id = c.lead_id
        AND mh.source_type = 'lead'
    ) AS last_lead_inbound_at
  FROM claimed c
  JOIN crm.leads l ON l.id = c.lead_id
  LEFT JOIN crm.ai_agents a ON a.id = c.agent_id
  LEFT JOIN crm.ai_lead_state als
    ON als.agent_id = c.agent_id
   AND als.lead_id = c.lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_agent_followup_sent(
  p_task_id uuid,
  p_sent_at timestamptz DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_provider_status text DEFAULT NULL,
  p_provider_payload_summary jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = crm, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE crm.follow_up_tasks
  SET
    status = 'sent',
    completed = true,
    completed_at = COALESCE(p_sent_at, v_now),
    sent_at = COALESCE(p_sent_at, v_now),
    last_error = NULL,
    provider = p_provider,
    provider_message_id = p_provider_message_id,
    provider_status = COALESCE(p_provider_status, 'sent'),
    provider_error_code = NULL,
    provider_error_message = NULL,
    provider_payload_summary = p_provider_payload_summary,
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{sent_at}',
      to_jsonb(COALESCE(p_sent_at, v_now)::text),
      true
    )
  WHERE id = p_task_id
    AND source = 'agent_followup';
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_agent_followup_failed(
  p_task_id uuid,
  p_error text,
  p_retry boolean DEFAULT false,
  p_provider text DEFAULT NULL,
  p_provider_status text DEFAULT NULL,
  p_provider_error_code text DEFAULT NULL,
  p_provider_error_message text DEFAULT NULL,
  p_provider_payload_summary jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = crm, public
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  UPDATE crm.follow_up_tasks
  SET
    status = CASE WHEN COALESCE(p_retry, false) THEN 'pending' ELSE 'failed' END,
    completed = false,
    last_error = LEFT(COALESCE(NULLIF(p_error, ''), 'Falha ao enviar follow-up do agente'), 1000),
    provider = p_provider,
    provider_status = COALESCE(p_provider_status, provider_status),
    provider_error_code = p_provider_error_code,
    provider_error_message = LEFT(COALESCE(p_provider_error_message, p_error, ''), 1000),
    provider_payload_summary = p_provider_payload_summary,
    metadata = jsonb_set(
      jsonb_set(
        COALESCE(metadata, '{}'::jsonb),
        '{last_failure_at}',
        to_jsonb(v_now::text),
        true
      ),
      '{retryable}',
      to_jsonb(COALESCE(p_retry, false)),
      true
    )
  WHERE id = p_task_id
    AND source = 'agent_followup';
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_cancel_agent_followup(
  p_task_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SET search_path = crm, public
AS $$
BEGIN
  UPDATE crm.follow_up_tasks
  SET
    status = 'cancelled',
    completed = false,
    last_error = LEFT(COALESCE(NULLIF(p_reason, ''), 'Follow-up cancelado'), 1000),
    metadata = jsonb_set(
      COALESCE(metadata, '{}'::jsonb),
      '{cancelled_at}',
      to_jsonb(now()::text),
      true
    )
  WHERE id = p_task_id
    AND source = 'agent_followup';
END;
$$;

REVOKE ALL ON FUNCTION crm.rpc_claim_due_agent_followups(integer) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_mark_agent_followup_sent(uuid, timestamptz, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_mark_agent_followup_failed(uuid, text, boolean, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated, authenticator;
REVOKE ALL ON FUNCTION crm.rpc_cancel_agent_followup(uuid, text) FROM PUBLIC, anon, authenticated, authenticator;

GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_agent_followups(integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_agent_followup_sent(uuid, timestamptz, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_agent_followup_failed(uuid, text, boolean, text, text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_cancel_agent_followup(uuid, text) TO service_role;
