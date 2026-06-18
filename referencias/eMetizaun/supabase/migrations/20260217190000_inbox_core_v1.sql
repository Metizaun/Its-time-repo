
CREATE SCHEMA IF NOT EXISTS inbox;

GRANT USAGE ON SCHEMA inbox TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA inbox TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA inbox TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA inbox
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA inbox
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'inbox' AND t.typname = 'conversation_type'
  ) THEN
    CREATE TYPE inbox.conversation_type AS ENUM ('direct', 'group', 'channel', 'ai_agent');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'inbox' AND t.typname = 'conversation_status'
  ) THEN
    CREATE TYPE inbox.conversation_status AS ENUM ('open', 'archived');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'inbox' AND t.typname = 'sender_kind'
  ) THEN
    CREATE TYPE inbox.sender_kind AS ENUM ('user', 'agent', 'system', 'external');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'inbox' AND t.typname = 'message_format'
  ) THEN
    CREATE TYPE inbox.message_format AS ENUM ('text', 'markdown', 'system');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'inbox' AND t.typname = 'participant_role'
  ) THEN
    CREATE TYPE inbox.participant_role AS ENUM ('owner', 'member');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'inbox' AND t.typname = 'outbound_status'
  ) THEN
    CREATE TYPE inbox.outbound_status AS ENUM ('pending', 'processing', 'sent', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inbox.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT NULL,
  avatar_url TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agents_org_slug_unique UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS inbox.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type inbox.conversation_type NOT NULL DEFAULT 'direct',
  status inbox.conversation_status NOT NULL DEFAULT 'open',
  title TEXT NULL,
  assigned_to_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  agent_id UUID NULL REFERENCES inbox.agents(id) ON DELETE SET NULL,
  external_conversation_id TEXT NULL,
  created_by_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  last_message_id UUID NULL,
  last_message_preview TEXT NULL,
  last_message_at TIMESTAMPTZ NULL,
  archived_at TIMESTAMPTZ NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversations_ai_agent_requires_agent CHECK (
    type <> 'ai_agent'::inbox.conversation_type OR agent_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS inbox.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role inbox.participant_role NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ NULL,
  last_read_at TIMESTAMPTZ NULL,
  muted BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE TABLE IF NOT EXISTS inbox.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  sender_kind inbox.sender_kind NOT NULL,
  sender_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_agent_id UUID NULL REFERENCES inbox.agents(id) ON DELETE SET NULL,
  sender_external_id TEXT NULL,
  content TEXT NOT NULL,
  format inbox.message_format NOT NULL DEFAULT 'text',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  external_message_id TEXT NULL,
  reply_to_message_id UUID NULL REFERENCES inbox.messages(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT messages_sender_consistency CHECK (
    (
      sender_kind = 'user'::inbox.sender_kind
      AND sender_user_id IS NOT NULL
      AND sender_agent_id IS NULL
      AND sender_external_id IS NULL
    )
    OR (
      sender_kind = 'agent'::inbox.sender_kind
      AND sender_user_id IS NULL
      AND sender_agent_id IS NOT NULL
      AND sender_external_id IS NULL
    )
    OR (
      sender_kind = 'system'::inbox.sender_kind
      AND sender_user_id IS NULL
      AND sender_agent_id IS NULL
    )
    OR (
      sender_kind = 'external'::inbox.sender_kind
      AND sender_user_id IS NULL
      AND sender_agent_id IS NULL
      AND sender_external_id IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS inbox.message_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES inbox.messages(id) ON DELETE CASCADE,
  bucket TEXT NOT NULL DEFAULT 'inbox-attachments',
  path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_by_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT message_attachments_bucket_path_unique UNIQUE (bucket, path),
  CONSTRAINT message_attachments_size_valid CHECK (size_bytes > 0 AND size_bytes <= 20971520)
);

CREATE TABLE IF NOT EXISTS inbox.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#E84C1E',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tags_org_name_unique UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS inbox.conversation_tags (
  conversation_id UUID NOT NULL REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES inbox.tags(id) ON DELETE CASCADE,
  created_by_user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, tag_id)
);

CREATE TABLE IF NOT EXISTS inbox.mentions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES inbox.messages(id) ON DELETE CASCADE,
  mentioned_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT mentions_message_user_unique UNIQUE (message_id, mentioned_user_id)
);

CREATE TABLE IF NOT EXISTS inbox.outbound_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES inbox.messages(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  target TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status inbox.outbound_status NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NULL,
  next_attempt_at TIMESTAMPTZ NULL,
  sent_at TIMESTAMPTZ NULL,
  error TEXT NULL,
  external_event_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_last_message_id_fkey'
      AND conrelid = 'inbox.conversations'::regclass
  ) THEN
    ALTER TABLE inbox.conversations
      ADD CONSTRAINT conversations_last_message_id_fkey
      FOREIGN KEY (last_message_id)
      REFERENCES inbox.messages(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_org_external_unique
ON inbox.conversations (organization_id, external_conversation_id)
WHERE external_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agents_org_active
ON inbox.agents (organization_id, is_active);

CREATE INDEX IF NOT EXISTS idx_conversations_org_status_last
ON inbox.conversations (organization_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_assigned_to
ON inbox.conversations (assigned_to_user_id, status);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
ON inbox.messages (conversation_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_org_external_unique
ON inbox.messages (organization_id, external_message_id)
WHERE external_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mentions_user_unread
ON inbox.mentions (mentioned_user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_participants_user_conversation
ON inbox.conversation_participants (user_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_conversation_tags_tag
ON inbox.conversation_tags (tag_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_outbound_status_retry
ON inbox.outbound_events (status, next_attempt_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_org_external_unique
ON inbox.outbound_events (organization_id, external_event_id)
WHERE external_event_id IS NOT NULL;
CREATE OR REPLACE FUNCTION inbox.validate_conversation_participant_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
DECLARE
  conversation_org_id UUID;
BEGIN
  SELECT c.organization_id
  INTO conversation_org_id
  FROM inbox.conversations c
  WHERE c.id = NEW.conversation_id;

  IF conversation_org_id IS NULL THEN
    RAISE EXCEPTION 'Conversation % does not exist', NEW.conversation_id
      USING ERRCODE = '23503';
  END IF;

  IF conversation_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Participant organization mismatch for conversation %', NEW.conversation_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.is_org_member(NEW.user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'User % is not member of organization %', NEW.user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.validate_message_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
DECLARE
  conversation_org_id UUID;
  agent_org_id UUID;
BEGIN
  SELECT c.organization_id
  INTO conversation_org_id
  FROM inbox.conversations c
  WHERE c.id = NEW.conversation_id;

  IF conversation_org_id IS NULL THEN
    RAISE EXCEPTION 'Conversation % does not exist', NEW.conversation_id
      USING ERRCODE = '23503';
  END IF;

  IF conversation_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Message organization mismatch for conversation %', NEW.conversation_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sender_user_id IS NOT NULL
    AND NOT public.is_org_member(NEW.sender_user_id, NEW.organization_id)
  THEN
    RAISE EXCEPTION 'Sender user % is not member of organization %', NEW.sender_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  IF NEW.sender_agent_id IS NOT NULL THEN
    SELECT a.organization_id
    INTO agent_org_id
    FROM inbox.agents a
    WHERE a.id = NEW.sender_agent_id;

    IF agent_org_id IS NULL OR agent_org_id <> NEW.organization_id THEN
      RAISE EXCEPTION 'Sender agent % does not belong to organization %', NEW.sender_agent_id, NEW.organization_id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.validate_attachment_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
DECLARE
  message_org_id UUID;
  message_conversation_id UUID;
  conversation_org_id UUID;
BEGIN
  SELECT m.organization_id, m.conversation_id
  INTO message_org_id, message_conversation_id
  FROM inbox.messages m
  WHERE m.id = NEW.message_id;

  IF message_org_id IS NULL THEN
    RAISE EXCEPTION 'Message % does not exist', NEW.message_id
      USING ERRCODE = '23503';
  END IF;

  IF message_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Attachment organization mismatch for message %', NEW.message_id
      USING ERRCODE = '23514';
  END IF;

  IF message_conversation_id <> NEW.conversation_id THEN
    RAISE EXCEPTION 'Attachment conversation mismatch for message %', NEW.message_id
      USING ERRCODE = '23514';
  END IF;

  SELECT c.organization_id
  INTO conversation_org_id
  FROM inbox.conversations c
  WHERE c.id = NEW.conversation_id;

  IF conversation_org_id IS NULL OR conversation_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Attachment organization mismatch for conversation %', NEW.conversation_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.validate_mention_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
DECLARE
  message_org_id UUID;
  message_conversation_id UUID;
  conversation_org_id UUID;
BEGIN
  SELECT m.organization_id, m.conversation_id
  INTO message_org_id, message_conversation_id
  FROM inbox.messages m
  WHERE m.id = NEW.message_id;

  IF message_org_id IS NULL THEN
    RAISE EXCEPTION 'Message % does not exist', NEW.message_id
      USING ERRCODE = '23503';
  END IF;

  IF message_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Mention organization mismatch for message %', NEW.message_id
      USING ERRCODE = '23514';
  END IF;

  IF message_conversation_id <> NEW.conversation_id THEN
    RAISE EXCEPTION 'Mention conversation mismatch for message %', NEW.message_id
      USING ERRCODE = '23514';
  END IF;

  SELECT c.organization_id
  INTO conversation_org_id
  FROM inbox.conversations c
  WHERE c.id = NEW.conversation_id;

  IF conversation_org_id IS NULL OR conversation_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Mention organization mismatch for conversation %', NEW.conversation_id
      USING ERRCODE = '23514';
  END IF;

  IF NOT public.is_org_member(NEW.mentioned_user_id, NEW.organization_id) THEN
    RAISE EXCEPTION 'Mentioned user % is not member of organization %', NEW.mentioned_user_id, NEW.organization_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION inbox.validate_outbound_event_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
DECLARE
  message_org_id UUID;
  message_conversation_id UUID;
  conversation_org_id UUID;
BEGIN
  SELECT m.organization_id, m.conversation_id
  INTO message_org_id, message_conversation_id
  FROM inbox.messages m
  WHERE m.id = NEW.message_id;

  IF message_org_id IS NULL THEN
    RAISE EXCEPTION 'Message % does not exist', NEW.message_id
      USING ERRCODE = '23503';
  END IF;

  IF message_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Outbound event organization mismatch for message %', NEW.message_id
      USING ERRCODE = '23514';
  END IF;

  IF message_conversation_id <> NEW.conversation_id THEN
    RAISE EXCEPTION 'Outbound event conversation mismatch for message %', NEW.message_id
      USING ERRCODE = '23514';
  END IF;

  SELECT c.organization_id
  INTO conversation_org_id
  FROM inbox.conversations c
  WHERE c.id = NEW.conversation_id;

  IF conversation_org_id IS NULL OR conversation_org_id <> NEW.organization_id THEN
    RAISE EXCEPTION 'Outbound event organization mismatch for conversation %', NEW.conversation_id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.apply_conversation_status_archive_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
BEGIN
  IF NEW.status = 'archived'::inbox.conversation_status THEN
    NEW.archived_at := COALESCE(NEW.archived_at, now());
  ELSE
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.refresh_conversation_last_message(p_conversation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
DECLARE
  last_message_record inbox.messages%ROWTYPE;
BEGIN
  SELECT m.*
  INTO last_message_record
  FROM inbox.messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.deleted_at IS NULL
  ORDER BY m.created_at DESC
  LIMIT 1;

  UPDATE inbox.conversations c
  SET
    last_message_id = last_message_record.id,
    last_message_preview = CASE
      WHEN last_message_record.id IS NULL THEN NULL
      ELSE left(regexp_replace(COALESCE(last_message_record.content, ''), '\s+', ' ', 'g'), 160)
    END,
    last_message_at = last_message_record.created_at,
    updated_at = now()
  WHERE c.id = p_conversation_id;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.sync_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.conversation_id <> OLD.conversation_id THEN
    PERFORM inbox.refresh_conversation_last_message(OLD.conversation_id);
    PERFORM inbox.refresh_conversation_last_message(NEW.conversation_id);
    RETURN NEW;
  END IF;

  PERFORM inbox.refresh_conversation_last_message(COALESCE(NEW.conversation_id, OLD.conversation_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION inbox.seed_default_tags_for_org(p_organization_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
BEGIN
  INSERT INTO inbox.tags (organization_id, name, color, is_system)
  VALUES
    (p_organization_id, 'Promotions', '#F97316', true),
    (p_organization_id, 'Support', '#0EA5E9', true),
    (p_organization_id, 'Global Sales', '#22C55E', true)
  ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION inbox.handle_organization_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = inbox, public
AS $$
BEGIN
  PERFORM inbox.seed_default_tags_for_org(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_conversation_participants_trigger ON inbox.conversation_participants;
CREATE TRIGGER validate_conversation_participants_trigger
BEFORE INSERT OR UPDATE ON inbox.conversation_participants
FOR EACH ROW
EXECUTE FUNCTION inbox.validate_conversation_participant_consistency();

DROP TRIGGER IF EXISTS validate_messages_trigger ON inbox.messages;
CREATE TRIGGER validate_messages_trigger
BEFORE INSERT OR UPDATE ON inbox.messages
FOR EACH ROW
EXECUTE FUNCTION inbox.validate_message_consistency();

DROP TRIGGER IF EXISTS validate_message_attachments_trigger ON inbox.message_attachments;
CREATE TRIGGER validate_message_attachments_trigger
BEFORE INSERT OR UPDATE ON inbox.message_attachments
FOR EACH ROW
EXECUTE FUNCTION inbox.validate_attachment_consistency();

DROP TRIGGER IF EXISTS validate_mentions_trigger ON inbox.mentions;
CREATE TRIGGER validate_mentions_trigger
BEFORE INSERT OR UPDATE ON inbox.mentions
FOR EACH ROW
EXECUTE FUNCTION inbox.validate_mention_consistency();

DROP TRIGGER IF EXISTS validate_outbound_events_trigger ON inbox.outbound_events;
CREATE TRIGGER validate_outbound_events_trigger
BEFORE INSERT OR UPDATE ON inbox.outbound_events
FOR EACH ROW
EXECUTE FUNCTION inbox.validate_outbound_event_consistency();

DROP TRIGGER IF EXISTS apply_conversation_status_archive_timestamp_trigger ON inbox.conversations;
CREATE TRIGGER apply_conversation_status_archive_timestamp_trigger
BEFORE INSERT OR UPDATE OF status, archived_at ON inbox.conversations
FOR EACH ROW
EXECUTE FUNCTION inbox.apply_conversation_status_archive_timestamp();

DROP TRIGGER IF EXISTS sync_conversation_last_message_trigger ON inbox.messages;
CREATE TRIGGER sync_conversation_last_message_trigger
AFTER INSERT OR UPDATE OR DELETE ON inbox.messages
FOR EACH ROW
EXECUTE FUNCTION inbox.sync_conversation_last_message();
DROP TRIGGER IF EXISTS update_agents_updated_at ON inbox.agents;
CREATE TRIGGER update_agents_updated_at
BEFORE UPDATE ON inbox.agents
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversations_updated_at ON inbox.conversations;
CREATE TRIGGER update_conversations_updated_at
BEFORE UPDATE ON inbox.conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_conversation_participants_updated_at ON inbox.conversation_participants;
CREATE TRIGGER update_conversation_participants_updated_at
BEFORE UPDATE ON inbox.conversation_participants
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_messages_updated_at ON inbox.messages;
CREATE TRIGGER update_messages_updated_at
BEFORE UPDATE ON inbox.messages
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_tags_updated_at ON inbox.tags;
CREATE TRIGGER update_tags_updated_at
BEFORE UPDATE ON inbox.tags
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_outbound_events_updated_at ON inbox.outbound_events;
CREATE TRIGGER update_outbound_events_updated_at
BEFORE UPDATE ON inbox.outbound_events
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS seed_inbox_default_tags_on_org_insert ON public.organizations;
CREATE TRIGGER seed_inbox_default_tags_on_org_insert
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION inbox.handle_organization_created();

SELECT inbox.seed_default_tags_for_org(id)
FROM public.organizations;

ALTER TABLE inbox.agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.conversation_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.outbound_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org members can view agents" ON inbox.agents;
CREATE POLICY "Org members can view agents"
ON inbox.agents
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create agents" ON inbox.agents;
CREATE POLICY "Members can create agents"
ON inbox.agents
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Members can update agents" ON inbox.agents;
CREATE POLICY "Members can update agents"
ON inbox.agents
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete agents" ON inbox.agents;
CREATE POLICY "Admins can delete agents"
ON inbox.agents
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view conversations" ON inbox.conversations;
CREATE POLICY "Org members can view conversations"
ON inbox.conversations
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create conversations" ON inbox.conversations;
CREATE POLICY "Members can create conversations"
ON inbox.conversations
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND (
    created_by_user_id IS NULL
    OR created_by_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Members can update conversations" ON inbox.conversations;
CREATE POLICY "Members can update conversations"
ON inbox.conversations
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete conversations" ON inbox.conversations;
CREATE POLICY "Admins can delete conversations"
ON inbox.conversations
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view participants" ON inbox.conversation_participants;
CREATE POLICY "Org members can view participants"
ON inbox.conversation_participants
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can insert participants" ON inbox.conversation_participants;
CREATE POLICY "Members can insert participants"
ON inbox.conversation_participants
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Members can update participants" ON inbox.conversation_participants;
CREATE POLICY "Members can update participants"
ON inbox.conversation_participants
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Members can delete participants" ON inbox.conversation_participants;
CREATE POLICY "Members can delete participants"
ON inbox.conversation_participants
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));
DROP POLICY IF EXISTS "Org members can view messages" ON inbox.messages;
CREATE POLICY "Org members can view messages"
ON inbox.messages
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create user messages" ON inbox.messages;
CREATE POLICY "Members can create user messages"
ON inbox.messages
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  AND sender_kind = 'user'::inbox.sender_kind
  AND sender_user_id = auth.uid()
);

DROP POLICY IF EXISTS "Users can update own messages" ON inbox.messages;
CREATE POLICY "Users can update own messages"
ON inbox.messages
FOR UPDATE
USING (
  sender_kind = 'user'::inbox.sender_kind
  AND sender_user_id = auth.uid()
  AND public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
)
WITH CHECK (
  sender_kind = 'user'::inbox.sender_kind
  AND sender_user_id = auth.uid()
  AND public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
);

DROP POLICY IF EXISTS "Admins can delete messages" ON inbox.messages;
CREATE POLICY "Admins can delete messages"
ON inbox.messages
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view attachments" ON inbox.message_attachments;
CREATE POLICY "Org members can view attachments"
ON inbox.message_attachments
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can create own attachments" ON inbox.message_attachments;
CREATE POLICY "Users can create own attachments"
ON inbox.message_attachments
FOR INSERT
WITH CHECK (
  created_by_user_id = auth.uid()
  AND public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
);

DROP POLICY IF EXISTS "Users can update own attachments" ON inbox.message_attachments;
CREATE POLICY "Users can update own attachments"
ON inbox.message_attachments
FOR UPDATE
USING (
  created_by_user_id = auth.uid()
  AND public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
)
WITH CHECK (
  created_by_user_id = auth.uid()
  AND public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
);

DROP POLICY IF EXISTS "Users can delete own attachments" ON inbox.message_attachments;
CREATE POLICY "Users can delete own attachments"
ON inbox.message_attachments
FOR DELETE
USING (
  (
    created_by_user_id = auth.uid()
    AND public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
  )
  OR public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role)
);

DROP POLICY IF EXISTS "Org members can view tags" ON inbox.tags;
CREATE POLICY "Org members can view tags"
ON inbox.tags
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Admins can create tags" ON inbox.tags;
CREATE POLICY "Admins can create tags"
ON inbox.tags
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Admins can update tags" ON inbox.tags;
CREATE POLICY "Admins can update tags"
ON inbox.tags
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete tags" ON inbox.tags;
CREATE POLICY "Admins can delete tags"
ON inbox.tags
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view conversation tags" ON inbox.conversation_tags;
CREATE POLICY "Org members can view conversation tags"
ON inbox.conversation_tags
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM inbox.conversations c
    WHERE c.id = conversation_tags.conversation_id
      AND public.is_org_member(auth.uid(), c.organization_id)
  )
);

DROP POLICY IF EXISTS "Members can create conversation tags" ON inbox.conversation_tags;
CREATE POLICY "Members can create conversation tags"
ON inbox.conversation_tags
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM inbox.conversations c
    WHERE c.id = conversation_tags.conversation_id
      AND public.has_minimum_role(auth.uid(), c.organization_id, 'member'::public.user_role)
  )
);

DROP POLICY IF EXISTS "Members can delete conversation tags" ON inbox.conversation_tags;
CREATE POLICY "Members can delete conversation tags"
ON inbox.conversation_tags
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM inbox.conversations c
    WHERE c.id = conversation_tags.conversation_id
      AND public.has_minimum_role(auth.uid(), c.organization_id, 'member'::public.user_role)
  )
);

DROP POLICY IF EXISTS "Users can view own mentions" ON inbox.mentions;
CREATE POLICY "Users can view own mentions"
ON inbox.mentions
FOR SELECT
USING (mentioned_user_id = auth.uid());

DROP POLICY IF EXISTS "Members can create mentions" ON inbox.mentions;
CREATE POLICY "Members can create mentions"
ON inbox.mentions
FOR INSERT
WITH CHECK (
  public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role)
);

DROP POLICY IF EXISTS "Users can update own mentions" ON inbox.mentions;
CREATE POLICY "Users can update own mentions"
ON inbox.mentions
FOR UPDATE
USING (mentioned_user_id = auth.uid())
WITH CHECK (mentioned_user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can delete mentions" ON inbox.mentions;
CREATE POLICY "Admins can delete mentions"
ON inbox.mentions
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Org members can view outbound events" ON inbox.outbound_events;
CREATE POLICY "Org members can view outbound events"
ON inbox.outbound_events
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Members can create outbound events" ON inbox.outbound_events;
CREATE POLICY "Members can create outbound events"
ON inbox.outbound_events
FOR INSERT
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'::public.user_role));

DROP POLICY IF EXISTS "Admins can update outbound events" ON inbox.outbound_events;
CREATE POLICY "Admins can update outbound events"
ON inbox.outbound_events
FOR UPDATE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role))
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DROP POLICY IF EXISTS "Admins can delete outbound events" ON inbox.outbound_events;
CREATE POLICY "Admins can delete outbound events"
ON inbox.outbound_events
FOR DELETE
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'::public.user_role));

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox.conversations;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox.messages;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox.mentions;
  EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
  END;
END $$;

