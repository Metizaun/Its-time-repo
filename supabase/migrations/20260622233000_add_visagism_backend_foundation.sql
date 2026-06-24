CREATE TABLE IF NOT EXISTS agents.visagism_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  recommendation_description text NOT NULL,
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visagism_catalog_items_code_unique UNIQUE (aces_id, product_code),
  CONSTRAINT visagism_catalog_items_attributes_object_check CHECK (jsonb_typeof(attributes) = 'object'),
  CONSTRAINT visagism_catalog_items_order_check CHECK (display_order >= 0),
  CONSTRAINT visagism_catalog_items_url_check CHECK (lower(source_url) LIKE 'https://%')
);

CREATE INDEX IF NOT EXISTS idx_visagism_catalog_items_account_active
  ON agents.visagism_catalog_items(aces_id, is_active, display_order, created_at DESC);

ALTER TABLE agents.visagism_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS visagism_catalog_items_select ON agents.visagism_catalog_items;
CREATE POLICY visagism_catalog_items_select
ON agents.visagism_catalog_items
FOR SELECT
USING (aces_id = current_setting('request.jwt.claim.aces_id', true)::integer);

DROP POLICY IF EXISTS visagism_catalog_items_write ON agents.visagism_catalog_items;
CREATE POLICY visagism_catalog_items_write
ON agents.visagism_catalog_items
FOR ALL
USING (aces_id = current_setting('request.jwt.claim.aces_id', true)::integer)
WITH CHECK (aces_id = current_setting('request.jwt.claim.aces_id', true)::integer);

REVOKE ALL ON agents.visagism_catalog_items FROM anon;
REVOKE INSERT, UPDATE, DELETE ON agents.visagism_catalog_items FROM authenticated;
GRANT SELECT ON agents.visagism_catalog_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents.visagism_catalog_items TO service_role;

