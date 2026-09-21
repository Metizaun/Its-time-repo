-- Remove expirations assigned by the legacy backend during the deploy window.
-- The application default is now non-expiring, so active chat images must
-- remain consistent even when this migration is applied more than once.
BEGIN;

UPDATE crm.message_attachments
SET expires_at = NULL,
    updated_at = now()
WHERE kind = 'image'
  AND storage_deleted_at IS NULL
  AND expires_at IS NOT NULL;

COMMIT;
