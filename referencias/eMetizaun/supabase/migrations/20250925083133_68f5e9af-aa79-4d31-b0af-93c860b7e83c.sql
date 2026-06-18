-- Fix infinite recursion in user_roles RLS policies
-- Drop the problematic policy that references user_roles in its own check
DROP POLICY IF EXISTS "Users can view user_roles in their organizations" ON public.user_roles;

-- Create a simple policy that allows users to see their own roles
CREATE POLICY "Users can view their own roles" 
ON public.user_roles 
FOR SELECT 
USING (auth.uid() = user_id);

-- Update other policies to avoid recursion by using a direct check
DROP POLICY IF EXISTS "Admins and owners can manage user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and owners can update user roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and owners can delete user roles" ON public.user_roles;

-- Create new policies that don't cause recursion
-- For INSERT: Allow if user is inserting their own first role (for new organizations)
-- or if they're already an admin/owner in that organization
CREATE POLICY "Users can manage roles in their organizations" 
ON public.user_roles 
FOR INSERT 
WITH CHECK (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.user_roles existing 
    WHERE existing.user_id = auth.uid() 
    AND existing.organization_id = user_roles.organization_id 
    AND existing.role IN ('admin', 'owner')
  )
);

CREATE POLICY "Admins can update roles" 
ON public.user_roles 
FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles existing 
    WHERE existing.user_id = auth.uid() 
    AND existing.organization_id = user_roles.organization_id 
    AND existing.role IN ('admin', 'owner')
  )
);

CREATE POLICY "Admins can delete roles" 
ON public.user_roles 
FOR DELETE 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles existing 
    WHERE existing.user_id = auth.uid() 
    AND existing.organization_id = user_roles.organization_id 
    AND existing.role IN ('admin', 'owner')
  )
);