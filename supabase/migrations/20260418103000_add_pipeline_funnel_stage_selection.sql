-- Funnel selection per pipeline stage (max 5 per account)

ALTER TABLE crm.pipeline_stages
ADD COLUMN IF NOT EXISTS is_funnel_stage boolean NOT NULL DEFAULT false;

-- Backfill invalid accounts:
-- - 0 selected stages
-- - more than 5 selected stages
-- In both cases, keep first 5 stages by pipeline order.
WITH stage_counts AS (
  SELECT
    aces_id,
    count(*) FILTER (WHERE is_funnel_stage = true) AS selected_count
  FROM crm.pipeline_stages
  GROUP BY aces_id
),
invalid_accounts AS (
  SELECT aces_id
  FROM stage_counts
  WHERE selected_count = 0 OR selected_count > 5
),
ranked_stages AS (
  SELECT
    ps.id,
    row_number() OVER (
      PARTITION BY ps.aces_id
      ORDER BY ps.position ASC, ps.created_at ASC, ps.id ASC
    ) AS stage_rank
  FROM crm.pipeline_stages ps
  INNER JOIN invalid_accounts ia
    ON ia.aces_id = ps.aces_id
)
UPDATE crm.pipeline_stages ps
SET is_funnel_stage = (ranked_stages.stage_rank <= 5)
FROM ranked_stages
WHERE ps.id = ranked_stages.id;

-- Keep default pipeline bootstrap aligned with funnel defaults.
CREATE OR REPLACE FUNCTION crm.fn_create_default_pipeline_stages(p_aces_id integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO crm.pipeline_stages (aces_id, name, color, position, category, is_funnel_stage)
  SELECT p_aces_id, data.name, data.color, data.position, data.category, data.is_funnel_stage
  FROM (
    VALUES
      ('Novo', '#64748b', 0, 'Aberto', true),
      ('Atendimento', '#0ea5e9', 1, 'Aberto', true),
      ('Orçamento', '#f59e0b', 2, 'Aberto', true),
      ('Fechado', '#22c55e', 3, 'Ganho', true),
      ('Perdido', '#ef4444', 4, 'Perdido', true),
      ('Remarketing', '#a855f7', 5, 'Aberto', false)
  ) AS data(name, color, position, category, is_funnel_stage)
  WHERE NOT EXISTS (
    SELECT 1
    FROM crm.pipeline_stages ps
    WHERE ps.aces_id = p_aces_id
      AND lower(ps.name) = lower(data.name)
  );
END;
$$;

CREATE OR REPLACE FUNCTION crm.trg_enforce_pipeline_funnel_stage_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_selected_count integer;
BEGIN
  IF COALESCE(NEW.is_funnel_stage, false) = false THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_funnel_stage, false) = true THEN
    RETURN NEW;
  END IF;

  SELECT count(*)
    INTO v_selected_count
  FROM crm.pipeline_stages
  WHERE aces_id = NEW.aces_id
    AND is_funnel_stage = true
    AND (TG_OP <> 'UPDATE' OR id <> NEW.id);

  IF v_selected_count >= 5 THEN
    RAISE EXCEPTION 'Maximum of 5 funnel stages is allowed per account'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pipeline_stages_funnel_limit ON crm.pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_funnel_limit
BEFORE INSERT OR UPDATE OF is_funnel_stage
ON crm.pipeline_stages
FOR EACH ROW
EXECUTE FUNCTION crm.trg_enforce_pipeline_funnel_stage_limit();
