REVOKE ALL ON crm.message_attachment_upload_intents FROM anon;
REVOKE INSERT, UPDATE, DELETE ON crm.message_attachment_upload_intents FROM authenticated;
GRANT SELECT ON crm.message_attachment_upload_intents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.message_attachment_upload_intents TO service_role;

REVOKE ALL ON crm.message_attachments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON crm.message_attachments FROM authenticated;
GRANT SELECT ON crm.message_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.message_attachments TO service_role;
