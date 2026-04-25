CREATE OR REPLACE FUNCTION crm.rpc_create_lead(
  p_name text,
  p_contact_phone text,
  p_email text DEFAULT NULL,
  p_source text DEFAULT 'WhatsApp',
  p_last_city text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_stage_id uuid DEFAULT NULL,
  p_instance text DEFAULT NULL,
  p_value numeric DEFAULT NULL,
  p_connection_level text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT public.rpc_create_lead(
    p_name,
    p_contact_phone,
    p_email,
    p_source,
    p_last_city,
    p_notes,
    p_stage_id,
    p_instance,
    p_value,
    p_connection_level
  );
$$;

GRANT EXECUTE ON FUNCTION crm.rpc_create_lead(text, text, text, text, text, text, uuid, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION crm.rpc_create_lead(text, text, text, text, text, text, uuid, text, numeric, text) TO service_role;
