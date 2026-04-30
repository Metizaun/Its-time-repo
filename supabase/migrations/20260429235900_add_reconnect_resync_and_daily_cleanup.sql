CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION crm.cleanup_old_automation_executions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM crm.automation_executions
  WHERE status IN ('cancelled', 'failed')
    AND COALESCE(cancelled_at, updated_at, created_at) < now() - interval '72 hours';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$;

COMMENT ON FUNCTION crm.cleanup_old_automation_executions() IS
  'Remove apenas execucoes failed/cancelled com mais de 72 horas. Nunca toca crm.message_history.';

GRANT EXECUTE ON FUNCTION crm.cleanup_old_automation_executions() TO service_role;
REVOKE ALL ON FUNCTION crm.cleanup_old_automation_executions() FROM authenticated;
REVOKE ALL ON FUNCTION crm.cleanup_old_automation_executions() FROM anon;
REVOKE ALL ON FUNCTION crm.cleanup_old_automation_executions() FROM PUBLIC;

DO $$
BEGIN
  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'crm_cleanup_old_automation_executions_daily_brt_2359';
EXCEPTION
  WHEN undefined_table OR invalid_schema_name THEN
    NULL;
END;
$$;

-- Supabase Cron uses UTC in practice for the schedule expression, so 02:59 UTC
-- maps to 23:59 in America/Sao_Paulo (UTC-3).
SELECT cron.schedule(
  'crm_cleanup_old_automation_executions_daily_brt_2359',
  '59 2 * * *',
  $$SELECT crm.cleanup_old_automation_executions();$$
);
