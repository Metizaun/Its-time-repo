-- Create partners table
CREATE TABLE public.partners (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  company_name TEXT,
  email TEXT,
  phone TEXT,
  website TEXT,
  industry TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT,
  contact_person TEXT,
  partnership_type TEXT, -- e.g., 'technology', 'vendor', 'distributor', 'strategic'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'pending'
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create partner_contracts table
CREATE TABLE public.partner_contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_id UUID NOT NULL,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  contract_number TEXT,
  contract_type TEXT, -- e.g., 'service_agreement', 'licensing', 'distribution', 'nda'
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'active', 'expired', 'terminated'
  start_date DATE,
  end_date DATE,
  renewal_date DATE,
  contract_value NUMERIC,
  currency TEXT DEFAULT 'USD',
  payment_terms TEXT,
  description TEXT,
  file_url TEXT, -- for storing contract document links
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_contracts ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for partners
CREATE POLICY "Members and above can create partners" 
ON public.partners 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update partners" 
ON public.partners 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete partners" 
ON public.partners 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Users can view partners in their organizations" 
ON public.partners 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.organization_id = partners.organization_id
  )
);

-- Create RLS policies for partner_contracts
CREATE POLICY "Members and above can create partner contracts" 
ON public.partner_contracts 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update partner contracts" 
ON public.partner_contracts 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete partner contracts" 
ON public.partner_contracts 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Users can view partner contracts in their organizations" 
ON public.partner_contracts 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.organization_id = partner_contracts.organization_id
  )
);

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_partners_updated_at
BEFORE UPDATE ON public.partners
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_partner_contracts_updated_at
BEFORE UPDATE ON public.partner_contracts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_partners_organization_id ON public.partners(organization_id);
CREATE INDEX idx_partners_user_id ON public.partners(user_id);
CREATE INDEX idx_partners_status ON public.partners(status);
CREATE INDEX idx_partners_partnership_type ON public.partners(partnership_type);

CREATE INDEX idx_partner_contracts_partner_id ON public.partner_contracts(partner_id);
CREATE INDEX idx_partner_contracts_organization_id ON public.partner_contracts(organization_id);
CREATE INDEX idx_partner_contracts_user_id ON public.partner_contracts(user_id);
CREATE INDEX idx_partner_contracts_status ON public.partner_contracts(status);
CREATE INDEX idx_partner_contracts_end_date ON public.partner_contracts(end_date);