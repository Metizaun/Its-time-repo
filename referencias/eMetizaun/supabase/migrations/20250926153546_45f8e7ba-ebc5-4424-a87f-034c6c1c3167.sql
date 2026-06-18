-- Create storage bucket for partner contracts
INSERT INTO storage.buckets (id, name, public) VALUES ('partner-contracts', 'partner-contracts', false);

-- Create RLS policies for partner contract uploads
CREATE POLICY "Users can view contract files in their organizations" 
ON storage.objects 
FOR SELECT 
USING (
  bucket_id = 'partner-contracts' 
  AND EXISTS (
    SELECT 1 FROM public.partner_contracts pc
    JOIN public.user_roles ur ON ur.organization_id = pc.organization_id
    WHERE ur.user_id = auth.uid()
    AND name LIKE pc.id::text || '/%'
  )
);

CREATE POLICY "Users can upload contract files in their organizations" 
ON storage.objects 
FOR INSERT 
WITH CHECK (
  bucket_id = 'partner-contracts' 
  AND EXISTS (
    SELECT 1 FROM public.partner_contracts pc
    JOIN public.user_roles ur ON ur.organization_id = pc.organization_id
    WHERE ur.user_id = auth.uid()
    AND name LIKE pc.id::text || '/%'
    AND has_minimum_role(auth.uid(), pc.organization_id, 'member'::user_role)
  )
);

CREATE POLICY "Users can update contract files in their organizations" 
ON storage.objects 
FOR UPDATE 
USING (
  bucket_id = 'partner-contracts' 
  AND EXISTS (
    SELECT 1 FROM public.partner_contracts pc
    JOIN public.user_roles ur ON ur.organization_id = pc.organization_id
    WHERE ur.user_id = auth.uid()
    AND name LIKE pc.id::text || '/%'
    AND has_minimum_role(auth.uid(), pc.organization_id, 'member'::user_role)
  )
);

CREATE POLICY "Users can delete contract files in their organizations" 
ON storage.objects 
FOR DELETE 
USING (
  bucket_id = 'partner-contracts' 
  AND EXISTS (
    SELECT 1 FROM public.partner_contracts pc
    JOIN public.user_roles ur ON ur.organization_id = pc.organization_id
    WHERE ur.user_id = auth.uid()
    AND name LIKE pc.id::text || '/%'
    AND has_minimum_role(auth.uid(), pc.organization_id, 'member'::user_role)
  )
);