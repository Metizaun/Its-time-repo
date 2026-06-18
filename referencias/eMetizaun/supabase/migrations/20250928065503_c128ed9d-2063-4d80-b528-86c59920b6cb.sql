-- Create a security definer function to check if a user is a member of an organization
CREATE OR REPLACE FUNCTION public.is_org_member(_user_id uuid, _organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND organization_id = _organization_id
  )
$$;

-- Drop the existing restrictive SELECT policy
DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and owners can view organization roles" ON public.user_roles;

-- Create new SELECT policies that allow organization members to see each other
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Organization members can view team roles" 
ON public.user_roles 
FOR SELECT 
USING (public.is_org_member(auth.uid(), organization_id));

-- Add index for better performance on organization membership lookups
CREATE INDEX IF NOT EXISTS idx_user_roles_org_user ON public.user_roles(organization_id, user_id);