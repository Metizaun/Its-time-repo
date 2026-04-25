WITH single_instance_accounts AS (
  SELECT
    aces_id,
    min(instancia) AS instance_name,
    count(*) AS instance_count
  FROM crm.instance
  WHERE aces_id IS NOT NULL
    AND COALESCE(setup_status, '') <> 'cancelled'
  GROUP BY aces_id
  HAVING count(*) = 1
)
UPDATE crm.leads l
SET
  instancia = sia.instance_name,
  updated_at = now()
FROM single_instance_accounts sia
WHERE l.aces_id = sia.aces_id
  AND COALESCE(btrim(l.instancia::text), '') = '';

CREATE OR REPLACE FUNCTION crm.rpc_get_lead_instance_diagnostics(p_limit integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, crm
AS $function$
DECLARE
  v_aces_id integer := public.current_aces_id();
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
  v_result jsonb;
BEGIN
  IF current_setting('request.jwt.claim.role', TRUE) IS DISTINCT FROM 'service_role'
    AND public.current_crm_role() IS DISTINCT FROM 'ADMIN'::crm.user_role THEN
    RAISE EXCEPTION 'Apenas ADMIN pode consultar diagnostico de instancias dos leads';
  END IF;

  IF v_aces_id IS NULL THEN
    RAISE EXCEPTION 'Conta CRM nao encontrada';
  END IF;

  WITH lead_scope AS (
    SELECT
      l.id,
      l.name,
      l.contact_phone,
      l.instancia,
      l.created_at,
      i.instancia AS valid_instance
    FROM crm.leads l
    LEFT JOIN crm.instance i
      ON i.instancia = l.instancia
     AND i.aces_id = l.aces_id
     AND COALESCE(i.setup_status, '') <> 'cancelled'
    WHERE l.aces_id = v_aces_id
      AND COALESCE(l.view, TRUE) = TRUE
  ),
  counts AS (
    SELECT
      count(*)::integer AS total_leads,
      count(*) FILTER (
        WHERE COALESCE(btrim(instancia::text), '') <> ''
          AND valid_instance IS NOT NULL
      )::integer AS communicable_count,
      count(*) FILTER (
        WHERE COALESCE(btrim(instancia::text), '') = ''
      )::integer AS missing_instance_count,
      count(*) FILTER (
        WHERE COALESCE(btrim(instancia::text), '') <> ''
          AND valid_instance IS NULL
      )::integer AS invalid_instance_count
    FROM lead_scope
  ),
  instances AS (
    SELECT count(*)::integer AS value
    FROM crm.instance
    WHERE aces_id = v_aces_id
      AND COALESCE(setup_status, '') <> 'cancelled'
  ),
  missing_sample AS (
    SELECT
      id,
      name,
      contact_phone,
      created_at
    FROM lead_scope
    WHERE COALESCE(btrim(instancia::text), '') = ''
    ORDER BY created_at DESC NULLS LAST
    LIMIT v_limit
  )
  SELECT jsonb_build_object(
    'total_leads', counts.total_leads,
    'communicable_count', counts.communicable_count,
    'missing_instance_count', counts.missing_instance_count,
    'invalid_instance_count', counts.invalid_instance_count,
    'instances_count', instances.value,
    'missing_leads_sample',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', id,
            'name', name,
            'contact_phone', contact_phone,
            'created_at', created_at
          )
          ORDER BY created_at DESC NULLS LAST
        )
        FROM missing_sample
      ),
      '[]'::jsonb
    )
  )
  INTO v_result
  FROM counts
  CROSS JOIN instances;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$function$;

GRANT EXECUTE ON FUNCTION crm.rpc_get_lead_instance_diagnostics(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_get_lead_instance_diagnostics(integer) TO service_role;
REVOKE ALL ON FUNCTION crm.rpc_get_lead_instance_diagnostics(integer) FROM anon;
REVOKE ALL ON FUNCTION crm.rpc_get_lead_instance_diagnostics(integer) FROM PUBLIC;
