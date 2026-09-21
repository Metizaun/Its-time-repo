-- Agent-scoped, image-only media catalogue. The agents schema is backend-only.
BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('agent-media-catalog', 'agent-media-catalog', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE IF NOT EXISTS agents.media_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES agents.media_catalogs(id) ON DELETE SET NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_catalogs_name_not_empty CHECK (length(trim(name)) BETWEEN 1 AND 80),
  CONSTRAINT media_catalogs_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT media_catalogs_name_per_parent UNIQUE NULLS NOT DISTINCT (agent_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS agents.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  origin text NOT NULL DEFAULT 'send_media' CHECK (origin IN ('send_media', 'visagism')),
  storage_bucket text NOT NULL DEFAULT 'agent-media-catalog',
  storage_path text NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_name text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  search_terms jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(search_terms) = 'array'),
  attributes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(attributes) = 'object'),
  analysis_completed_at timestamptz,
  send_enabled boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  purge_after timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_analysis_before_send CHECK (send_enabled IS FALSE OR analysis_completed_at IS NOT NULL),
  CONSTRAINT media_assets_disabled_schedule CHECK (
    (send_enabled AND disabled_at IS NULL AND purge_after IS NULL)
    OR (NOT send_enabled AND disabled_at IS NOT NULL AND purge_after IS NOT NULL)
    OR (NOT send_enabled AND disabled_at IS NULL AND purge_after IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS agents.media_catalog_assets (
  catalog_id uuid NOT NULL REFERENCES agents.media_catalogs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES agents.media_assets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (catalog_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_media_catalogs_agent ON agents.media_catalogs (aces_id, agent_id, parent_id, name);
CREATE INDEX IF NOT EXISTS idx_media_assets_agent_active ON agents.media_assets (aces_id, agent_id, send_enabled) WHERE analysis_completed_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_due_purge ON agents.media_assets (purge_after) WHERE send_enabled IS FALSE;
CREATE INDEX IF NOT EXISTS idx_media_catalog_assets_asset ON agents.media_catalog_assets (asset_id);

ALTER TABLE agents.media_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.media_catalog_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON agents.media_catalogs, agents.media_assets, agents.media_catalog_assets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON agents.media_catalogs, agents.media_assets, agents.media_catalog_assets TO service_role;

DROP TRIGGER IF EXISTS trg_media_catalogs_updated_at ON agents.media_catalogs;
CREATE TRIGGER trg_media_catalogs_updated_at BEFORE UPDATE ON agents.media_catalogs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS trg_media_assets_updated_at ON agents.media_assets;
CREATE TRIGGER trg_media_assets_updated_at BEFORE UPDATE ON agents.media_assets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Existing webhook-created Visagismo records remain account-scoped production data.
ALTER TABLE agents.visagism_catalog_items ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents.ai_agents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_visagism_catalog_items_agent ON agents.visagism_catalog_items (aces_id, agent_id) WHERE agent_id IS NOT NULL;

COMMIT;
