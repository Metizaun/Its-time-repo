INSERT INTO storage.buckets (id, name, public)
VALUES ('inbox-attachments', 'inbox-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Inbox participants can view attachments" ON storage.objects;
CREATE POLICY "Inbox participants can view attachments"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'inbox-attachments'
  AND array_length(storage.foldername(name), 1) >= 2
  AND EXISTS (
    SELECT 1
    FROM inbox.conversation_participants cp
    JOIN inbox.conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = auth.uid()
      AND cp.left_at IS NULL
      AND cp.conversation_id::text = (storage.foldername(name))[2]
      AND c.organization_id::text = (storage.foldername(name))[1]
  )
);

DROP POLICY IF EXISTS "Inbox participants can upload attachments" ON storage.objects;
CREATE POLICY "Inbox participants can upload attachments"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'inbox-attachments'
  AND array_length(storage.foldername(name), 1) >= 2
  AND EXISTS (
    SELECT 1
    FROM inbox.conversation_participants cp
    JOIN inbox.conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = auth.uid()
      AND cp.left_at IS NULL
      AND cp.conversation_id::text = (storage.foldername(name))[2]
      AND c.organization_id::text = (storage.foldername(name))[1]
      AND public.has_minimum_role(auth.uid(), c.organization_id, 'member'::public.user_role)
  )
);

DROP POLICY IF EXISTS "Inbox participants can update attachments" ON storage.objects;
CREATE POLICY "Inbox participants can update attachments"
ON storage.objects
FOR UPDATE
USING (
  bucket_id = 'inbox-attachments'
  AND array_length(storage.foldername(name), 1) >= 2
  AND EXISTS (
    SELECT 1
    FROM inbox.conversation_participants cp
    JOIN inbox.conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = auth.uid()
      AND cp.left_at IS NULL
      AND cp.conversation_id::text = (storage.foldername(name))[2]
      AND c.organization_id::text = (storage.foldername(name))[1]
      AND public.has_minimum_role(auth.uid(), c.organization_id, 'member'::public.user_role)
  )
)
WITH CHECK (
  bucket_id = 'inbox-attachments'
  AND array_length(storage.foldername(name), 1) >= 2
  AND EXISTS (
    SELECT 1
    FROM inbox.conversation_participants cp
    JOIN inbox.conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = auth.uid()
      AND cp.left_at IS NULL
      AND cp.conversation_id::text = (storage.foldername(name))[2]
      AND c.organization_id::text = (storage.foldername(name))[1]
      AND public.has_minimum_role(auth.uid(), c.organization_id, 'member'::public.user_role)
  )
);

DROP POLICY IF EXISTS "Inbox participants can delete attachments" ON storage.objects;
CREATE POLICY "Inbox participants can delete attachments"
ON storage.objects
FOR DELETE
USING (
  bucket_id = 'inbox-attachments'
  AND array_length(storage.foldername(name), 1) >= 2
  AND EXISTS (
    SELECT 1
    FROM inbox.conversation_participants cp
    JOIN inbox.conversations c ON c.id = cp.conversation_id
    WHERE cp.user_id = auth.uid()
      AND cp.left_at IS NULL
      AND cp.conversation_id::text = (storage.foldername(name))[2]
      AND c.organization_id::text = (storage.foldername(name))[1]
      AND public.has_minimum_role(auth.uid(), c.organization_id, 'member'::public.user_role)
  )
);

