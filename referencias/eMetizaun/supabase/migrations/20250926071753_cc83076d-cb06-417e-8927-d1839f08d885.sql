-- Create task automation rules table
CREATE TABLE public.task_automation_rules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  organization_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('deal_created', 'deal_stage_changed', 'contact_created', 'company_created', 'lead_converted', 'date_based', 'manual')),
  trigger_conditions JSONB,
  task_template JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.task_automation_rules ENABLE ROW LEVEL SECURITY;

-- Create policies for task automation rules
CREATE POLICY "Users can view automation rules in their organizations" 
ON public.task_automation_rules 
FOR SELECT 
USING (EXISTS (
  SELECT 1 FROM user_roles 
  WHERE user_roles.user_id = auth.uid() 
  AND user_roles.organization_id = task_automation_rules.organization_id
));

CREATE POLICY "Members and above can create automation rules" 
ON public.task_automation_rules 
FOR INSERT 
WITH CHECK (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can update automation rules" 
ON public.task_automation_rules 
FOR UPDATE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

CREATE POLICY "Members and above can delete automation rules" 
ON public.task_automation_rules 
FOR DELETE 
USING (has_minimum_role(auth.uid(), organization_id, 'member'::user_role));

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_task_automation_rules_updated_at
BEFORE UPDATE ON public.task_automation_rules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();