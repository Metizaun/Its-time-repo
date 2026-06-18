-- First, let's see what trigger is creating organizations for new users
-- We need to modify the trigger to only create organizations for users who don't already have a role

-- Drop the existing trigger that creates organizations for all new users
DROP TRIGGER IF EXISTS on_auth_user_created_with_organization ON auth.users;

-- Create a new trigger that only creates an organization if the user doesn't have any roles
CREATE OR REPLACE FUNCTION public.handle_new_user_conditional()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, NEW.raw_user_meta_data ->> 'display_name');
  
  -- Only create organization if user doesn't have any roles (not added via admin)
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) THEN
    -- Create a new organization for the user
    DECLARE
      new_org_id UUID;
    BEGIN
      INSERT INTO public.organizations (name) 
      VALUES (COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'My Organization') || '''s CRM')
      RETURNING id INTO new_org_id;
      
      -- Make the user the owner of this organization
      INSERT INTO public.user_roles (user_id, organization_id, role)
      VALUES (NEW.id, new_org_id, 'owner');
    END;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the new trigger
CREATE TRIGGER on_auth_user_created_conditional
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_conditional();