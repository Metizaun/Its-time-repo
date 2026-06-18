-- Update contacts table to properly link to companies
-- First, add the company_id column
ALTER TABLE public.contacts ADD COLUMN company_id uuid;

-- Add foreign key constraint to link contacts to companies
ALTER TABLE public.contacts 
ADD CONSTRAINT contacts_company_id_fkey 
FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;

-- Create index for better performance
CREATE INDEX idx_contacts_company_id ON public.contacts(company_id);