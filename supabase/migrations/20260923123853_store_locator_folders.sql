-- Shared account-level folders organize the branch catalog.
-- Folder membership never changes per-agent visibility or runtime search results.

CREATE TABLE locator.store_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT locator_store_folders_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  CONSTRAINT locator_store_folders_sort_order_check CHECK (sort_order >= 0)
);

COMMENT ON TABLE locator.store_folders IS
  'Shared account-level folders used to organize locator.stores. Deleting a folder leaves stores uncategorized.';

CREATE UNIQUE INDEX locator_store_folders_account_name_uidx
  ON locator.store_folders (aces_id, lower(btrim(name)));
CREATE INDEX locator_store_folders_account_order_idx
  ON locator.store_folders (aces_id, sort_order, lower(name));

ALTER TABLE locator.stores
  ADD COLUMN folder_id uuid REFERENCES locator.store_folders(id) ON DELETE SET NULL;

CREATE INDEX locator_stores_account_folder_idx
  ON locator.stores (aces_id, folder_id, display_name);
CREATE INDEX locator_stores_folder_id_idx
  ON locator.stores (folder_id)
  WHERE folder_id IS NOT NULL;

CREATE OR REPLACE FUNCTION locator.enforce_store_folder_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_folder_aces_id integer;
BEGIN
  IF NEW.folder_id IS NOT NULL THEN
    SELECT aces_id INTO v_folder_aces_id
    FROM locator.store_folders
    WHERE id = NEW.folder_id;

    IF v_folder_aces_id IS DISTINCT FROM NEW.aces_id THEN
      RAISE EXCEPTION 'Folder does not belong to the requested account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER locator_stores_folder_tenant_integrity
BEFORE INSERT OR UPDATE ON locator.stores
FOR EACH ROW EXECUTE FUNCTION locator.enforce_store_folder_tenant_integrity();

CREATE TRIGGER locator_store_folders_touch_updated_at
BEFORE UPDATE ON locator.store_folders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE locator.store_folders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE locator.store_folders FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE locator.store_folders TO service_role;

NOTIFY pgrst, 'reload schema';
