DO $$
DECLARE
  v_function_sql text;
  v_updated_sql text;
BEGIN
  SELECT pg_get_functiondef('crm.rpc_dashboard_operational_metrics(text,timestamptz,timestamptz,text)'::regprocedure)
  INTO v_function_sql;

  IF position('179 days' IN v_function_sql) = 0 THEN
    RAISE EXCEPTION 'Expected dashboard heatmap window of 179 days was not found.';
  END IF;

  v_updated_sql := replace(v_function_sql, '179 days', '89 days');

  EXECUTE v_updated_sql;
END;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_dashboard_operational_metrics(text, timestamptz, timestamptz, text) TO authenticated;
