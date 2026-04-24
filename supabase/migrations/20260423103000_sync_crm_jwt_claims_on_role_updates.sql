-- Mantem os claims do CRM sincronizados no JWT sempre que crm.users mudar.

DROP TRIGGER IF EXISTS on_auth_user_update ON crm.users;

CREATE TRIGGER on_auth_user_update
  AFTER INSERT OR UPDATE OF aces_id, role, auth_user_id ON crm.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_aces_id_to_jwt();

UPDATE auth.users au
SET raw_app_meta_data =
  COALESCE(au.raw_app_meta_data, '{}'::jsonb) ||
  jsonb_build_object(
    'aces_id', cu.aces_id,
    'crm_role', cu.role,
    'crm_user_id', cu.id
  )
FROM crm.users cu
WHERE cu.auth_user_id = au.id
  AND (
    au.raw_app_meta_data ->> 'aces_id' IS DISTINCT FROM cu.aces_id::text
    OR au.raw_app_meta_data ->> 'crm_role' IS DISTINCT FROM cu.role::text
    OR au.raw_app_meta_data ->> 'crm_user_id' IS DISTINCT FROM cu.id::text
  );
