-- Resolver contexto do CRM via JWT para evitar lookup recursivo em crm.users

CREATE OR REPLACE FUNCTION public.sync_aces_id_to_jwt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
    COALESCE(raw_app_meta_data, '{}'::jsonb) ||
    jsonb_build_object(
      'aces_id', NEW.aces_id,
      'crm_role', NEW.role,
      'crm_user_id', NEW.id
    )
  WHERE id = NEW.auth_user_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.current_crm_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'crm_user_id', '')::uuid;
$$;

CREATE OR REPLACE FUNCTION public.current_aces_id()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'aces_id', '')::integer;
$$;

CREATE OR REPLACE FUNCTION public.current_crm_role()
RETURNS crm.user_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, crm
AS $$
  SELECT NULLIF(auth.jwt() -> 'app_metadata' ->> 'crm_role', '')::crm.user_role;
$$;

UPDATE auth.users au
SET raw_app_meta_data =
  COALESCE(au.raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object(
    'aces_id', cu.aces_id,
    'crm_role', cu.role,
    'crm_user_id', cu.id
  )
FROM crm.users cu
WHERE cu.auth_user_id = au.id;
