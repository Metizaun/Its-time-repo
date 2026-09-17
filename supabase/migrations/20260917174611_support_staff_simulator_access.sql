-- Separate Its Time support access from the Superadmin permission.
-- Existing internal operators keep simulator access after the permission split.

CREATE TABLE IF NOT EXISTS costs.support_staff (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome text NOT NULL CHECK (length(btrim(nome)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE costs.support_staff ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON costs.support_staff FROM PUBLIC, anon, authenticated, authenticator;
GRANT SELECT, INSERT, UPDATE, DELETE ON costs.support_staff TO service_role;

INSERT INTO costs.support_staff (auth_user_id, nome)
SELECT auth_user_id, nome
FROM costs.admin_staff
ON CONFLICT (auth_user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION crm.service_support_is_staff(p_auth_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM costs.support_staff AS staff
    WHERE staff.auth_user_id = p_auth_user_id
  );
$function$;

REVOKE ALL ON FUNCTION crm.service_support_is_staff(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION crm.service_support_is_staff(uuid) TO service_role;
