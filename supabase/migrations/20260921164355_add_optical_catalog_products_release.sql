CREATE TABLE IF NOT EXISTS crm.optical_catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_tool_id uuid NOT NULL REFERENCES agents.agent_tools(id) ON DELETE CASCADE,
  lens_category text NOT NULL,
  display_name text NOT NULL,
  brand text,
  treatments text[] NOT NULL DEFAULT ARRAY[]::text[],
  description text,
  price_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'BRL',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT optical_catalog_products_category_check CHECK (lens_category IN ('single_vision', 'multifocal')),
  CONSTRAINT optical_catalog_products_display_name_check CHECK (length(btrim(display_name)) > 0),
  CONSTRAINT optical_catalog_products_price_check CHECK (price_cents >= 0),
  CONSTRAINT optical_catalog_products_currency_check CHECK (currency = 'BRL'),
  CONSTRAINT optical_catalog_products_treatments_check CHECK (array_position(treatments, '') IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_optical_catalog_products_agent_category
  ON crm.optical_catalog_products(aces_id, agent_tool_id, lens_category, is_active, price_cents);

ALTER TABLE crm.optical_catalog_products ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.optical_catalog_products FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.optical_catalog_products TO service_role;

CREATE OR REPLACE FUNCTION crm.touch_optical_catalog_products_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = crm, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_optical_catalog_products_updated_at ON crm.optical_catalog_products;
CREATE TRIGGER trg_optical_catalog_products_updated_at
BEFORE UPDATE ON crm.optical_catalog_products
FOR EACH ROW EXECUTE FUNCTION crm.touch_optical_catalog_products_updated_at();

-- Keep existing pricing configured by customers available when the new catalog opens.
INSERT INTO crm.optical_catalog_products (
  aces_id, agent_tool_id, lens_category, display_name, price_cents, currency, is_active, created_at, updated_at
)
SELECT
  aces_id,
  agent_tool_id,
  lens_category,
  display_name,
  price_cents,
  currency,
  is_active,
  created_at,
  updated_at
FROM crm.lens_price_rules
WHERE NOT EXISTS (
  SELECT 1
  FROM crm.optical_catalog_products product
  WHERE product.aces_id = lens_price_rules.aces_id
    AND product.agent_tool_id = lens_price_rules.agent_tool_id
    AND product.display_name = lens_price_rules.display_name
    AND product.lens_category = lens_price_rules.lens_category
    AND product.price_cents = lens_price_rules.price_cents
);

-- Persist the commercial family extracted from each prescription. The legacy tipo_lente is
-- retained for backwards compatibility and receives the same normalized value.
ALTER TABLE crm.receituarios
  ADD COLUMN IF NOT EXISTS lens_category text;

UPDATE crm.receituarios
SET lens_category = CASE WHEN COALESCE(addition, 0) > 0 THEN 'multifocal' ELSE 'single_vision' END
WHERE lens_category IS NULL;

UPDATE crm.receituarios
SET tipo_lente = lens_category
WHERE lens_category IS NOT NULL
  AND tipo_lente IS DISTINCT FROM lens_category;

ALTER TABLE crm.receituarios
  DROP CONSTRAINT IF EXISTS receituarios_lens_category_check;
ALTER TABLE crm.receituarios
  ADD CONSTRAINT receituarios_lens_category_check
  CHECK (lens_category IS NULL OR lens_category IN ('single_vision', 'multifocal'));

CREATE INDEX IF NOT EXISTS idx_receituarios_latest_optical_profile
  ON crm.receituarios(aces_id, lead_id, criado_em DESC)
  WHERE lens_category IS NOT NULL;
