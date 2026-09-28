-- Commercial data belongs to the account. Access to each category and image
-- belongs to the agent; missing visibility rows mean hidden.
CREATE TABLE crm.commercial_catalog_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('lenses', 'frames', 'services')),
  lens_category text CHECK (lens_category IS NULL OR lens_category IN ('single_vision', 'multifocal')),
  sku text,
  display_name text NOT NULL CHECK (length(btrim(display_name)) > 0),
  brand text,
  treatments text[] NOT NULL DEFAULT ARRAY[]::text[],
  description text,
  price_cents bigint NOT NULL CHECK (price_cents >= 0),
  price_kind text NOT NULL DEFAULT 'exact' CHECK (price_kind IN ('exact', 'starting_at')),
  currency text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  is_active boolean NOT NULL DEFAULT true,
  legacy_optical_product_id uuid UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (category = 'lenses' OR lens_category IS NULL)
);
CREATE INDEX commercial_catalog_products_lookup_idx
  ON crm.commercial_catalog_products (aces_id, category, is_active, price_cents);
CREATE UNIQUE INDEX commercial_catalog_products_sku_idx
  ON crm.commercial_catalog_products (aces_id, lower(sku)) WHERE sku IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('commercial-catalog', 'commercial-catalog', false, 10485760,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE TABLE crm.commercial_catalog_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES crm.commercial_catalog_products(id) ON DELETE CASCADE,
  storage_bucket text NOT NULL DEFAULT 'commercial-catalog' CHECK (storage_bucket = 'commercial-catalog'),
  storage_path text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  file_name text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 10485760),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_catalog_images_product_idx ON crm.commercial_catalog_images (aces_id, product_id);

CREATE TABLE agents.commercial_catalog_categories (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('lenses', 'frames', 'services')),
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, agent_id, category)
);
CREATE TABLE agents.commercial_catalog_image_visibility (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  image_id uuid NOT NULL REFERENCES crm.commercial_catalog_images(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, agent_id, image_id)
);

CREATE TABLE crm.inbound_media_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES crm.message_history(id) ON DELETE CASCADE,
  attachment_id uuid NOT NULL UNIQUE REFERENCES crm.message_attachments(id) ON DELETE CASCADE,
  kind text CHECK (kind IS NULL OR kind IN ('prescription', 'face', 'product', 'payment_receipt', 'invoice', 'document', 'other')),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed')),
  result jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result) = 'object'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inbound_media_analyses_lead_idx ON crm.inbound_media_analyses (aces_id, lead_id, created_at DESC);

CREATE OR REPLACE FUNCTION crm.enforce_commercial_catalog_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = crm, agents, pg_temp AS $$
DECLARE target_aces_id integer;
BEGIN
  IF TG_TABLE_NAME = 'commercial_catalog_images' THEN
    SELECT aces_id INTO target_aces_id FROM crm.commercial_catalog_products WHERE id = NEW.product_id;
  ELSIF TG_TABLE_NAME = 'commercial_catalog_image_visibility' THEN
    SELECT aces_id INTO target_aces_id FROM crm.commercial_catalog_images WHERE id = NEW.image_id;
  ELSE
    SELECT aces_id INTO target_aces_id FROM crm.message_attachments WHERE id = NEW.attachment_id;
    IF NOT EXISTS (SELECT 1 FROM crm.message_attachments
                   WHERE id = NEW.attachment_id AND lead_id = NEW.lead_id AND message_id = NEW.message_id) THEN
      RAISE EXCEPTION 'Analise e anexo pertencem a contextos diferentes';
    END IF;
  END IF;
  IF target_aces_id IS DISTINCT FROM NEW.aces_id THEN
    RAISE EXCEPTION 'Catalogo ou anexo pertence a outra conta';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER commercial_catalog_images_scope BEFORE INSERT OR UPDATE ON crm.commercial_catalog_images
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_commercial_catalog_scope();
CREATE TRIGGER commercial_catalog_visibility_scope BEFORE INSERT OR UPDATE ON agents.commercial_catalog_image_visibility
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_commercial_catalog_scope();
CREATE TRIGGER inbound_media_analyses_scope BEFORE INSERT OR UPDATE ON crm.inbound_media_analyses
  FOR EACH ROW EXECUTE FUNCTION crm.enforce_commercial_catalog_scope();

CREATE OR REPLACE FUNCTION agents.enforce_commercial_catalog_agent_scope()
RETURNS trigger LANGUAGE plpgsql SET search_path = agents, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM agents.ai_agents WHERE id = NEW.agent_id AND aces_id = NEW.aces_id) THEN
    RAISE EXCEPTION 'Agente pertence a outra conta';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER commercial_catalog_categories_agent_scope BEFORE INSERT OR UPDATE ON agents.commercial_catalog_categories
  FOR EACH ROW EXECUTE FUNCTION agents.enforce_commercial_catalog_agent_scope();
CREATE TRIGGER commercial_catalog_images_agent_scope BEFORE INSERT OR UPDATE ON agents.commercial_catalog_image_visibility
  FOR EACH ROW EXECUTE FUNCTION agents.enforce_commercial_catalog_agent_scope();

ALTER TABLE crm.commercial_catalog_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.commercial_catalog_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.inbound_media_analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.commercial_catalog_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.commercial_catalog_image_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.commercial_catalog_products, crm.commercial_catalog_images, crm.inbound_media_analyses,
  agents.commercial_catalog_categories, agents.commercial_catalog_image_visibility FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.commercial_catalog_products, crm.commercial_catalog_images, crm.inbound_media_analyses,
  agents.commercial_catalog_categories, agents.commercial_catalog_image_visibility TO service_role;

CREATE TRIGGER commercial_catalog_products_updated BEFORE UPDATE ON crm.commercial_catalog_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER commercial_catalog_images_updated BEFORE UPDATE ON crm.commercial_catalog_images
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER inbound_media_analyses_updated BEFORE UPDATE ON crm.inbound_media_analyses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO agents.tool_definitions (tool_key, version, display_name, description, icon, config_schema)
VALUES ('commercial_catalog', 1, 'Catalogo comercial',
        'Consulta lentes, armacoes e servicos cadastrados para o agente.', 'shopping-bag', '{}'::jsonb)
ON CONFLICT (tool_key, version) DO UPDATE SET display_name = EXCLUDED.display_name,
  description = EXCLUDED.description, icon = EXCLUDED.icon, config_schema = EXCLUDED.config_schema,
  is_active = true, updated_at = now();
INSERT INTO agents.agent_template_tools (template_key, template_version, tool_key, tool_version, display_order,
  default_enabled, default_readiness, default_config)
SELECT template_key, version, 'commercial_catalog', 1, 45, false, 'ready', '{}'::jsonb
FROM agents.agent_templates WHERE is_active
ON CONFLICT (template_key, template_version, tool_key) DO NOTHING;
INSERT INTO agents.agent_tools (aces_id, agent_id, tool_key, tool_version, is_enabled, readiness, config)
SELECT agent.aces_id, agent.id, 'commercial_catalog', 1, false, 'ready', '{}'::jsonb
FROM agents.ai_agents agent
ON CONFLICT (agent_id, tool_key) DO NOTHING;

-- Preserve each existing lens product and its old agent's ability to consult it.
INSERT INTO crm.commercial_catalog_products (aces_id, category, lens_category, display_name, brand,
  treatments, description, price_cents, currency, is_active, legacy_optical_product_id, created_at, updated_at)
SELECT aces_id, 'lenses', lens_category, display_name, brand, treatments, description,
  price_cents, currency, is_active, id, created_at, updated_at
FROM crm.optical_catalog_products
ON CONFLICT (legacy_optical_product_id) DO NOTHING;
INSERT INTO agents.commercial_catalog_categories (aces_id, agent_id, category, is_enabled)
SELECT old_tool.aces_id, old_tool.agent_id, 'lenses', true
FROM agents.agent_tools old_tool
WHERE old_tool.tool_key = 'prescription_analyst' AND old_tool.is_enabled
  AND EXISTS (SELECT 1 FROM crm.optical_catalog_products p WHERE p.agent_tool_id = old_tool.id)
ON CONFLICT (aces_id, agent_id, category) DO NOTHING;
UPDATE agents.agent_tools new_tool SET is_enabled = true, readiness = 'ready'
FROM agents.agent_tools old_tool
WHERE new_tool.agent_id = old_tool.agent_id AND new_tool.aces_id = old_tool.aces_id
  AND new_tool.tool_key = 'commercial_catalog' AND old_tool.tool_key = 'prescription_analyst'
  AND old_tool.is_enabled
  AND EXISTS (SELECT 1 FROM crm.optical_catalog_products p WHERE p.agent_tool_id = old_tool.id);
