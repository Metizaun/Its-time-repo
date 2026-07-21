CREATE OR REPLACE FUNCTION crm.resolve_automation_anchor_at(p_anchor_event text, p_context jsonb)
RETURNS timestamptz
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_anchor jsonb;
BEGIN
  v_anchor := crm.get_anchor_details_from_context(p_context, p_anchor_event);
  RETURN NULLIF(v_anchor->>'anchor_at', '')::timestamptz;
END;
$$;
