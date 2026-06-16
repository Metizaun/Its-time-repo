CREATE TABLE IF NOT EXISTS crm.message_attachment_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL,
  attachment_id uuid NOT NULL UNIQUE,
  aces_id integer NOT NULL,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'audio', 'document')),
  mime_type text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'chat-attachments' CHECK (storage_bucket = 'chat-attachments'),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 104857600),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'consumed', 'failed', 'expired')),
  intent_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachment_upload_intents_lead_created
  ON crm.message_attachment_upload_intents(aces_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_attachment_upload_intents_expiry
  ON crm.message_attachment_upload_intents(intent_expires_at)
  WHERE status = 'issued';

CREATE INDEX IF NOT EXISTS idx_message_attachment_upload_intents_message
  ON crm.message_attachment_upload_intents(message_id);

DROP TRIGGER IF EXISTS trg_message_attachment_upload_intents_updated_at
  ON crm.message_attachment_upload_intents;
CREATE TRIGGER trg_message_attachment_upload_intents_updated_at
BEFORE UPDATE ON crm.message_attachment_upload_intents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE crm.message_attachment_upload_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_attachment_upload_intents_select
  ON crm.message_attachment_upload_intents;
CREATE POLICY message_attachment_upload_intents_select
ON crm.message_attachment_upload_intents
FOR SELECT
TO authenticated
USING (crm.current_user_can_access_lead(lead_id));

REVOKE ALL ON crm.message_attachment_upload_intents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON crm.message_attachment_upload_intents FROM authenticated;
GRANT SELECT ON crm.message_attachment_upload_intents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.message_attachment_upload_intents TO service_role;

CREATE TABLE IF NOT EXISTS crm.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES crm.message_history(id) ON DELETE CASCADE,
  aces_id integer NOT NULL,
  lead_id uuid NOT NULL REFERENCES crm.leads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('image', 'audio', 'document')),
  mime_type text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'chat-attachments' CHECK (storage_bucket = 'chat-attachments'),
  storage_path text NOT NULL UNIQUE,
  file_name text,
  file_size bigint CHECK (file_size IS NULL OR (file_size > 0 AND file_size <= 104857600)),
  expires_at timestamptz,
  storage_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_lead_created
  ON crm.message_attachments(aces_id, lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON crm.message_attachments(message_id);

CREATE INDEX IF NOT EXISTS idx_message_attachments_expiry
  ON crm.message_attachments(expires_at)
  WHERE expires_at IS NOT NULL AND storage_deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_message_attachments_updated_at
  ON crm.message_attachments;
CREATE TRIGGER trg_message_attachments_updated_at
BEFORE UPDATE ON crm.message_attachments
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE crm.message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_attachments_select
  ON crm.message_attachments;
CREATE POLICY message_attachments_select
ON crm.message_attachments
FOR SELECT
TO authenticated
USING (crm.current_user_can_access_lead(lead_id));

REVOKE ALL ON crm.message_attachments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON crm.message_attachments FROM authenticated;
GRANT SELECT ON crm.message_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.message_attachments TO service_role;
