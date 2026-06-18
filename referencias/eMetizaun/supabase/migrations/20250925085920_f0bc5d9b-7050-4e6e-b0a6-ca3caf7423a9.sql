-- Create leads table
CREATE TABLE public.leads (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  company TEXT,
  phone TEXT,
  website TEXT,
  title TEXT,
  industry TEXT,
  location TEXT,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  score INTEGER DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create lead_lists table
CREATE TABLE public.lead_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL DEFAULT 'static', -- 'static' or 'smart'
  criteria JSONB, -- For smart lists
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create lead_list_members table (many-to-many relationship)
CREATE TABLE public.lead_list_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  list_id UUID NOT NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
  added_by UUID NOT NULL,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(lead_id, list_id)
);

-- Create lead_sources table
CREATE TABLE public.lead_sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_list_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_sources ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for leads
CREATE POLICY "Users can view leads in their organizations" 
ON public.leads 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = leads.organization_id
));

CREATE POLICY "Members and above can create leads" 
ON public.leads 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update leads" 
ON public.leads 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete leads" 
ON public.leads 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

-- Create RLS policies for lead_lists
CREATE POLICY "Users can view lead lists in their organizations" 
ON public.lead_lists 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = lead_lists.organization_id
));

CREATE POLICY "Members and above can create lead lists" 
ON public.lead_lists 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update lead lists" 
ON public.lead_lists 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete lead lists" 
ON public.lead_lists 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

-- Create RLS policies for lead_list_members
CREATE POLICY "Users can view lead list members in their organizations" 
ON public.lead_list_members 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM lead_lists 
  JOIN user_roles ON user_roles.organization_id = lead_lists.organization_id
  WHERE lead_lists.id = lead_list_members.list_id 
  AND user_roles.user_id = auth.uid()
));

CREATE POLICY "Members and above can manage lead list members" 
ON public.lead_list_members 
FOR ALL 
USING (EXISTS (
  SELECT 1 FROM lead_lists 
  WHERE lead_lists.id = lead_list_members.list_id 
  AND has_minimum_role(auth.uid(), lead_lists.organization_id, 'member'::user_role)
));

-- Create RLS policies for lead_sources
CREATE POLICY "Users can view lead sources in their organizations" 
ON public.lead_sources 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = lead_sources.organization_id
));

CREATE POLICY "Members and above can manage lead sources" 
ON public.lead_sources 
FOR ALL 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

-- Create triggers for updated_at
CREATE TRIGGER update_leads_updated_at
BEFORE UPDATE ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lead_lists_updated_at
BEFORE UPDATE ON public.lead_lists
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_lead_sources_updated_at
BEFORE UPDATE ON public.lead_sources
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();