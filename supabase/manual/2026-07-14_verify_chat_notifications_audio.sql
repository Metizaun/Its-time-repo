-- Execute after 20260714172130_chat_realtime_notifications_audio.sql.
-- Read-only assertions: this script raises on an unsafe or incomplete rollout.
DO $$
DECLARE
  v_table text;
  v_missing_publication text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'chat_read_states', 'notifications', 'notification_reads'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'crm' AND c.relname = v_table AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS ausente em crm.%', v_table;
    END IF;

    IF has_table_privilege('anon', format('crm.%I', v_table), 'SELECT') THEN
      RAISE EXCEPTION 'anon nao pode consultar crm.%', v_table;
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'message_history', 'leads', 'pipelines', 'pipeline_stages',
    'chat_read_states', 'notifications', 'notification_reads'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'crm' AND tablename = v_table
    ) THEN
      v_missing_publication := array_append(v_missing_publication, v_table);
    END IF;
  END LOOP;

  IF cardinality(v_missing_publication) > 0 THEN
    RAISE EXCEPTION 'Tabelas ausentes no realtime: %', array_to_string(v_missing_publication, ', ');
  END IF;

  IF EXISTS (
    SELECT 1 FROM agents.agent_tools
    WHERE tool_key = 'ai_audio'
      AND COALESCE((config->>'selectionRate')::numeric, 0) <> 0.018
  ) THEN
    RAISE EXCEPTION 'Audio IA deve manter frequencia fixa em 1,8%%';
  END IF;

  IF EXISTS (
    SELECT 1 FROM agents.ai_agents a
    WHERE NOT EXISTS (
      SELECT 1 FROM agents.agent_tools t
      WHERE t.agent_id = a.id AND t.tool_key = 'ai_audio'
    )
  ) THEN
    RAISE EXCEPTION 'Existem agentes sem Audio IA instalado';
  END IF;
END;
$$;
