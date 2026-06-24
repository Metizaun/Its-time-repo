DO $$
DECLARE
  v_missing text[];
  v_template_tools integer;
BEGIN
  SELECT array_agg(name ORDER BY name)
  INTO v_missing
  FROM unnest(ARRAY[
    'agents.ai_agents',
    'agents.ai_stage_rules',
    'agents.ai_lead_state',
    'agents.ai_runs',
    'agents.agent_templates',
    'agents.agent_tools',
    'agents.agent_tool_runs',
    'agents.forwarding_destinations',
    'agents.tool_media_assets',
    'bi.lead_profiles',
    'bi.lead_facts',
    'bi.tool_events',
    'crm.bi_outbox'
  ]) AS expected(name)
  WHERE to_regclass(name) IS NULL;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Objetos ausentes apos migration: %', v_missing;
  END IF;

  IF to_regclass('crm.ai_agents') IS NOT NULL
     OR to_regclass('crm.ai_stage_rules') IS NOT NULL
     OR to_regclass('crm.ai_lead_state') IS NOT NULL
     OR to_regclass('crm.ai_runs') IS NOT NULL THEN
    RAISE EXCEPTION 'Ainda existem tabelas runtime crm.ai_* apos o corte';
  END IF;

  IF has_schema_privilege('authenticated', 'agents', 'USAGE')
     OR has_schema_privilege('authenticated', 'bi', 'USAGE') THEN
    RAISE EXCEPTION 'authenticated nao pode acessar diretamente agents/bi';
  END IF;

  IF NOT has_schema_privilege('service_role', 'agents', 'USAGE')
     OR NOT has_schema_privilege('service_role', 'bi', 'USAGE') THEN
    RAISE EXCEPTION 'service_role sem acesso aos schemas agents/bi';
  END IF;

  SELECT count(*)
  INTO v_template_tools
  FROM agents.agent_template_tools
  WHERE template_key = 'optics-consultant'
    AND template_version = 1;

  IF v_template_tools <> 5 THEN
    RAISE EXCEPTION 'Template optics-consultant deveria ter 5 Tools; encontrado %', v_template_tools;
  END IF;

  IF to_regprocedure('agents.create_agent_from_template(integer,uuid,text,text,text,text,numeric,text,boolean)') IS NULL
     OR to_regprocedure('agents.configure_agent_audio(uuid,text,numeric,boolean)') IS NULL
     OR to_regprocedure('crm.rpc_project_bi_outbox_batch(integer)') IS NULL THEN
    RAISE EXCEPTION 'RPCs operacionais ausentes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname IN ('agents', 'bi')
      AND c.relkind IN ('r', 'p')
      AND c.relrowsecurity IS FALSE
      AND c.relname <> '_schema_rollback_artifacts'
  ) THEN
    RAISE EXCEPTION 'Existe tabela agents/bi sem RLS';
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM agents.tool_definitions WHERE is_active) AS active_tool_definitions,
  (SELECT count(*) FROM agents.agent_template_tools WHERE template_key = 'optics-consultant') AS optics_tools,
  (SELECT count(*) FROM agents.ai_agents) AS agents_preserved,
  (SELECT count(*) FROM agents.ai_lead_state) AS lead_states_preserved,
  (SELECT count(*) FROM agents.ai_runs) AS runs_preserved;
