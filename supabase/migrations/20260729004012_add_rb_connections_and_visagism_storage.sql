CREATE TABLE IF NOT EXISTS rb.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL UNIQUE REFERENCES crm.accounts(id) ON DELETE CASCADE,
  rb_aces_id integer UNIQUE,
  rb_base_url text NOT NULL DEFAULT 'https://app.registrobase.com.br:32077',
  rb_token_api text NOT NULL UNIQUE,
  rb_empresa_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rb_connections_rb_aces_id_check CHECK (rb_aces_id IS NULL OR rb_aces_id > 0),
  CONSTRAINT rb_connections_token_api_check CHECK (length(trim(rb_token_api)) > 0),
  CONSTRAINT rb_connections_base_url_check CHECK (lower(rb_base_url) LIKE 'https://%'),
  CONSTRAINT rb_connections_company_ids_array_check CHECK (jsonb_typeof(rb_empresa_ids) = 'array')
);

ALTER TABLE rb.connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rb_connections_service_only ON rb.connections;
CREATE POLICY rb_connections_service_only
ON rb.connections
FOR ALL
USING (false)
WITH CHECK (false);

REVOKE ALL ON rb.connections FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON rb.connections TO service_role;

DROP TRIGGER IF EXISTS trg_rb_connections_updated_at ON rb.connections;
CREATE TRIGGER trg_rb_connections_updated_at
BEFORE UPDATE ON rb.connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'visagism-catalog',
  'visagism-catalog',
  true,
  1572864,
  ARRAY['image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = now();

ALTER TABLE agents.visagism_catalog_items
  ADD COLUMN IF NOT EXISTS storage_bucket text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS file_size bigint;

ALTER TABLE agents.visagism_catalog_items
  DROP CONSTRAINT IF EXISTS visagism_catalog_items_url_check;

ALTER TABLE agents.visagism_catalog_items
  ADD CONSTRAINT visagism_catalog_items_url_check CHECK (
    lower(source_url) LIKE 'https://%'
    OR lower(source_url) ~ '^http://(localhost|127\.0\.0\.1|host\.docker\.internal)(:[0-9]+)?/'
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_visagism_catalog_storage_object
  ON agents.visagism_catalog_items(storage_bucket, storage_path)
  WHERE storage_bucket IS NOT NULL AND storage_path IS NOT NULL;
