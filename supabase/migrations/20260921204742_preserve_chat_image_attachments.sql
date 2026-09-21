-- Chat image URLs are short-lived signed URLs, but the stored image itself is
-- part of the conversation history and must not be purged by the automation
-- worker. Keep rows whose object has not been marked deleted available.
BEGIN;

UPDATE crm.message_attachments
SET expires_at = NULL,
    updated_at = now()
WHERE kind = 'image'
  AND storage_deleted_at IS NULL
  AND expires_at IS NOT NULL;

COMMIT;
