CREATE OR REPLACE FUNCTION public.handle_new_user_conditional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_org_id uuid;
BEGIN
  -- Upsert profile to avoid duplicates
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name')
  ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name;

  -- Only create a personal organization if the user has no roles yet
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    INSERT INTO public.organizations (name)
    VALUES (COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'My Organization') || '''s CRM')
    RETURNING id INTO new_org_id;

    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (NEW.id, new_org_id, 'owner');
  END IF;

  RETURN NEW;
END;
$$;