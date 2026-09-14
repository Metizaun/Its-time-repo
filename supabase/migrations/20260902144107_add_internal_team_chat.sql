BEGIN;

CREATE TABLE crm.internal_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('direct', 'group')),
  name text,
  created_by uuid NOT NULL REFERENCES crm.users(id),
  direct_key text,
  archived_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT internal_conversations_shape_check CHECK (
    (kind = 'direct' AND direct_key IS NOT NULL AND name IS NULL)
    OR
    (kind = 'group' AND direct_key IS NULL AND name IS NOT NULL AND btrim(name) <> '' AND char_length(name) <= 80)
  )
);

CREATE UNIQUE INDEX internal_conversations_direct_key_uidx
  ON crm.internal_conversations(direct_key)
  WHERE kind = 'direct';
CREATE INDEX internal_conversations_account_activity_idx
  ON crm.internal_conversations(aces_id, archived_at, last_message_at DESC NULLS LAST, created_at DESC);
CREATE INDEX internal_conversations_creator_idx
  ON crm.internal_conversations(created_by);

CREATE TABLE crm.internal_conversation_members (
  conversation_id uuid NOT NULL REFERENCES crm.internal_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES crm.users(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  is_admin boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id),
  CONSTRAINT internal_members_removal_state_check CHECK (
    (is_active AND removed_at IS NULL) OR (NOT is_active AND removed_at IS NOT NULL)
  )
);

CREATE INDEX internal_members_user_active_idx
  ON crm.internal_conversation_members(user_id, is_active, conversation_id);
CREATE INDEX internal_members_conversation_active_idx
  ON crm.internal_conversation_members(conversation_id, is_active, user_id);
CREATE INDEX internal_members_account_idx
  ON crm.internal_conversation_members(aces_id, user_id);

CREATE TABLE crm.internal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES crm.internal_conversations(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES crm.users(id),
  content text NOT NULL DEFAULT '' CHECK (char_length(content) <= 10000),
  reply_to_message_id uuid REFERENCES crm.internal_messages(id),
  client_message_id uuid NOT NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, author_id, client_message_id)
);

CREATE INDEX internal_messages_conversation_cursor_idx
  ON crm.internal_messages(conversation_id, created_at DESC, id DESC);
CREATE INDEX internal_messages_author_idx ON crm.internal_messages(author_id);
CREATE INDEX internal_messages_account_idx ON crm.internal_messages(aces_id, created_at DESC);
CREATE INDEX internal_messages_reply_idx
  ON crm.internal_messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE TABLE crm.internal_message_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES crm.internal_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES crm.internal_conversations(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  mention_type text NOT NULL CHECK (mention_type IN ('user', 'all', 'lead')),
  mentioned_user_id uuid REFERENCES crm.users(id),
  lead_id uuid REFERENCES crm.leads(id),
  token_start integer NOT NULL CHECK (token_start >= 0),
  token_length integer NOT NULL CHECK (token_length > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, token_start),
  CONSTRAINT internal_message_mentions_target_check CHECK (
    (mention_type = 'user' AND mentioned_user_id IS NOT NULL AND lead_id IS NULL)
    OR (mention_type = 'lead' AND lead_id IS NOT NULL AND mentioned_user_id IS NULL)
    OR (mention_type = 'all' AND lead_id IS NULL AND mentioned_user_id IS NULL)
  )
);

CREATE INDEX internal_mentions_message_idx ON crm.internal_message_mentions(message_id, token_start);
CREATE INDEX internal_mentions_conversation_idx ON crm.internal_message_mentions(conversation_id);
CREATE INDEX internal_mentions_account_idx ON crm.internal_message_mentions(aces_id);
CREATE INDEX internal_mentions_user_idx
  ON crm.internal_message_mentions(mentioned_user_id, created_at DESC)
  WHERE mentioned_user_id IS NOT NULL;
CREATE INDEX internal_mentions_lead_idx
  ON crm.internal_message_mentions(lead_id)
  WHERE lead_id IS NOT NULL;

CREATE TABLE crm.internal_message_attachment_upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL UNIQUE,
  message_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES crm.internal_conversations(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES crm.users(id),
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

CREATE INDEX internal_attachment_intents_owner_idx
  ON crm.internal_message_attachment_upload_intents(created_by, conversation_id, created_at DESC);
CREATE INDEX internal_attachment_intents_conversation_idx
  ON crm.internal_message_attachment_upload_intents(conversation_id);
CREATE INDEX internal_attachment_intents_account_status_idx
  ON crm.internal_message_attachment_upload_intents(aces_id, status, created_at DESC);
CREATE INDEX internal_attachment_intents_expiry_idx
  ON crm.internal_message_attachment_upload_intents(intent_expires_at)
  WHERE status = 'issued';

CREATE TABLE crm.internal_message_attachments (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES crm.internal_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES crm.internal_conversations(id) ON DELETE CASCADE,
  aces_id integer NOT NULL REFERENCES crm.accounts(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES crm.users(id),
  kind text NOT NULL CHECK (kind IN ('image', 'audio', 'document')),
  mime_type text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'chat-attachments' CHECK (storage_bucket = 'chat-attachments'),
  storage_path text NOT NULL UNIQUE,
  file_name text,
  file_size bigint CHECK (file_size IS NULL OR (file_size > 0 AND file_size <= 104857600)),
  storage_deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX internal_attachments_message_idx ON crm.internal_message_attachments(message_id);
CREATE INDEX internal_attachments_conversation_idx
  ON crm.internal_message_attachments(conversation_id, created_at DESC);
CREATE INDEX internal_attachments_account_idx ON crm.internal_message_attachments(aces_id);
CREATE INDEX internal_attachments_uploader_idx ON crm.internal_message_attachments(uploaded_by);

CREATE OR REPLACE FUNCTION crm.internal_current_user_is_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.users AS u
    WHERE u.auth_user_id = (SELECT auth.uid())
      AND u.aces_id = public.current_aces_id()
      AND u.role::text IN ('ADMIN', 'VENDEDOR')
  );
$$;

CREATE OR REPLACE FUNCTION crm.internal_is_conversation_member(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM crm.internal_conversation_members AS m
    WHERE m.conversation_id = p_conversation_id
      AND m.user_id = public.current_crm_user_id()
      AND m.aces_id = public.current_aces_id()
      AND m.is_active IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION crm.internal_can_manage_conversation(p_conversation_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT crm.internal_current_user_is_active()
    AND EXISTS (
      SELECT 1
      FROM crm.internal_conversations AS c
      WHERE c.id = p_conversation_id
        AND c.aces_id = public.current_aces_id()
        AND (
          crm.current_user_is_account_admin()
          OR EXISTS (
            SELECT 1
            FROM crm.internal_conversation_members AS m
            WHERE m.conversation_id = c.id
              AND m.user_id = public.current_crm_user_id()
              AND m.is_active IS TRUE
              AND m.is_admin IS TRUE
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION crm.internal_current_user_is_active() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.internal_is_conversation_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.internal_can_manage_conversation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.internal_current_user_is_active() TO authenticated;
GRANT EXECUTE ON FUNCTION crm.internal_is_conversation_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.internal_can_manage_conversation(uuid) TO authenticated;

ALTER TABLE crm.internal_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.internal_conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.internal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.internal_message_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.internal_message_attachment_upload_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.internal_message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY internal_conversations_select ON crm.internal_conversations
FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.internal_current_user_is_active()
  AND (crm.internal_is_conversation_member(id) OR crm.current_user_is_account_admin())
);

CREATE POLICY internal_conversations_insert ON crm.internal_conversations
FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND created_by = public.current_crm_user_id()
  AND crm.internal_current_user_is_active()
);

CREATE POLICY internal_conversations_update ON crm.internal_conversations
FOR UPDATE TO authenticated
USING (crm.internal_can_manage_conversation(id))
WITH CHECK (aces_id = public.current_aces_id() AND crm.internal_can_manage_conversation(id));

CREATE POLICY internal_members_select ON crm.internal_conversation_members
FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.internal_current_user_is_active()
  AND (
    user_id = public.current_crm_user_id()
    OR crm.internal_is_conversation_member(conversation_id)
    OR crm.current_user_is_account_admin()
  )
);

CREATE POLICY internal_members_insert ON crm.internal_conversation_members
FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.internal_can_manage_conversation(conversation_id)
);

CREATE POLICY internal_members_update ON crm.internal_conversation_members
FOR UPDATE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND (
    (user_id = public.current_crm_user_id() AND crm.internal_is_conversation_member(conversation_id))
    OR crm.internal_can_manage_conversation(conversation_id)
  )
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND (
    user_id = public.current_crm_user_id()
    OR crm.internal_can_manage_conversation(conversation_id)
  )
);

CREATE POLICY internal_messages_select ON crm.internal_messages
FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.internal_current_user_is_active()
  AND crm.internal_is_conversation_member(conversation_id)
);

CREATE POLICY internal_messages_insert ON crm.internal_messages
FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND author_id = public.current_crm_user_id()
  AND crm.internal_current_user_is_active()
  AND crm.internal_is_conversation_member(conversation_id)
);

CREATE POLICY internal_mentions_select ON crm.internal_message_mentions
FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.internal_is_conversation_member(conversation_id)
);

CREATE POLICY internal_mentions_insert ON crm.internal_message_mentions
FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND crm.internal_is_conversation_member(conversation_id)
  AND EXISTS (
    SELECT 1 FROM crm.internal_messages AS m
    WHERE m.id = message_id
      AND m.author_id = public.current_crm_user_id()
      AND m.conversation_id = conversation_id
  )
);

CREATE POLICY internal_attachment_intents_select ON crm.internal_message_attachment_upload_intents
FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND created_by = public.current_crm_user_id()
  AND crm.internal_is_conversation_member(conversation_id)
);

CREATE POLICY internal_attachment_intents_update ON crm.internal_message_attachment_upload_intents
FOR UPDATE TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND created_by = public.current_crm_user_id()
  AND crm.internal_is_conversation_member(conversation_id)
)
WITH CHECK (
  aces_id = public.current_aces_id()
  AND created_by = public.current_crm_user_id()
  AND crm.internal_is_conversation_member(conversation_id)
);

CREATE POLICY internal_attachments_select ON crm.internal_message_attachments
FOR SELECT TO authenticated
USING (
  aces_id = public.current_aces_id()
  AND crm.internal_is_conversation_member(conversation_id)
);

CREATE POLICY internal_attachments_insert ON crm.internal_message_attachments
FOR INSERT TO authenticated
WITH CHECK (
  aces_id = public.current_aces_id()
  AND uploaded_by = public.current_crm_user_id()
  AND crm.internal_is_conversation_member(conversation_id)
  AND EXISTS (
    SELECT 1 FROM crm.internal_messages AS m
    WHERE m.id = message_id
      AND m.author_id = public.current_crm_user_id()
      AND m.conversation_id = conversation_id
  )
);

CREATE OR REPLACE FUNCTION crm.validate_internal_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = crm, public
AS $$
DECLARE
  v_conversation crm.internal_conversations%ROWTYPE;
  v_user crm.users%ROWTYPE;
  v_active_count integer;
BEGIN
  SELECT * INTO v_conversation FROM crm.internal_conversations WHERE id = NEW.conversation_id;
  SELECT * INTO v_user FROM crm.users WHERE id = NEW.user_id;

  IF v_conversation.id IS NULL OR v_user.id IS NULL THEN
    RAISE EXCEPTION 'Conversa ou usuario invalido';
  END IF;
  IF v_conversation.aces_id <> NEW.aces_id OR v_user.aces_id <> NEW.aces_id THEN
    RAISE EXCEPTION 'Participante fora da conta';
  END IF;
  IF v_user.role::text NOT IN ('ADMIN', 'VENDEDOR') THEN
    RAISE EXCEPTION 'Usuario inativo no Chat interno';
  END IF;
  IF TG_OP = 'UPDATE' AND v_conversation.kind = 'direct'
     AND (NEW.is_active, NEW.is_admin, NEW.user_id, NEW.conversation_id, NEW.aces_id)
         IS DISTINCT FROM
         (OLD.is_active, OLD.is_admin, OLD.user_id, OLD.conversation_id, OLD.aces_id) THEN
    RAISE EXCEPTION 'Participantes de conversa direta nao podem ser alterados';
  END IF;
  IF NEW.is_active AND v_conversation.kind = 'direct' THEN
    SELECT count(*) INTO v_active_count
    FROM crm.internal_conversation_members
    WHERE conversation_id = NEW.conversation_id
      AND is_active IS TRUE
      AND user_id <> NEW.user_id;
    IF v_active_count >= 2 THEN
      RAISE EXCEPTION 'Conversa direta aceita somente dois participantes';
    END IF;
  END IF;
  IF NEW.is_active THEN
    NEW.removed_at := NULL;
  ELSIF NEW.removed_at IS NULL THEN
    NEW.removed_at := now();
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_internal_member_before_write
BEFORE INSERT OR UPDATE ON crm.internal_conversation_members
FOR EACH ROW EXECUTE FUNCTION crm.validate_internal_member();

CREATE OR REPLACE FUNCTION crm.protect_internal_last_admin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_other_admins integer;
BEGIN
  IF OLD.is_active IS TRUE AND OLD.is_admin IS TRUE
     AND (TG_OP = 'DELETE' OR NEW.is_active IS FALSE OR NEW.is_admin IS FALSE) THEN
    PERFORM 1
    FROM crm.internal_conversations AS c
    WHERE c.id = OLD.conversation_id
    FOR UPDATE;
    SELECT count(*) INTO v_other_admins
    FROM crm.internal_conversation_members AS m
    WHERE m.conversation_id = OLD.conversation_id
      AND m.user_id <> OLD.user_id
      AND m.is_active IS TRUE
      AND m.is_admin IS TRUE;
    IF v_other_admins = 0 THEN
      RAISE EXCEPTION 'A conversa precisa manter pelo menos um administrador';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER protect_internal_last_admin_before_write
BEFORE UPDATE OR DELETE ON crm.internal_conversation_members
FOR EACH ROW EXECUTE FUNCTION crm.protect_internal_last_admin();

CREATE OR REPLACE FUNCTION crm.validate_internal_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = crm, public
AS $$
DECLARE
  v_aces_id integer;
BEGIN
  SELECT aces_id INTO v_aces_id FROM crm.internal_conversations WHERE id = NEW.conversation_id;
  IF v_aces_id IS NULL OR v_aces_id <> NEW.aces_id THEN
    RAISE EXCEPTION 'Conversa invalida';
  END IF;
  IF NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.internal_messages AS reply
    WHERE reply.id = NEW.reply_to_message_id
      AND reply.conversation_id = NEW.conversation_id
  ) THEN
    RAISE EXCEPTION 'A resposta deve apontar para a mesma conversa';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_internal_message_before_write
BEFORE INSERT OR UPDATE ON crm.internal_messages
FOR EACH ROW EXECUTE FUNCTION crm.validate_internal_message();

CREATE OR REPLACE FUNCTION crm.touch_internal_conversation_from_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE crm.internal_conversations
  SET last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at),
      updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_internal_conversation_after_message
AFTER INSERT ON crm.internal_messages
FOR EACH ROW EXECUTE FUNCTION crm.touch_internal_conversation_from_message();

CREATE OR REPLACE FUNCTION crm.validate_internal_mention()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = crm, public
AS $$
DECLARE
  v_message crm.internal_messages%ROWTYPE;
  v_expected_token text;
BEGIN
  SELECT * INTO v_message FROM crm.internal_messages WHERE id = NEW.message_id;
  IF v_message.id IS NULL
     OR v_message.conversation_id <> NEW.conversation_id
     OR v_message.aces_id <> NEW.aces_id THEN
    RAISE EXCEPTION 'Mensagem da mencao invalida';
  END IF;

  IF NEW.mention_type = 'user' THEN
    IF NOT EXISTS (
      SELECT 1 FROM crm.internal_conversation_members AS m
      WHERE m.conversation_id = NEW.conversation_id
        AND m.user_id = NEW.mentioned_user_id
        AND m.is_active IS TRUE
    ) THEN
      RAISE EXCEPTION 'Usuario mencionado nao participa da conversa';
    END IF;
    v_expected_token := '@[user:' || NEW.mentioned_user_id::text || ']';
  ELSIF NEW.mention_type = 'lead' THEN
    IF NOT crm.current_user_can_access_lead(NEW.lead_id) THEN
      RAISE EXCEPTION 'Lead mencionado indisponivel';
    END IF;
    v_expected_token := '#[lead:' || NEW.lead_id::text || ']';
  ELSE
    v_expected_token := '@[all]';
  END IF;

  IF NEW.token_length <> char_length(v_expected_token)
     OR substring(v_message.content FROM NEW.token_start + 1 FOR NEW.token_length) <> v_expected_token THEN
    RAISE EXCEPTION 'Token de mencao invalido';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_internal_mention_before_insert
BEFORE INSERT ON crm.internal_message_mentions
FOR EACH ROW EXECUTE FUNCTION crm.validate_internal_mention();

CREATE OR REPLACE FUNCTION crm.rpc_create_internal_conversation(
  p_kind text,
  p_name text DEFAULT NULL,
  p_member_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_conversation_id uuid;
  v_current_user_id uuid := public.current_crm_user_id();
  v_aces_id integer := public.current_aces_id();
  v_member_ids uuid[];
  v_direct_key text;
  v_invalid_count integer;
BEGIN
  IF NOT crm.internal_current_user_is_active() THEN
    RAISE EXCEPTION 'Usuario sem acesso ao Chat interno';
  END IF;
  IF p_kind NOT IN ('direct', 'group') THEN
    RAISE EXCEPTION 'Tipo de conversa invalido';
  END IF;

  SELECT array_agg(member_id ORDER BY member_id)
  INTO v_member_ids
  FROM (
    SELECT DISTINCT member_id
    FROM unnest(array_append(COALESCE(p_member_ids, ARRAY[]::uuid[]), v_current_user_id)) AS member_id
  ) AS unique_members;

  SELECT count(*) INTO v_invalid_count
  FROM unnest(v_member_ids) AS member_id
  LEFT JOIN crm.users AS u ON u.id = member_id
  WHERE u.id IS NULL OR u.aces_id <> v_aces_id OR u.role::text NOT IN ('ADMIN', 'VENDEDOR');
  IF v_invalid_count > 0 THEN
    RAISE EXCEPTION 'Participante invalido para esta conta';
  END IF;

  IF p_kind = 'direct' THEN
    IF cardinality(v_member_ids) <> 2 THEN
      RAISE EXCEPTION 'Conversa direta exige exatamente dois participantes';
    END IF;
    v_direct_key := v_aces_id::text || ':' || array_to_string(v_member_ids, ':');
    SELECT id INTO v_conversation_id
    FROM crm.internal_conversations
    WHERE direct_key = v_direct_key;
    IF v_conversation_id IS NOT NULL THEN
      UPDATE crm.internal_conversations SET archived_at = NULL, updated_at = now()
      WHERE id = v_conversation_id AND archived_at IS NOT NULL;
      RETURN v_conversation_id;
    END IF;
  ELSE
    IF btrim(COALESCE(p_name, '')) = '' THEN
      RAISE EXCEPTION 'Informe o nome do grupo';
    END IF;
    IF cardinality(v_member_ids) < 2 THEN
      RAISE EXCEPTION 'Grupo exige pelo menos dois participantes';
    END IF;
  END IF;

  v_conversation_id := gen_random_uuid();
  INSERT INTO crm.internal_conversations(id, aces_id, kind, name, created_by, direct_key)
  VALUES (
    v_conversation_id, v_aces_id, p_kind,
    CASE WHEN p_kind = 'group' THEN btrim(p_name) ELSE NULL END,
    v_current_user_id, v_direct_key
  );

  INSERT INTO crm.internal_conversation_members(conversation_id, user_id, aces_id, is_admin)
  VALUES (v_conversation_id, v_current_user_id, v_aces_id, TRUE);

  INSERT INTO crm.internal_conversation_members(conversation_id, user_id, aces_id, is_admin)
  SELECT v_conversation_id, member_id, v_aces_id, FALSE
  FROM unnest(v_member_ids) AS member_id
  WHERE member_id <> v_current_user_id;

  RETURN v_conversation_id;
EXCEPTION
  WHEN unique_violation THEN
    IF v_direct_key IS NOT NULL THEN
      SELECT id INTO v_conversation_id FROM crm.internal_conversations WHERE direct_key = v_direct_key;
      IF v_conversation_id IS NOT NULL THEN RETURN v_conversation_id; END IF;
    END IF;
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_send_internal_message(
  p_conversation_id uuid,
  p_content text,
  p_reply_to_message_id uuid,
  p_client_message_id uuid,
  p_mentions jsonb DEFAULT '[]'::jsonb,
  p_attachment_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message_id uuid;
  v_current_user_id uuid := public.current_crm_user_id();
  v_aces_id integer := public.current_aces_id();
  v_mention jsonb;
  v_intent crm.internal_message_attachment_upload_intents%ROWTYPE;
BEGIN
  IF NOT crm.internal_current_user_is_active() OR NOT crm.internal_is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Conversa indisponivel';
  END IF;
  SELECT id INTO v_message_id
  FROM crm.internal_messages
  WHERE conversation_id = p_conversation_id
    AND author_id = v_current_user_id
    AND client_message_id = p_client_message_id;
  IF v_message_id IS NOT NULL THEN
    RETURN v_message_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM crm.internal_conversations AS c
    WHERE c.id = p_conversation_id
      AND c.archived_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Restaure a conversa antes de enviar mensagens';
  END IF;

  IF char_length(COALESCE(p_content, '')) > 10000 THEN
    RAISE EXCEPTION 'Mensagem acima do limite de caracteres';
  END IF;
  IF p_reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM crm.internal_messages WHERE id = p_reply_to_message_id AND conversation_id = p_conversation_id
  ) THEN
    RAISE EXCEPTION 'A resposta deve apontar para a mesma conversa';
  END IF;

  IF p_attachment_id IS NOT NULL THEN
    SELECT * INTO v_intent
    FROM crm.internal_message_attachment_upload_intents
    WHERE attachment_id = p_attachment_id
      AND conversation_id = p_conversation_id
      AND created_by = v_current_user_id
      AND status = 'issued'
      AND intent_expires_at > now();
    IF v_intent.id IS NULL THEN
      RAISE EXCEPTION 'Upload interno invalido ou expirado';
    END IF;
  END IF;
  IF btrim(COALESCE(p_content, '')) = '' AND p_attachment_id IS NULL THEN
    RAISE EXCEPTION 'Digite uma mensagem ou anexe um arquivo';
  END IF;

  INSERT INTO crm.internal_messages(
    id, conversation_id, aces_id, author_id, content, reply_to_message_id, client_message_id
  ) VALUES (
    COALESCE(CASE WHEN v_intent.id IS NOT NULL THEN v_intent.message_id ELSE NULL END, gen_random_uuid()),
    p_conversation_id, v_aces_id, v_current_user_id, COALESCE(p_content, ''),
    p_reply_to_message_id, p_client_message_id
  )
  ON CONFLICT (conversation_id, author_id, client_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  IF v_message_id IS NULL THEN
    SELECT id INTO v_message_id FROM crm.internal_messages
    WHERE conversation_id = p_conversation_id
      AND author_id = v_current_user_id
      AND client_message_id = p_client_message_id;
    RETURN v_message_id;
  END IF;

  IF jsonb_typeof(COALESCE(p_mentions, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Mencoes invalidas';
  END IF;
  IF jsonb_array_length(COALESCE(p_mentions, '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'Limite de mencoes excedido';
  END IF;
  FOR v_mention IN SELECT value FROM jsonb_array_elements(COALESCE(p_mentions, '[]'::jsonb)) LOOP
    INSERT INTO crm.internal_message_mentions(
      message_id, conversation_id, aces_id, mention_type, mentioned_user_id, lead_id, token_start, token_length
    ) VALUES (
      v_message_id,
      p_conversation_id,
      v_aces_id,
      v_mention->>'type',
      CASE WHEN v_mention->>'type' = 'user' THEN (v_mention->>'userId')::uuid ELSE NULL END,
      CASE WHEN v_mention->>'type' = 'lead' THEN (v_mention->>'leadId')::uuid ELSE NULL END,
      (v_mention->>'start')::integer,
      (v_mention->>'length')::integer
    );
  END LOOP;

  IF v_intent.id IS NOT NULL THEN
    INSERT INTO crm.internal_message_attachments(
      id, message_id, conversation_id, aces_id, uploaded_by, kind, mime_type,
      storage_bucket, storage_path, file_name, file_size
    ) VALUES (
      v_intent.attachment_id, v_message_id, p_conversation_id, v_aces_id, v_current_user_id,
      v_intent.kind, v_intent.mime_type, v_intent.storage_bucket, v_intent.storage_path,
      v_intent.file_name, v_intent.file_size
    );
    UPDATE crm.internal_message_attachment_upload_intents
    SET status = 'consumed', updated_at = now()
    WHERE id = v_intent.id;
  END IF;

  UPDATE crm.internal_conversation_members
  SET last_read_at = now(), updated_at = now()
  WHERE conversation_id = p_conversation_id AND user_id = v_current_user_id;
  RETURN v_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_get_internal_unread_counts()
RETURNS TABLE(conversation_id uuid, unread_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = crm, public
AS $$
  WITH request_context AS MATERIALIZED (
    SELECT public.current_crm_user_id() AS user_id, public.current_aces_id() AS aces_id
  )
  SELECT m.conversation_id, count(*)::bigint
  FROM request_context AS context
  JOIN crm.internal_conversation_members AS member
    ON member.user_id = context.user_id
   AND member.aces_id = context.aces_id
   AND member.is_active IS TRUE
  JOIN crm.internal_messages AS m
    ON m.conversation_id = member.conversation_id
   AND m.aces_id = context.aces_id
   AND m.created_at > member.last_read_at
   AND m.author_id <> context.user_id
   AND m.deleted_at IS NULL
  GROUP BY m.conversation_id;
$$;

CREATE OR REPLACE FUNCTION crm.rpc_mark_internal_conversation_read(p_conversation_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = crm, public
AS $$
BEGIN
  IF NOT crm.internal_is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Conversa indisponivel';
  END IF;
  UPDATE crm.internal_conversation_members
  SET last_read_at = now(), updated_at = now()
  WHERE conversation_id = p_conversation_id
    AND user_id = public.current_crm_user_id()
    AND is_active IS TRUE;
END;
$$;

REVOKE ALL ON crm.internal_conversations FROM PUBLIC, anon;
REVOKE ALL ON crm.internal_conversation_members FROM PUBLIC, anon;
REVOKE ALL ON crm.internal_messages FROM PUBLIC, anon;
REVOKE ALL ON crm.internal_message_mentions FROM PUBLIC, anon;
REVOKE ALL ON crm.internal_message_attachment_upload_intents FROM PUBLIC, anon;
REVOKE ALL ON crm.internal_message_attachments FROM PUBLIC, anon;

GRANT SELECT, UPDATE ON crm.internal_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE ON crm.internal_conversation_members TO authenticated;
GRANT SELECT ON crm.internal_messages TO authenticated;
GRANT SELECT ON crm.internal_message_mentions TO authenticated;
GRANT SELECT ON crm.internal_message_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.internal_conversations TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.internal_conversation_members TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.internal_messages TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.internal_message_mentions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.internal_message_attachment_upload_intents TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.internal_message_attachments TO service_role;

REVOKE ALL ON FUNCTION crm.rpc_create_internal_conversation(text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.rpc_send_internal_message(uuid, text, uuid, uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.rpc_get_internal_unread_counts() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION crm.rpc_mark_internal_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION crm.rpc_create_internal_conversation(text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_send_internal_message(uuid, text, uuid, uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_get_internal_unread_counts() TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_mark_internal_conversation_read(uuid) TO authenticated;

REVOKE ALL ON FUNCTION crm.validate_internal_member() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.protect_internal_last_admin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.validate_internal_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.touch_internal_conversation_from_message() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION crm.validate_internal_mention() FROM PUBLIC, anon, authenticated;

ALTER TABLE crm.internal_conversations REPLICA IDENTITY FULL;
ALTER TABLE crm.internal_conversation_members REPLICA IDENTITY FULL;
ALTER TABLE crm.internal_messages REPLICA IDENTITY FULL;
ALTER TABLE crm.internal_message_mentions REPLICA IDENTITY FULL;
ALTER TABLE crm.internal_message_attachments REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm.internal_conversations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm.internal_conversation_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm.internal_messages;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm.internal_message_mentions;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE crm.internal_message_attachments;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
