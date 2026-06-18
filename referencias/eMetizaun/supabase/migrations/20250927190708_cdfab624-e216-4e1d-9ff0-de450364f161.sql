-- Create composer templates table
CREATE TABLE public.composer_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('linkedin', 'email', 'sms', 'custom')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create composer sequences table
CREATE TABLE public.composer_sequences (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN ('linkedin', 'email', 'sms', 'custom')),
  description TEXT,
  steps JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.composer_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.composer_sequences ENABLE ROW LEVEL SECURITY;

-- RLS policies for composer_templates
CREATE POLICY "Members and above can create templates" 
ON public.composer_templates 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update templates" 
ON public.composer_templates 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete templates" 
ON public.composer_templates 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Users can view templates in their organizations" 
ON public.composer_templates 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = composer_templates.organization_id
));

-- RLS policies for composer_sequences
CREATE POLICY "Members and above can create sequences" 
ON public.composer_sequences 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update sequences" 
ON public.composer_sequences 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete sequences" 
ON public.composer_sequences 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Users can view sequences in their organizations" 
ON public.composer_sequences 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = composer_sequences.organization_id
));

-- Add updated_at triggers
CREATE TRIGGER update_composer_templates_updated_at
BEFORE UPDATE ON public.composer_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_composer_sequences_updated_at
BEFORE UPDATE ON public.composer_sequences
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();