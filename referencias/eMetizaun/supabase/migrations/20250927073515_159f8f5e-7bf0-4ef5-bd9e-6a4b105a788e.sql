-- Allow admins and owners to view all roles in their organization
CREATE POLICY "Admins and owners can view organization roles"
  ON public.user_roles
  FOR SELECT
  USING (
    has_minimum_role(auth.uid(), organization_id, 'admin'::user_role)
  );