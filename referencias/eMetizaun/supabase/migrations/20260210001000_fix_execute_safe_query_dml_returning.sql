-- Fix execute_safe_query for INSERT/UPDATE ... RETURNING execution.
-- Data-modifying statements cannot be used directly as a derived table in FROM (%s).
-- Use a CTE wrapper for write operations.
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
  allowed_tables TEXT[] := ARRAY[
    'leads',
    'deals',
    'tasks',
    'notes',
    'companies',
    'contacts',
    'lead_lists',
    'partners'
  ];
BEGIN
  IF query_text IS NULL OR btrim(query_text) = '' THEN
    RAISE EXCEPTION 'query_text_required';
  END IF;

  -- Disallow multi-statement queries.
  IF position(';' IN query_text) > 0 THEN
    RAISE EXCEPTION 'multi_statement_not_allowed';
  END IF;

  normalized := regexp_replace(query_text, '[[:space:]]+', ' ', 'g');
  upper_query := upper(trim(normalized));

  -- Block destructive or unsafe operations.
  IF upper_query ~ '\m(DROP|TRUNCATE|ALTER|GRANT|REVOKE|DELETE|EXEC|EXECUTE)\M' THEN
    RAISE EXCEPTION 'forbidden_operation';
  END IF;

  IF upper_query ~ '^[[:space:]]*WITH\M' THEN
    IF upper_query ~ '\mINSERT\M' THEN
      op := 'insert';
    ELSIF upper_query ~ '\mUPDATE\M' THEN
      op := 'update';
    ELSE
      op := 'select';
    END IF;
  ELSIF upper_query ~ '^[[:space:]]*SELECT\M' THEN
    op := 'select';
  ELSIF upper_query ~ '^[[:space:]]*INSERT\M' THEN
    op := 'insert';
  ELSIF upper_query ~ '^[[:space:]]*UPDATE\M' THEN
    op := 'update';
  ELSE
    RAISE EXCEPTION 'operation_not_allowed';
  END IF;

  -- Validate write targets.
  IF op IN ('insert','update') THEN
    table_name := NULL;

    -- Match schema-qualified insert/update.
    SELECT lower(
      (
        regexp_matches(
          upper_query,
          '\m(INSERT[[:space:]]+INTO|UPDATE)\M[[:space:]]+"?([A-Z0-9_]+)"?\."?([A-Z0-9_]+)"?',
          'i'
        )
      )[3]
    )
      INTO table_name;

    IF table_name IS NULL THEN
      -- Match non-qualified insert/update.
      SELECT lower(
        (
          regexp_matches(
            upper_query,
            '\m(INSERT[[:space:]]+INTO|UPDATE)\M[[:space:]]+"?([A-Z0-9_]+)"?',
            'i'
          )
        )[2]
      )
        INTO table_name;
    END IF;

    IF table_name IS NULL OR NOT (table_name = ANY(allowed_tables)) THEN
      RAISE EXCEPTION 'write_not_allowed';
    END IF;
  END IF;

  exec_query := query_text;
  IF op IN ('insert','update') AND upper_query !~ '\mRETURNING\M' THEN
    exec_query := exec_query || ' RETURNING *';
  END IF;

  IF op IN ('insert','update') THEN
    EXECUTE format('WITH q AS (%s) SELECT jsonb_agg(q) FROM q', exec_query) INTO result;
  ELSE
    EXECUTE format('SELECT jsonb_agg(t) FROM (%s) t', exec_query) INTO result;
  END IF;

  RETURN jsonb_build_object(
    'operation', op,
    'rowCount', COALESCE(jsonb_array_length(result), 0),
    'data', COALESCE(result, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_safe_query(TEXT) TO authenticated;
