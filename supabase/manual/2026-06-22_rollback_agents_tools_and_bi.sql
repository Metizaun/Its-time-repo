-- Rollback destrutivo das tabelas novas. Execute apenas durante a janela curta,
-- antes de permitir trafego no backend novo, ou apos aceitar a perda dos eventos V1.
BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '10min';
SET LOCAL idle_in_transaction_session_timeout = '2min';

DO $$
BEGIN
  IF to_regclass('agents.ai_agents') IS NULL THEN
    RAISE EXCEPTION 'agents.ai_agents nao existe; rollback recusado';
  END IF;
  IF to_regclass('crm.ai_agents') IS NOT NULL THEN
    RAISE EXCEPTION 'crm.ai_agents ja existe; estado misto recusado';
  END IF;
END;
$$;

CREATE TEMP TABLE rollback_function_ddl (ddl text NOT NULL) ON COMMIT DROP;
INSERT INTO rollback_function_ddl (ddl)
SELECT ddl
FROM agents._schema_rollback_artifacts
ORDER BY artifact_key;

DROP FUNCTION IF EXISTS agents.configure_agent_audio(uuid, text, numeric, boolean);
DROP FUNCTION IF EXISTS agents.create_agent_from_template(integer, uuid, text, text, text, text, numeric, text, boolean);
DROP FUNCTION IF EXISTS crm.rpc_project_bi_outbox_batch(integer);

DROP TABLE IF EXISTS agents.agent_transfer_sessions CASCADE;
DROP TABLE IF EXISTS agents.tool_media_assets CASCADE;
DROP TABLE IF EXISTS agents.forwarding_destinations CASCADE;
DROP TABLE IF EXISTS agents.agent_tool_runs CASCADE;
DROP TABLE IF EXISTS agents.agent_tools CASCADE;
DROP TABLE IF EXISTS agents.agent_template_tools CASCADE;
DROP TABLE IF EXISTS agents.agent_templates CASCADE;
DROP TABLE IF EXISTS agents.tool_definitions CASCADE;

DROP TABLE IF EXISTS crm.lead_tool_answers CASCADE;
DROP TABLE IF EXISTS crm.lead_instance_memberships CASCADE;
DROP TABLE IF EXISTS crm.bi_outbox CASCADE;
DROP SCHEMA IF EXISTS bi CASCADE;

ALTER TABLE agents.ai_agents SET SCHEMA crm;
ALTER TABLE agents.ai_stage_rules SET SCHEMA crm;
ALTER TABLE agents.ai_lead_state SET SCHEMA crm;
ALTER TABLE agents.ai_runs SET SCHEMA crm;

ALTER TABLE crm.ai_agents
  DROP COLUMN IF EXISTS template_key,
  DROP COLUMN IF EXISTS template_version;
ALTER TABLE crm.message_history DROP COLUMN IF EXISTS sender_agent_id;

DO $$
DECLARE
  v_ddl text;
BEGIN
  FOR v_ddl IN SELECT ddl FROM rollback_function_ddl LOOP
    EXECUTE v_ddl;
  END LOOP;
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_agents TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_stage_rules TO authenticated, service_role;
GRANT SELECT ON crm.ai_lead_state, crm.ai_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm.ai_lead_state, crm.ai_runs TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_repair_automation_ai_freezes(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION crm.rpc_claim_due_agent_followups(integer) TO service_role;

DROP TABLE agents._schema_rollback_artifacts;
DROP SCHEMA agents;

DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20260622215036';

ALTER ROLE authenticator SET pgrst.db_schemas = 'public,storage,graphql_public,crm,meta,calendar';
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';

COMMIT;
