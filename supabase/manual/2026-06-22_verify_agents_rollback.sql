DO $$
BEGIN
  IF to_regclass('crm.ai_agents') IS NULL
     OR to_regclass('crm.ai_stage_rules') IS NULL
     OR to_regclass('crm.ai_lead_state') IS NULL
     OR to_regclass('crm.ai_runs') IS NULL THEN
    RAISE EXCEPTION 'Tabelas crm.ai_* nao foram restauradas';
  END IF;
  IF to_regnamespace('agents') IS NOT NULL OR to_regnamespace('bi') IS NOT NULL THEN
    RAISE EXCEPTION 'Schemas agents/bi permaneceram apos rollback';
  END IF;
  IF to_regprocedure('crm.rpc_repair_automation_ai_freezes(uuid,text)') IS NULL
     OR to_regprocedure('crm.rpc_claim_due_agent_followups(integer)') IS NULL THEN
    RAISE EXCEPTION 'Funcoes anteriores nao foram restauradas';
  END IF;
END;
$$;

SELECT
  (SELECT count(*) FROM crm.ai_agents) AS agents_restored,
  (SELECT count(*) FROM crm.ai_lead_state) AS lead_states_restored,
  (SELECT count(*) FROM crm.ai_runs) AS runs_restored;
