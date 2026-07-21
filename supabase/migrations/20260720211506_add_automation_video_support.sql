-- Permite vídeos MP4 em passos de automação e no catálogo reutilizável de mídias.

UPDATE storage.buckets
SET
  allowed_mime_types = ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/heic',
    'image/heif',
    'video/mp4',
    'application/pdf'
  ]::text[],
  updated_at = now()
WHERE id = 'automation-media';

ALTER TABLE crm.automation_steps
  DROP CONSTRAINT IF EXISTS automation_steps_content_payload_check,
  DROP CONSTRAINT IF EXISTS automation_steps_media_kind_check;

ALTER TABLE crm.automation_steps
  ADD CONSTRAINT automation_steps_media_kind_check
    CHECK (media_kind IS NULL OR media_kind IN ('image', 'video', 'document')),
  ADD CONSTRAINT automation_steps_content_payload_check
    CHECK (
      (
        content_mode = 'text'
        AND char_length(btrim(COALESCE(message_template, ''))) > 0
        AND media_asset_id IS NULL
        AND media_kind IS NULL
      )
      OR
      (
        content_mode = 'media'
        AND media_asset_id IS NOT NULL
        AND media_kind IN ('image', 'video', 'document')
      )
    );

ALTER TABLE crm.automation_media_assets
  DROP CONSTRAINT IF EXISTS automation_media_assets_kind_check;

ALTER TABLE crm.automation_media_assets
  ADD CONSTRAINT automation_media_assets_kind_check
    CHECK (media_kind IN ('image', 'video', 'document'));
