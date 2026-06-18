-- Create notes table for standalone note-taking
CREATE TABLE public.notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  tags TEXT[],
  is_pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Create policies for notes access
CREATE POLICY "Users can view notes in their organizations" 
ON public.notes 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = notes.organization_id
));

CREATE POLICY "Members and above can create notes" 
ON public.notes 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update notes" 
ON public.notes 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete notes" 
ON public.notes 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_notes_updated_at
BEFORE UPDATE ON public.notes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for better performance on common queries
CREATE INDEX idx_notes_organization_id ON public.notes(organization_id);
CREATE INDEX idx_notes_user_id ON public.notes(user_id);
CREATE INDEX idx_notes_tags ON public.notes USING GIN(tags);
CREATE INDEX idx_notes_pinned ON public.notes(is_pinned) WHERE is_pinned = true;