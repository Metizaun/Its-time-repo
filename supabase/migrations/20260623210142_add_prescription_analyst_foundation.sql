CREATE TABLE IF NOT EXISTS crm.receituarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  data_receita date,
  tipo_lente text,
  od_longe text,
  oe_longe text,
  od_perto text,
  oe_perto text,
  "Adicao" text,
  receita_vale_ate date,
  observacoes text,
  metadados jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE crm.receituarios
  ADD COLUMN IF NOT EXISTS source_message_id uuid REFERENCES crm.message_history(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_attachment_id uuid REFERENCES crm.message_attachments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agent_tool_run_id uuid REFERENCES agents.agent_tool_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS od_sphere numeric(5,2),
  ADD COLUMN IF NOT EXISTS od_cylinder numeric(5,2),
  ADD COLUMN IF NOT EXISTS od_axis smallint,
  ADD COLUMN IF NOT EXISTS oe_sphere numeric(5,2),
  ADD COLUMN IF NOT EXISTS oe_cylinder numeric(5,2),
  ADD COLUMN IF NOT EXISTS oe_axis smallint,
  ADD COLUMN IF NOT EXISTS addition numeric(5,2),
  ADD COLUMN IF NOT EXISTS distance_pd numeric(5,2),
  ADD COLUMN IF NOT EXISTS near_pd numeric(5,2),
  ADD COLUMN IF NOT EXISTS patient_name text,
  ADD COLUMN IF NOT EXISTS prescriber_name text,
  ADD COLUMN IF NOT EXISTS prescriber_registration text,
  ADD COLUMN IF NOT EXISTS prescription_date date,
  ADD COLUMN IF NOT EXISTS expires_at date,
  ADD COLUMN IF NOT EXISTS has_myopia boolean,
  ADD COLUMN IF NOT EXISTS has_hyperopia boolean,
  ADD COLUMN IF NOT EXISTS has_astigmatism boolean,
  ADD COLUMN IF NOT EXISTS has_presbyopia boolean,
  ADD COLUMN IF NOT EXISTS analysis_model text,
  ADD COLUMN IF NOT EXISTS analysis_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS raw_extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_status_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_status_check
      CHECK (status IS NULL OR status IN ('parsed', 'needs_new_image', 'failed'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_od_axis_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_od_axis_check
      CHECK (od_axis IS NULL OR od_axis BETWEEN 0 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_oe_axis_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_oe_axis_check
      CHECK (oe_axis IS NULL OR oe_axis BETWEEN 0 AND 180);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receituarios_raw_extraction_object_check') THEN
    ALTER TABLE crm.receituarios ADD CONSTRAINT receituarios_raw_extraction_object_check
      CHECK (jsonb_typeof(raw_extraction) = 'object');
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_receituarios_source_attachment_unique
  ON crm.receituarios(source_attachment_id) WHERE source_attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_receituarios_source_message ON crm.receituarios(source_message_id);
CREATE INDEX IF NOT EXISTS idx_receituarios_tool_run ON crm.receituarios(agent_tool_run_id);
CREATE INDEX IF NOT EXISTS idx_receituarios_account_lead ON crm.receituarios(aces_id, lead_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS crm.lens_price_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL REFERENCES agents.agent_tools(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  lens_category text NOT NULL,
  min_sphere numeric(5,2) NOT NULL,
  max_sphere numeric(5,2) NOT NULL,
  max_abs_cylinder numeric(5,2) NOT NULL,
  min_addition numeric(5,2),
  max_addition numeric(5,2),
  price_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lens_price_rules_category_check CHECK (lens_category IN ('single_vision', 'multifocal')),
  CONSTRAINT lens_price_rules_sphere_range_check CHECK (min_sphere <= max_sphere),
  CONSTRAINT lens_price_rules_cylinder_check CHECK (max_abs_cylinder >= 0),
  CONSTRAINT lens_price_rules_addition_range_check CHECK (
    (min_addition IS NULL AND max_addition IS NULL)
    OR (min_addition IS NOT NULL AND max_addition IS NOT NULL AND min_addition <= max_addition)
  ),
  CONSTRAINT lens_price_rules_price_check CHECK (price_cents >= 0),
  CONSTRAINT lens_price_rules_currency_check CHECK (currency = 'BRL'),
  CONSTRAINT lens_price_rules_priority_check CHECK (priority >= 0),
  CONSTRAINT lens_price_rules_name_check CHECK (length(btrim(display_name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_lens_price_rules_matching
  ON crm.lens_price_rules(aces_id, agent_tool_id, lens_category, is_active, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_lens_price_rules_agent_tool ON crm.lens_price_rules(agent_tool_id);

ALTER TABLE crm.receituarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.lens_price_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS receituarios_all ON crm.receituarios;
DROP POLICY IF EXISTS lens_price_rules_all ON crm.lens_price_rules;

REVOKE ALL ON crm.receituarios FROM anon, authenticated;
REVOKE ALL ON crm.lens_price_rules FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.receituarios TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.lens_price_rules TO service_role;

CREATE OR REPLACE FUNCTION crm.validate_prescription_account_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = crm, agents, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM crm.leads l WHERE l.id = NEW.lead_id AND l.aces_id = NEW.aces_id
  ) THEN
    RAISE EXCEPTION 'Receituario e lead pertencem a contas diferentes';
  END IF;

  IF NEW.agent_tool_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM agents.agent_tool_runs r
    WHERE r.id = NEW.agent_tool_run_id AND r.aces_id = NEW.aces_id AND r.lead_id = NEW.lead_id
  ) THEN
    RAISE EXCEPTION 'Receituario e execucao pertencem a contextos diferentes';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_prescription_account_scope ON crm.receituarios;
CREATE TRIGGER trg_validate_prescription_account_scope
BEFORE INSERT OR UPDATE ON crm.receituarios
FOR EACH ROW EXECUTE FUNCTION crm.validate_prescription_account_scope();

CREATE OR REPLACE FUNCTION crm.touch_prescription_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = crm, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receituarios_updated_at ON crm.receituarios;
CREATE TRIGGER trg_receituarios_updated_at
BEFORE UPDATE ON crm.receituarios
FOR EACH ROW EXECUTE FUNCTION crm.touch_prescription_updated_at();

DROP TRIGGER IF EXISTS trg_lens_price_rules_updated_at ON crm.lens_price_rules;
CREATE TRIGGER trg_lens_price_rules_updated_at
BEFORE UPDATE ON crm.lens_price_rules
FOR EACH ROW EXECUTE FUNCTION crm.touch_prescription_updated_at();

CREATE OR REPLACE FUNCTION crm.mark_lead_has_prescription()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = crm, pg_temp
AS $$
BEGIN
  UPDATE crm.leads SET receita = true WHERE id = NEW.lead_id AND aces_id = NEW.aces_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mark_lead_has_prescription ON crm.receituarios;
CREATE TRIGGER trg_mark_lead_has_prescription
AFTER INSERT ON crm.receituarios
FOR EACH ROW EXECUTE FUNCTION crm.mark_lead_has_prescription();
