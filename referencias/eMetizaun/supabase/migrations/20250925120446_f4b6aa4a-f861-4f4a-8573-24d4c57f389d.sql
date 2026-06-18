-- Add contact and company relationships to notes table
ALTER TABLE public.notes 
ADD COLUMN contact_id UUID,
ADD COLUMN company_id UUID;

-- Add indexes for the new foreign key columns
CREATE INDEX idx_notes_contact_id ON public.notes(contact_id);
CREATE INDEX idx_notes_company_id ON public.notes(company_id);