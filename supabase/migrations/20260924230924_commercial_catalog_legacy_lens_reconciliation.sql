-- Pick up legacy lenses written after the first commercial-catalog migration.
-- Existing commercial rows are deliberately left unchanged so edits made in the
-- new catalog, including price and custom group, remain authoritative.
INSERT INTO crm.commercial_catalog_products (aces_id, category, lens_category, display_name, brand,
  treatments, description, price_cents, currency, is_active, legacy_optical_product_id, created_at, updated_at)
SELECT old.aces_id, 'lenses', old.lens_category, old.display_name, old.brand,
  old.treatments, old.description, old.price_cents, old.currency, old.is_active,
  old.id, old.created_at, old.updated_at
FROM crm.optical_catalog_products old
WHERE NOT EXISTS (SELECT 1 FROM crm.commercial_catalog_products catalog
  WHERE catalog.legacy_optical_product_id = old.id)
ON CONFLICT (legacy_optical_product_id) DO NOTHING;
