CREATE OR REPLACE VIEW crm.v_lead_details AS
SELECT
  l.id,
  l.name AS lead_name,
  l.email,
  l.contact_phone,
  l."Fonte" AS source,
  l.status,
  l.stage_id,
  l.created_at,
  l.updated_at,
  l.last_message_at,
  l.last_city,
  l.last_region,
  l.last_country,
  l.lead_number,
  owner_user.name AS owner_name,
  l.owner_id,
  latest_opp.value,
  latest_opp.connection_level,
  latest_opp.status::text AS opportunity_status,
  l.notes,
  l.instancia AS instance_name,
  inst.color AS instance_color,
  latest_tag.last_tag_name,
  latest_tag.last_tag_urgencia,
  l.aces_id
FROM crm.leads l
LEFT JOIN crm.users owner_user
  ON owner_user.id = l.owner_id
 AND owner_user.aces_id = l.aces_id
LEFT JOIN crm.instance inst
  ON inst.instancia = l.instancia
 AND inst.aces_id = l.aces_id
LEFT JOIN LATERAL (
  SELECT o.value, o.connection_level, o.status
  FROM crm.opportunities o
  WHERE o.lead_id = l.id
  ORDER BY o.updated_at DESC NULLS LAST, o.created_at DESC NULLS LAST
  LIMIT 1
) latest_opp ON true
LEFT JOIN LATERAL (
  SELECT
    lt.tag_name AS last_tag_name,
    t.urgencia AS last_tag_urgencia
  FROM crm.lead_tags lt
  LEFT JOIN crm.tags t
    ON t.id = lt.tag_id
   AND t.aces_id = l.aces_id
  WHERE lt.lead_id = l.id
  ORDER BY lt.created_at DESC NULLS LAST
  LIMIT 1
) latest_tag ON true;

ALTER VIEW crm.v_lead_details SET (security_invoker = true);
GRANT SELECT ON crm.v_lead_details TO authenticated;

DO $$
DECLARE
  v_function_sql text;
  v_target text := E'FROM crm.v_lead_details l\n    WHERE (v_instance IS NULL OR l.instance_name = v_instance)';
  v_replacement text := E'FROM crm.v_lead_details l\n    WHERE l.aces_id = public.current_aces_id()\n      AND (v_instance IS NULL OR l.instance_name = v_instance)';
BEGIN
  SELECT pg_get_functiondef('crm.rpc_dashboard_operational_metrics(text,timestamptz,timestamptz,text)'::regprocedure)
  INTO v_function_sql;

  IF v_function_sql IS NULL THEN
    RAISE EXCEPTION 'crm.rpc_dashboard_operational_metrics(text,timestamptz,timestamptz,text) was not found';
  END IF;

  IF position(v_replacement in v_function_sql) = 0 THEN
    IF position(v_target in v_function_sql) = 0 THEN
      RAISE EXCEPTION 'Expected dashboard v_lead_details filter was not found';
    END IF;

    v_function_sql := replace(v_function_sql, v_target, v_replacement);
    EXECUTE v_function_sql;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_dashboard_operational_metrics(text, timestamptz, timestamptz, text) TO authenticated;

CREATE INDEX IF NOT EXISTS instance_external_webhook_remote_name_idx
  ON crm.instance (remote_instance_name)
  WHERE connection_mode = 'external_webhook'
    AND remote_instance_name IS NOT NULL;
