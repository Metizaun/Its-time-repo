-- NL2SQL support tables, functions, and policies

-- Ensure updated_at trigger function uses correct search_path
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Metadata cache table (per column)
CREATE TABLE IF NOT EXISTS public.database_metadata_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  schema_name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  is_nullable BOOLEAN NOT NULL DEFAULT true,
  column_default TEXT,
  cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(schema_name, table_name, column_name)
);

-- Conversations table
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Messages table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- LLM settings table
CREATE TABLE IF NOT EXISTS public.llm_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'gemini',
  model TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  temperature NUMERIC NOT NULL DEFAULT 0.2,
  max_tokens INTEGER NOT NULL DEFAULT 800,
  system_prompt TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.database_metadata_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_settings ENABLE ROW LEVEL SECURITY;

-- Policies: conversations
CREATE POLICY "Conversations are viewable by org members"
ON public.conversations
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = conversations.organization_id
  )
);

CREATE POLICY "Users can create conversations in their org"
ON public.conversations
FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = conversations.organization_id
  )
);

CREATE POLICY "Users can update their own conversations"
ON public.conversations
FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own conversations"
ON public.conversations
FOR DELETE
USING (auth.uid() = user_id);

-- Policies: messages
CREATE POLICY "Messages are viewable by org members"
ON public.messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.user_roles ur ON ur.organization_id = c.organization_id
    WHERE c.id = messages.conversation_id
      AND ur.user_id = auth.uid()
  )
);

CREATE POLICY "Users can create messages in their org"
ON public.messages
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    JOIN public.user_roles ur ON ur.organization_id = c.organization_id
    WHERE c.id = messages.conversation_id
      AND ur.user_id = auth.uid()
  )
);

CREATE POLICY "Users can delete their own messages"
ON public.messages
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.conversations c
    WHERE c.id = messages.conversation_id
      AND c.user_id = auth.uid()
  )
);

-- Policies: llm_settings
CREATE POLICY "LLM settings are viewable by org members"
ON public.llm_settings
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.organization_id = llm_settings.organization_id
  )
);

CREATE POLICY "Admins can insert LLM settings"
ON public.llm_settings
FOR INSERT
WITH CHECK (
  has_minimum_role(auth.uid(), organization_id, 'admin')
);

CREATE POLICY "Admins can update LLM settings"
ON public.llm_settings
FOR UPDATE
USING (
  has_minimum_role(auth.uid(), organization_id, 'admin')
);

-- Policies: metadata cache (read-only for authenticated)
CREATE POLICY "Metadata cache readable by authenticated"
ON public.database_metadata_cache
FOR SELECT
USING (auth.role() = 'authenticated');

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON public.messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages(created_at);
CREATE INDEX IF NOT EXISTS idx_metadata_cache_table ON public.database_metadata_cache(schema_name, table_name);

-- Triggers
DROP TRIGGER IF EXISTS update_conversations_updated_at ON public.conversations;
CREATE TRIGGER update_conversations_updated_at
BEFORE UPDATE ON public.conversations
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_llm_settings_updated_at ON public.llm_settings;
CREATE TRIGGER update_llm_settings_updated_at
BEFORE UPDATE ON public.llm_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Function: get_database_metadata
CREATE OR REPLACE FUNCTION public.get_database_metadata()
RETURNS TABLE (
  schema_name TEXT,
  table_name TEXT,
  column_name TEXT,
  data_type TEXT,
  is_nullable BOOLEAN,
  column_default TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    table_schema as schema_name,
    table_name,
    column_name,
    data_type,
    (is_nullable = 'YES') as is_nullable,
    column_default
  FROM information_schema.columns
  WHERE table_schema NOT IN (
    'pg_catalog', 'information_schema', 'auth', 'storage',
    'supabase_functions', 'extensions', 'realtime', 'vault',
    'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'cron'
  )
  ORDER BY table_schema, table_name, ordinal_position;
$$;

-- Function: execute_safe_query
CREATE OR REPLACE FUNCTION public.execute_safe_query(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  normalized TEXT;
  upper_query TEXT;
  table_name TEXT;
  op TEXT;
  exec_query TEXT;
  result JSONB;
  allowed_tables TEXT[] := ARRAY['leads','deals','tasks','notes'];
BEGIN
  IF query_text IS NULL OR btrim(query_text) = '' THEN
    RAISE EXCEPTION 'query_text_required';
  END IF;

  -- Disallow multi-statement queries
  IF position(';' in query_text) > 0 THEN
    RAISE EXCEPTION 'multi_statement_not_allowed';
  END IF;

  normalized := regexp_replace(query_text, '\s+', ' ', 'g');
  upper_query := upper(trim(normalized));

  -- Block destructive or unsafe operations
  IF upper_query ~* '\m(DROP|TRUNCATE|ALTER|GRANT|REVOKE|DELETE|EXEC|EXECUTE)\M' THEN
    RAISE EXCEPTION 'forbidden_operation';
  END IF;

  IF upper_query ~* '^\s*WITH\b' THEN
    IF upper_query ~* '\bINSERT\b' THEN
      op := 'insert';
    ELSIF upper_query ~* '\bUPDATE\b' THEN
      op := 'update';
    ELSE
      op := 'select';
    END IF;
  ELSIF upper_query ~* '^\s*SELECT\b' THEN
    op := 'select';
  ELSIF upper_query ~* '^\s*INSERT\b' THEN
    op := 'insert';
  ELSIF upper_query ~* '^\s*UPDATE\b' THEN
    op := 'update';
  ELSE
    RAISE EXCEPTION 'operation_not_allowed';
  END IF;

  -- Validate write targets
  IF op IN ('insert','update') THEN
    table_name := NULL;
    -- Match schema-qualified insert/update
    SELECT lower((regexp_matches(upper_query, '\b(INSERT\s+INTO|UPDATE)\s+"?([A-Z0-9_]+)"?\."?([A-Z0-9_]+)"?', 'i'))[3])
      INTO table_name;
    IF table_name IS NULL THEN
      -- Match non-qualified insert/update
      SELECT lower((regexp_matches(upper_query, '\b(INSERT\s+INTO|UPDATE)\s+"?([A-Z0-9_]+)"?', 'i'))[2])
        INTO table_name;
    END IF;

    IF table_name IS NULL OR NOT (table_name = ANY(allowed_tables)) THEN
      RAISE EXCEPTION 'write_not_allowed';
    END IF;
  END IF;

  exec_query := query_text;
  IF op IN ('insert','update') AND upper_query !~* '\bRETURNING\b' THEN
    exec_query := exec_query || ' RETURNING *';
  END IF;

  EXECUTE format('SELECT jsonb_agg(t) FROM (%s) t', exec_query) INTO result;

  RETURN jsonb_build_object(
    'operation', op,
    'rowCount', COALESCE(jsonb_array_length(result), 0),
    'data', COALESCE(result, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_safe_query(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_database_metadata() TO authenticated;
