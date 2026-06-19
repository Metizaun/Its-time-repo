DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm.message_attachments;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
