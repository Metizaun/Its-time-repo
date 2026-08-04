UPDATE storage.buckets
SET public = false,
    updated_at = now()
WHERE id = 'visagism-catalog';

ALTER TABLE agents.visagism_catalog_items
  DROP CONSTRAINT IF EXISTS visagism_catalog_items_url_check;

ALTER TABLE agents.visagism_catalog_items
  ALTER COLUMN source_url SET DEFAULT '';

COMMENT ON COLUMN agents.visagism_catalog_items.source_url IS
  'Legacy compatibility only. New visagism items use storage_bucket and storage_path.';

ALTER TABLE agents.visagism_catalog_items
  ADD CONSTRAINT visagism_catalog_items_storage_check CHECK (
    (storage_bucket IS NOT NULL AND storage_path IS NOT NULL)
    OR length(trim(source_url)) > 0
  ) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_visagism_catalog_ready_items
  ON agents.visagism_catalog_items(aces_id, is_active, display_order)
  WHERE storage_bucket IS NOT NULL AND storage_path IS NOT NULL;
