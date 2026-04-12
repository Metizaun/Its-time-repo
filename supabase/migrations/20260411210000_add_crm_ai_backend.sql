-- Backend unico da IA operando exclusivamente sobre o CRM.
-- Estruturas aditivas e compativeis com o schema vivo.

ALTER TABLE crm.message_history
  ADD COLUMN IF NOT EXISTS source_type text;

UPDATE crm.message_history
SET source_type = CASE
  WHEN lower(direction) = 'inbound' THEN 'lead'
  ELSE 'human'
END
WHERE source_type IS NULL;

ALTER TABLE crm.message_history
  ALTER COLUMN source_type SET DEFAULT 'human';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'message_history_source_type_check'
      AND conrelid = 'crm.message_history'::regclass
  ) THEN
    ALTER TABLE crm.message_history
      ADD CONSTRAINT message_history_source_type_check
      CHECK (source_type IN ('lead', 'human', 'ai', 'automation', 'system'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_message_history_lead_source_sent_at
  ON crm.message_history(lead_id, source_type, sent_at DESC);

CREATE TABLE IF NOT EXISTS crm.ai_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL DEFAULT public.current_aces_id() REFERENCES crm.accounts(id) ON DELETE CASCADE,
  instance_name text NOT NULL REFERENCES crm.instance(instancia) ON DELETE CASCADE,
  name text NOT NULL,
  system_prompt text NOT NULL,
  provider text NOT NULL DEFAULT 'gemini' CHECK (provider IN ('gemini')),
  model text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  buffer_wait_ms integer NOT NULL DEFAULT 15000 CHECK (buffer_wait_ms BETWEEN 1000 AND 60000),
  human_pause_minutes integer NOT NULL DEFAULT 60 CHECK (human_pause_minutes BETWEEN 1 AND 1440),
  auto_apply_threshold numeric(4,3) NOT NULL DEFAULT 0.850 CHECK (auto_apply_threshold >= 0 AND auto_apply_threshold <= 1),
  created_by uuid DEFAULT public.current_crm_user_id() REFERENCES crm.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_agents_account_instance_unique UNIQUE (aces_id, instance_name)
);

CREATE TABLE IF NOT EXISTS crm.ai_stage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES crm.ai_agents(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES crm.pipeline_stages(id) ON DELETE CASCADE,
  goal_description text NOT NULL DEFAULT '',
  positive_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  negative_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  example_phrases jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority integer NOT NULL DEFAULT 0,
  is_terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_stage_rules_agent_stage_unique UNIQUE (agent_id, stage_id),
  CONSTRAINT ai_stage_rules_positive_array CHECK (jsonb_typeof(positive_signals) = 'array'),
  CONSTRAINT ai_stage_rules_negative_array CHECK (jsonb_typeof(negative_signals) = 'array'),
  CONSTRAINT ai_stage_rules_examples_array CHECK (jsonb_typeof(example_phrases) = 'array')
);

CREATE TABLE IF NOT EXISTS crm.ai_lead_state (
  agent_id uuid NOT NULL REFERENCES crm.ai_agents(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  freeze_until timestamptz,
  last_processed_message_at timestamptz,
  last_inbound_at timestamptz,
  last_ai_reply_at timestamptz,
  last_classified_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  last_confidence numeric(4,3),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agent_id, lead_id)
);

CREATE TABLE IF NOT EXISTS crm.ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES crm.ai_agents(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  message_history_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  suggested_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  applied_stage_id uuid REFERENCES crm.pipeline_stages(id) ON DELETE SET NULL,
  confidence numeric(4,3),
  action_taken text NOT NULL DEFAULT 'none' CHECK (action_taken IN ('none', 'reply_only', 'stage_applied', 'manual_pause', 'failed')),
  error text,
  tokens_in integer,
  tokens_out integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_runs_message_history_ids_array CHECK (jsonb_typeof(message_history_ids) = 'array'),
  CONSTRAINT ai_runs_input_snapshot_object CHECK (jsonb_typeof(input_snapshot) = 'object'),
  CONSTRAINT ai_runs_output_snapshot_object CHECK (jsonb_typeof(output_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_aces_active
  ON crm.ai_agents(aces_id, is_active, instance_name);

CREATE INDEX IF NOT EXISTS idx_ai_stage_rules_agent_priority
  ON crm.ai_stage_rules(agent_id, priority, created_at);

CREATE INDEX IF NOT EXISTS idx_ai_lead_state_freeze
  ON crm.ai_lead_state(agent_id, freeze_until);

CREATE INDEX IF NOT EXISTS idx_ai_runs_lead_created_at
  ON crm.ai_runs(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_runs_agent_created_at
  ON crm.ai_runs(agent_id, created_at DESC);

ALTER TABLE crm.ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.ai_stage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.ai_lead_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.ai_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_agents_select ON crm.ai_agents;
CREATE POLICY ai_agents_select
ON crm.ai_agents
FOR SELECT
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS ai_agents_insert ON crm.ai_agents;
CREATE POLICY ai_agents_insert
ON crm.ai_agents
FOR INSERT
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS ai_agents_update ON crm.ai_agents;
CREATE POLICY ai_agents_update
ON crm.ai_agents
FOR UPDATE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS ai_agents_delete ON crm.ai_agents;
CREATE POLICY ai_agents_delete
ON crm.ai_agents
FOR DELETE
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS ai_stage_rules_select ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_select
ON crm.ai_stage_rules
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_stage_rules.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS ai_stage_rules_insert ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_insert
ON crm.ai_stage_rules
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_stage_rules.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS ai_stage_rules_update ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_update
ON crm.ai_stage_rules
FOR UPDATE
USING (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_stage_rules.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_stage_rules.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS ai_stage_rules_delete ON crm.ai_stage_rules;
CREATE POLICY ai_stage_rules_delete
ON crm.ai_stage_rules
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_stage_rules.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS ai_lead_state_select ON crm.ai_lead_state;
CREATE POLICY ai_lead_state_select
ON crm.ai_lead_state
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_lead_state.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

DROP POLICY IF EXISTS ai_runs_select ON crm.ai_runs;
CREATE POLICY ai_runs_select
ON crm.ai_runs
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM crm.ai_agents a
    WHERE a.id = ai_runs.agent_id
      AND a.aces_id = public.current_aces_id()
      AND public.current_crm_role() = 'ADMIN'::crm.user_role
  )
);

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_agents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_stage_rules TO authenticated;
GRANT SELECT ON crm.ai_lead_state TO authenticated;
GRANT SELECT ON crm.ai_runs TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_agents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_stage_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_lead_state TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_runs TO service_role;

CREATE OR REPLACE FUNCTION crm.service_move_lead_to_stage(
  p_lead_id uuid,
  p_stage_id uuid,
  p_aces_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $$
DECLARE
  v_stage crm.pipeline_stages%ROWTYPE;
BEGIN
  SELECT *
  INTO v_stage
  FROM crm.pipeline_stages
  WHERE id = p_stage_id
    AND aces_id = p_aces_id
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Etapa nao encontrada para a conta informada';
  END IF;

  UPDATE crm.leads
  SET
    stage_id = p_stage_id,
    status = CASE
      WHEN v_stage.category = 'Ganho' THEN 'Fechado'
      WHEN v_stage.category = 'Perdido' THEN 'Perdido'
      ELSE v_stage.name
    END,
    updated_at = now()
  WHERE id = p_lead_id
    AND aces_id = p_aces_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead nao encontrado para a conta informada';
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_ai_agents_updated_at ON crm.ai_agents;
CREATE TRIGGER trg_ai_agents_updated_at
BEFORE UPDATE ON crm.ai_agents
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ai_stage_rules_updated_at ON crm.ai_stage_rules;
CREATE TRIGGER trg_ai_stage_rules_updated_at
BEFORE UPDATE ON crm.ai_stage_rules
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_ai_lead_state_updated_at ON crm.ai_lead_state;
CREATE TRIGGER trg_ai_lead_state_updated_at
BEFORE UPDATE ON crm.ai_lead_state
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
