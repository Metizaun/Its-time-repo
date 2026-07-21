-- Prevent the auth -> CRM -> auth synchronization loop and never reapply
-- cancelled or already consumed invitations during later Auth updates.

CREATE OR REPLACE FUNCTION public.sync_aces_id_to_jwt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, crm, auth
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
  WHERE id = NEW.auth_user_id
    AND (
      raw_app_meta_data->'aces_id' IS DISTINCT FROM to_jsonb(NEW.aces_id)
      OR raw_app_meta_data->>'crm_role' IS DISTINCT FROM NEW.role::text
      OR raw_app_meta_data->>'crm_user_id' IS DISTINCT FROM NEW.id::text
    );

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_crm_user_from_invitation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, crm, auth
AS $function$
DECLARE
  v_invitation_id uuid;
  v_invitation crm.user_invitations%ROWTYPE;
BEGIN
  IF COALESCE(NEW.email_confirmed_at, NEW.last_sign_in_at) IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_invitation_id := COALESCE(
      NULLIF(NEW.raw_user_meta_data->>'invitation_id', ''),
      NULLIF(NEW.raw_app_meta_data->>'invitation_id', '')
    )::uuid;
  EXCEPTION WHEN others THEN
    v_invitation_id := NULL;
  END;

  IF v_invitation_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT *
  INTO v_invitation
  FROM crm.user_invitations
  WHERE id = v_invitation_id
    AND status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Consume the invitation before touching crm.users. If the CRM upsert fires
  -- the JWT trigger, a nested Auth update now sees a non-pending invitation
  -- and exits immediately. The enclosing transaction still stays atomic.
  UPDATE crm.user_invitations
  SET
    status = 'accepted',
    accepted_at = COALESCE(accepted_at, now())
  WHERE id = v_invitation_id;

  INSERT INTO crm.users (auth_user_id, email, name, role, aces_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(v_invitation.name, NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    v_invitation.role,
    v_invitation.aces_id
  )
  ON CONFLICT (auth_user_id) DO UPDATE
  SET
    email = EXCLUDED.email,
    name = COALESCE(EXCLUDED.name, crm.users.name),
    role = EXCLUDED.role,
    aces_id = EXCLUDED.aces_id,
    updated_at = now()
  WHERE crm.users.email IS DISTINCT FROM EXCLUDED.email
    OR crm.users.name IS DISTINCT FROM COALESCE(EXCLUDED.name, crm.users.name)
    OR crm.users.role IS DISTINCT FROM EXCLUDED.role
    OR crm.users.aces_id IS DISTINCT FROM EXCLUDED.aces_id;

  RETURN NEW;
END;
$function$;
