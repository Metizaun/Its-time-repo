-- Exposicao do schema Crm para PostgREST e compatibilidade de RPCs

GRANT USAGE ON SCHEMA Crm TO authenticated;
GRANT USAGE ON SCHEMA Crm TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA Crm TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA Crm TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA Crm TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA Crm
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA Crm
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA Crm
  GRANT EXECUTE ON FUNCTIONS TO authenticated;

CREATE OR REPLACE FUNCTION Crm.get_pending_invitations()
RETURNS TABLE (
  id uuid,
  email text,
  name text,
  role text,
  invited_at timestamptz,
  expires_at timestamptz,
  days_until_expiry integer
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT * FROM public.get_pending_invitations();
$$;

CREATE OR REPLACE FUNCTION Crm.invite_user_to_company(p_email text, p_name text, p_role text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT public.invite_user_to_company(p_email, p_name, p_role);
$$;

CREATE OR REPLACE FUNCTION Crm.cancel_invitation(p_invitation_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT public.cancel_invitation(p_invitation_id);
$$;

CREATE OR REPLACE FUNCTION Crm.rpc_move_lead_to_stage(p_lead_id uuid, p_stage_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT public.rpc_move_lead_to_stage(p_lead_id, p_stage_id);
$$;

CREATE OR REPLACE FUNCTION Crm.rpc_update_lead_status(p_lead_id uuid, p_status text)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT public.rpc_update_lead_status(p_lead_id, p_status);
$$;

CREATE OR REPLACE FUNCTION Crm.rpc_create_opportunity(
  p_lead_id uuid,
  p_value numeric,
  p_connection_level text,
  p_status text
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT public.rpc_create_opportunity(p_lead_id, p_value, p_connection_level, p_status);
$$;

CREATE OR REPLACE FUNCTION Crm.rpc_get_chat(p_lead_id uuid)
RETURNS TABLE (
  id uuid,
  lead_id uuid,
  content text,
  direction text,
  direction_code integer,
  sent_at timestamptz,
  lead_name text,
  sender_name text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT * FROM public.rpc_get_chat(p_lead_id);
$$;

CREATE OR REPLACE FUNCTION Crm.rpc_send_message(
  p_lead_id uuid,
  p_content text,
  p_direction text,
  p_conversation_id text DEFAULT NULL,
  p_instance text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, Crm
AS $$
  SELECT public.rpc_send_message(p_lead_id, p_content, p_direction, p_conversation_id, p_instance);
$$;

GRANT EXECUTE ON FUNCTION Crm.get_pending_invitations() TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.invite_user_to_company(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.cancel_invitation(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.rpc_move_lead_to_stage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.rpc_update_lead_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.rpc_create_opportunity(uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.rpc_get_chat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION Crm.rpc_send_message(uuid, text, text, text, text) TO authenticated;
