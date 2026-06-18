-- Create user role enum
CREATE TYPE public.user_role AS ENUM ('owner', 'admin', 'member', 'viewer');

-- Create organizations table
CREATE TABLE public.organizations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Create user_roles table (junction table between users and organizations)
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role public.user_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, organization_id)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Add organization_id to existing tables
ALTER TABLE public.companies ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.contacts ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.deals ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.tasks ADD COLUMN organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Create security definer function to get user's role in organization
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid UUID, org_id UUID)
RETURNS public.user_role AS $$
  SELECT role FROM public.user_roles 
  WHERE user_id = user_uuid AND organization_id = org_id;
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Create security definer function to check if user has minimum role
CREATE OR REPLACE FUNCTION public.has_minimum_role(user_uuid UUID, org_id UUID, min_role public.user_role)
RETURNS BOOLEAN AS $$
  SELECT CASE 
    WHEN min_role = 'viewer' THEN role IN ('viewer', 'member', 'admin', 'owner')
    WHEN min_role = 'member' THEN role IN ('member', 'admin', 'owner')
    WHEN min_role = 'admin' THEN role IN ('admin', 'owner')
    WHEN min_role = 'owner' THEN role = 'owner'
    ELSE FALSE
  END
  FROM public.user_roles 
  WHERE user_id = user_uuid AND organization_id = org_id;
$$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

-- Create RLS policies for organizations
CREATE POLICY "Users can view organizations they belong to" 
ON public.organizations 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND organization_id = organizations.id
  )
);

CREATE POLICY "Admins and owners can update organizations" 
ON public.organizations 
FOR UPDATE 
USING (public.has_minimum_role(auth.uid(), id, 'admin'));

-- Create RLS policies for user_roles
CREATE POLICY "Users can view user_roles in their organizations" 
ON public.user_roles 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles ur2 
    WHERE ur2.user_id = auth.uid() AND ur2.organization_id = user_roles.organization_id
  )
);

CREATE POLICY "Admins and owners can manage user roles" 
ON public.user_roles 
FOR INSERT 
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'admin'));

CREATE POLICY "Admins and owners can update user roles" 
ON public.user_roles 
FOR UPDATE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'));

CREATE POLICY "Admins and owners can delete user roles" 
ON public.user_roles 
FOR DELETE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'admin'));

-- Update RLS policies for existing tables to use organization membership
-- Companies
DROP POLICY IF EXISTS "Users can view their own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can create their own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can update their own companies" ON public.companies;
DROP POLICY IF EXISTS "Users can delete their own companies" ON public.companies;

CREATE POLICY "Users can view companies in their organizations" 
ON public.companies 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND organization_id = companies.organization_id
  )
);

CREATE POLICY "Members and above can create companies" 
ON public.companies 
FOR INSERT 
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update companies" 
ON public.companies 
FOR UPDATE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete companies" 
ON public.companies 
FOR DELETE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

-- Contacts
DROP POLICY IF EXISTS "Users can view their own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can create their own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can update their own contacts" ON public.contacts;
DROP POLICY IF EXISTS "Users can delete their own contacts" ON public.contacts;

CREATE POLICY "Users can view contacts in their organizations" 
ON public.contacts 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND organization_id = contacts.organization_id
  )
);

CREATE POLICY "Members and above can create contacts" 
ON public.contacts 
FOR INSERT 
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update contacts" 
ON public.contacts 
FOR UPDATE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete contacts" 
ON public.contacts 
FOR DELETE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

-- Deals
DROP POLICY IF EXISTS "Users can view their own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can create their own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can update their own deals" ON public.deals;
DROP POLICY IF EXISTS "Users can delete their own deals" ON public.deals;

CREATE POLICY "Users can view deals in their organizations" 
ON public.deals 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND organization_id = deals.organization_id
  )
);

CREATE POLICY "Members and above can create deals" 
ON public.deals 
FOR INSERT 
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update deals" 
ON public.deals 
FOR UPDATE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete deals" 
ON public.deals 
FOR DELETE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

-- Tasks
DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can create their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;

CREATE POLICY "Users can view tasks in their organizations" 
ON public.tasks 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_id = auth.uid() AND organization_id = tasks.organization_id
  )
);

CREATE POLICY "Members and above can create tasks" 
ON public.tasks 
FOR INSERT 
WITH CHECK (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can update tasks" 
ON public.tasks 
FOR UPDATE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

CREATE POLICY "Members and above can delete tasks" 
ON public.tasks 
FOR DELETE 
USING (public.has_minimum_role(auth.uid(), organization_id, 'member'));

-- Create trigger to update updated_at column
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_user_roles_updated_at
  BEFORE UPDATE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle new user signup - creates an organization and makes them owner
CREATE OR REPLACE FUNCTION public.handle_new_user_with_organization()
RETURNS TRIGGER AS $$
DECLARE
  new_org_id UUID;
BEGIN
  -- Create a new organization for the user
  INSERT INTO public.organizations (name) 
  VALUES (COALESCE(NEW.raw_user_meta_data ->> 'display_name', 'My Organization') || '''s CRM')
  RETURNING id INTO new_org_id;
  
  -- Make the user the owner of this organization
  INSERT INTO public.user_roles (user_id, organization_id, role)
  VALUES (NEW.id, new_org_id, 'owner');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Update the existing trigger to also handle organization creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

CREATE TRIGGER on_auth_user_created_organization
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user_with_organization();