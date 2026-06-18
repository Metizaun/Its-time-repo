-- Remove the overly permissive RLS policy that allows everyone to view all profiles
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;

-- Create a new policy that only allows users to view profiles of people in their organizations
CREATE POLICY "Users can view profiles in their organizations" 
ON public.profiles 
FOR SELECT 
USING (
  -- Users can always view their own profile
  auth.uid() = user_id 
  OR 
  -- Users can view profiles of others in the same organizations
  EXISTS (
    SELECT 1 FROM public.user_roles ur1
    WHERE ur1.user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur2 
      WHERE ur2.user_id = profiles.user_id 
      AND ur2.organization_id = ur1.organization_id
    )
  )
);