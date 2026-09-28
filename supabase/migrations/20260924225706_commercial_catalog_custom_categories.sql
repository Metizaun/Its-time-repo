-- Item types remain stable; account categories organize items within each type.
CREATE TABLE crm.commercial_catalog_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('lenses', 'frames', 'services')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (aces_id, id),
  UNIQUE (aces_id, item_type, id)
);
CREATE UNIQUE INDEX commercial_catalog_groups_name_idx
  ON crm.commercial_catalog_groups (aces_id, item_type, lower(btrim(name)));
CREATE INDEX commercial_catalog_groups_order_idx
  ON crm.commercial_catalog_groups (aces_id, item_type, sort_order, name);

ALTER TABLE crm.commercial_catalog_products
  ADD COLUMN catalog_group_id uuid;
ALTER TABLE crm.commercial_catalog_products
  ADD CONSTRAINT commercial_catalog_product_group_scope
  FOREIGN KEY (aces_id, category, catalog_group_id)
  REFERENCES crm.commercial_catalog_groups (aces_id, item_type, id)
  ON DELETE RESTRICT;
CREATE INDEX commercial_catalog_products_group_idx
  ON crm.commercial_catalog_products (aces_id, category, catalog_group_id);

CREATE TABLE agents.commercial_catalog_group_visibility (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  catalog_group_id uuid NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, agent_id, catalog_group_id),
  FOREIGN KEY (aces_id, catalog_group_id)
    REFERENCES crm.commercial_catalog_groups (aces_id, id) ON DELETE CASCADE
);
CREATE TABLE agents.commercial_catalog_uncategorized_visibility (
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES agents.ai_agents(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('lenses', 'frames', 'services')),
  is_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aces_id, agent_id, item_type)
);
CREATE TRIGGER commercial_catalog_group_visibility_agent_scope
  BEFORE INSERT OR UPDATE ON agents.commercial_catalog_group_visibility
  FOR EACH ROW EXECUTE FUNCTION agents.enforce_commercial_catalog_agent_scope();
CREATE TRIGGER commercial_catalog_uncategorized_agent_scope
  BEFORE INSERT OR UPDATE ON agents.commercial_catalog_uncategorized_visibility
  FOR EACH ROW EXECUTE FUNCTION agents.enforce_commercial_catalog_agent_scope();

ALTER TABLE crm.commercial_catalog_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.commercial_catalog_group_visibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents.commercial_catalog_uncategorized_visibility ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON crm.commercial_catalog_groups,
  agents.commercial_catalog_group_visibility,
  agents.commercial_catalog_uncategorized_visibility FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.commercial_catalog_groups,
  agents.commercial_catalog_group_visibility,
  agents.commercial_catalog_uncategorized_visibility TO service_role;
CREATE TRIGGER commercial_catalog_groups_updated
  BEFORE UPDATE ON crm.commercial_catalog_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION crm.delete_commercial_catalog_group(p_aces_id integer, p_group_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = crm, pg_temp AS $$
BEGIN
  PERFORM 1 FROM crm.commercial_catalog_groups
    WHERE aces_id = p_aces_id AND id = p_group_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Categoria nao encontrada' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM crm.commercial_catalog_products
             WHERE aces_id = p_aces_id AND catalog_group_id = p_group_id AND is_active) THEN
    RAISE EXCEPTION 'Mova ou desative os itens antes de excluir a categoria' USING ERRCODE = '23503';
  END IF;
  UPDATE crm.commercial_catalog_products SET catalog_group_id = NULL
    WHERE aces_id = p_aces_id AND catalog_group_id = p_group_id;
  DELETE FROM crm.commercial_catalog_groups WHERE aces_id = p_aces_id AND id = p_group_id;
END;
$$;
REVOKE ALL ON FUNCTION crm.delete_commercial_catalog_group(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.delete_commercial_catalog_group(integer, uuid) TO service_role;

-- Existing products have no custom group. Preserve their previous agent access.
INSERT INTO agents.commercial_catalog_uncategorized_visibility
  (aces_id, agent_id, item_type, is_enabled)
SELECT aces_id, agent_id, category, true
FROM agents.commercial_catalog_categories
WHERE is_enabled = true
ON CONFLICT (aces_id, agent_id, item_type) DO NOTHING;
