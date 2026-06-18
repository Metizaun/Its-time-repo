-- Remove duplicate/competing signup triggers and harden behavior to avoid extra organizations on invited users
-- 1) Drop legacy triggers that create personal orgs or duplicate profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created_organization ON auth.users;
-- Keep only the conditional trigger which we'll update below

-- 2) Update conditional signup handler to SKIP personal org creation when flagged
CREATE OR REPLACE FUNCTION public.handle_new_user_conditional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_org_id uuid;
  skip_personal boolean;
BEGIN
  -- Always ensure a profile exists/updated for this user
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name')
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Respect explicit instruction to skip personal org for invited/created users
  skip_personal := COALESCE((NEW.raw_user_meta_data ->> 'skip_personal_org')::boolean, false)
                   OR (NEW.raw_user_meta_data ? 'invited_organization_id');
  IF skip_personal THEN
    RETURN NEW;
  END IF;

  -- Otherwise, only create a personal organization if the user still has no roles
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = NEW.id
  ) THEN
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'My Organization') || '''s CRM')
    RETURNING id INTO new_org_id;

    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (NEW.id, new_org_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;