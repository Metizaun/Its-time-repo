-- Keep applied migration history immutable; remove the secondary indexes in a forward migration.
DROP INDEX IF EXISTS locator.locator_agent_store_visibility_store_idx;
DROP INDEX IF EXISTS locator.locator_stores_folder_id_idx;
