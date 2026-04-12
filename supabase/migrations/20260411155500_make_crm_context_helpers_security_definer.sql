-- Helpers de contexto precisam bypassar RLS para evitar recursao nas policies

CREATE OR REPLACE FUNCTION public.current_crm_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT id
  FROM crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_aces_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT aces_id
  FROM crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_crm_role()
RETURNS crm.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT role
  FROM crm.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.current_crm_user_id() TO anon, authenticated, service_role, authenticator;
GRANT EXECUTE ON FUNCTION public.current_aces_id() TO anon, authenticated, service_role, authenticator;
GRANT EXECUTE ON FUNCTION public.current_crm_role() TO anon, authenticated, service_role, authenticator;
