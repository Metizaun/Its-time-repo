-- Pipelines como entidade propria e descricoes de coluna para o classificador interno do CRM.

CREATE TABLE IF NOT EXISTS crm.pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL DEFAULT public.current_aces_id() REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  classifier_key text NOT NULL DEFAULT 'crm_pipeline_classifier',
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid DEFAULT public.current_crm_user_id() REFERENCES crm.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipelines_name_account_unique UNIQUE (aces_id, name),
  CONSTRAINT pipelines_classifier_key_check CHECK (classifier_key ~ '^[a-z][a-z0-9_:-]{1,80}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pipelines_one_default_per_account
  ON crm.pipelines(aces_id)
  WHERE is_default = true;

CREATE INDEX IF NOT EXISTS idx_pipelines_account_active
  ON crm.pipelines(aces_id, is_active, created_at DESC);

ALTER TABLE crm.pipelines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pipelines_select ON crm.pipelines;
CREATE POLICY pipelines_select
ON crm.pipelines
FOR SELECT
TO authenticated
USING (aces_id = public.current_aces_id());

DROP POLICY IF EXISTS pipelines_insert ON crm.pipelines;
CREATE POLICY pipelines_insert
ON crm.pipelines
FOR INSERT
TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS pipelines_update ON crm.pipelines;
CREATE POLICY pipelines_update
ON crm.pipelines
FOR UPDATE
TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
);

DROP POLICY IF EXISTS pipelines_delete ON crm.pipelines;
CREATE POLICY pipelines_delete
ON crm.pipelines
FOR DELETE
TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND public.current_crm_role() = 'ADMIN'::crm.user_role
  AND is_default = false
);

REVOKE ALL ON crm.pipelines FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.pipelines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.pipelines TO service_role;

DROP TRIGGER IF EXISTS trg_pipelines_updated_at ON crm.pipelines;
CREATE TRIGGER trg_pipelines_updated_at
BEFORE UPDATE ON crm.pipelines
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION crm.ensure_default_pipeline(p_aces_id integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  SELECT id
  INTO v_pipeline_id
  FROM crm.pipelines
  WHERE aces_id = p_aces_id
    AND is_default = true
  LIMIT 1;

  IF v_pipeline_id IS NOT NULL THEN
    RETURN v_pipeline_id;
  END IF;

  INSERT INTO crm.pipelines (aces_id, name, description, classifier_key, is_default, is_active)
  VALUES (
    p_aces_id,
    'Pipeline principal',
    'Pipeline padrao migrado automaticamente para preservar o funil atual.',
    'crm_pipeline_classifier',
    true,
    true
  )
  ON CONFLICT (aces_id, name) DO UPDATE
  SET is_default = true,
      is_active = true,
      updated_at = now()
  RETURNING id INTO v_pipeline_id;

  RETURN v_pipeline_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.ensure_default_pipeline(integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.ensure_default_pipeline(integer) TO authenticated;
REVOKE ALL ON FUNCTION crm.ensure_default_pipeline(integer) FROM anon;
REVOKE ALL ON FUNCTION crm.ensure_default_pipeline(integer) FROM PUBLIC;

INSERT INTO crm.pipelines (aces_id, name, description, classifier_key, is_default, is_active)
SELECT
  accounts.id,
  'Pipeline principal',
  'Pipeline padrao migrado automaticamente para preservar o funil atual.',
  'crm_pipeline_classifier',
  true,
  true
FROM crm.accounts AS accounts
WHERE NOT EXISTS (
  SELECT 1
  FROM crm.pipelines AS pipelines
  WHERE pipelines.aces_id = accounts.id
    AND pipelines.is_default = true
)
ON CONFLICT (aces_id, name) DO NOTHING;

ALTER TABLE crm.pipeline_stages
  ADD COLUMN IF NOT EXISTS pipeline_id uuid REFERENCES crm.pipelines(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS classifier_description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS classifier_positive_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS classifier_negative_signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS classifier_examples jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE crm.pipeline_stages AS stage
SET pipeline_id = pipeline.id
FROM crm.pipelines AS pipeline
WHERE stage.pipeline_id IS NULL
  AND pipeline.aces_id = stage.aces_id
  AND pipeline.is_default = true;

ALTER TABLE crm.pipeline_stages
  ALTER COLUMN pipeline_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_stages_classifier_positive_array_check'
      AND conrelid = 'crm.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE crm.pipeline_stages
      ADD CONSTRAINT pipeline_stages_classifier_positive_array_check
      CHECK (jsonb_typeof(classifier_positive_signals) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_stages_classifier_negative_array_check'
      AND conrelid = 'crm.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE crm.pipeline_stages
      ADD CONSTRAINT pipeline_stages_classifier_negative_array_check
      CHECK (jsonb_typeof(classifier_negative_signals) = 'array');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_stages_classifier_examples_array_check'
      AND conrelid = 'crm.pipeline_stages'::regclass
  ) THEN
    ALTER TABLE crm.pipeline_stages
      ADD CONSTRAINT pipeline_stages_classifier_examples_array_check
      CHECK (jsonb_typeof(classifier_examples) = 'array');
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline_position
  ON crm.pipeline_stages(pipeline_id, position);

CREATE OR REPLACE FUNCTION crm.fn_create_default_pipeline_stages(p_aces_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_pipeline_id uuid;
BEGIN
  v_pipeline_id := crm.ensure_default_pipeline(p_aces_id);

  INSERT INTO crm.pipeline_stages (aces_id, pipeline_id, name, color, position, category, is_funnel_stage)
  SELECT p_aces_id, v_pipeline_id, item.name, item.color, item.position, item.category, item.is_funnel_stage
  FROM (
    VALUES
      ('Entrada', '#3b82f6', 0, 'Aberto', true),
      ('Atendimento', '#f59e0b', 1, 'Aberto', true),
      ('Negociacao', '#8b5cf6', 2, 'Aberto', true),
      ('Ganho', '#10b981', 3, 'Ganho', true),
      ('Perdido', '#ef4444', 4, 'Perdido', true)
  ) AS item(name, color, position, category, is_funnel_stage)
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages existing
    WHERE existing.aces_id = p_aces_id
      AND existing.pipeline_id = v_pipeline_id
      AND lower(existing.name) = lower(item.name)
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.fn_create_default_pipeline_stages(integer) TO service_role;
GRANT EXECUTE ON FUNCTION crm.fn_create_default_pipeline_stages(integer) TO authenticated;

CREATE OR REPLACE FUNCTION crm.service_move_lead_to_stage(
  p_lead_id uuid,
  p_stage_id uuid,
  p_aces_id integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
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

  RETURN jsonb_build_object(
    'success', true,
    'pipeline_id', v_stage.pipeline_id,
    'stage_id', v_stage.id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) FROM authenticated;
REVOKE ALL ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION crm.service_move_lead_to_stage(uuid, uuid, integer) FROM PUBLIC;
