-- Add tables to realtime (skip if already exists)
DO $$
BEGIN
  -- Try to add each table individually, ignoring errors if already added
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
  EXCEPTION 
    WHEN others THEN NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;
  EXCEPTION 
    WHEN others THEN NULL;
  END;
  
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.companies;
  EXCEPTION 
    WHEN others THEN NULL;
  END;
END$$;

-- Function to trigger task automation
CREATE OR REPLACE FUNCTION public.trigger_task_automation(
  trigger_type text,
  trigger_data jsonb,
  org_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Call the edge function to process automation rules
  PERFORM net.http_post(
    url := 'https://utxhciesdxvnnvwtfves.supabase.co/functions/v1/task-automation',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0eGhjaWVzZHh2bm52d3RmdmVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODUwMTE0MCwiZXhwIjoyMDc0MDc3MTQwfQ.gP9s-qg9vkkmRAI0u2_mAYpOBVS6_GhGfCJ2d8rqEBE"}'::jsonb,
    body := json_build_object(
      'trigger_type', trigger_type,
      'data', trigger_data,
      'organization_id', org_id
    )::jsonb
  );
END;
$$;

-- Function to handle deal creation
CREATE OR REPLACE FUNCTION public.handle_deal_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trigger automation for deal creation
  PERFORM public.trigger_task_automation(
    'deal_created',
    to_jsonb(NEW),
    NEW.organization_id
  );
  
  RETURN NEW;
END;
$$;

-- Function to handle deal stage changes
CREATE OR REPLACE FUNCTION public.handle_deal_stage_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if stage actually changed
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    -- Trigger automation for stage change
    PERFORM public.trigger_task_automation(
      'deal_stage_changed',
      json_build_object(
        'deal_id', NEW.id,
        'deal_title', NEW.title,
        'old_stage', OLD.stage,
        'new_stage', NEW.stage,
        'value', NEW.value,
        'company_id', NEW.company_id,
        'contact_id', NEW.contact_id
      )::jsonb,
      NEW.organization_id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Function to handle contact creation
CREATE OR REPLACE FUNCTION public.handle_contact_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trigger automation for contact creation
  PERFORM public.trigger_task_automation(
    'contact_created',
    json_build_object(
      'contact_id', NEW.id,
      'contact_name', NEW.first_name || ' ' || NEW.last_name,
      'first_name', NEW.first_name,
      'last_name', NEW.last_name,
      'email', NEW.email,
      'company', NEW.company,
      'company_id', NEW.company_id,
      'birthday', NEW.birthday,
      'anniversary', NEW.anniversary
    )::jsonb,
    NEW.organization_id
  );
  
  RETURN NEW;
END;
$$;

-- Function to handle company creation
CREATE OR REPLACE FUNCTION public.handle_company_created()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trigger automation for company creation
  PERFORM public.trigger_task_automation(
    'company_created',
    json_build_object(
      'company_id', NEW.id,
      'company_name', NEW.name,
      'industry', NEW.industry,
      'website', NEW.website,
      'phone', NEW.phone,
      'email', NEW.email
    )::jsonb,
    NEW.organization_id
  );
  
  RETURN NEW;
END;
$$;

-- Function to handle lead conversion (status change to converted)
CREATE OR REPLACE FUNCTION public.handle_lead_status_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Check if lead was converted
  IF OLD.status != 'Converted' AND NEW.status = 'Converted' THEN
    -- Trigger automation for lead conversion
    PERFORM public.trigger_task_automation(
      'lead_converted',
      json_build_object(
        'lead_id', NEW.id,
        'lead_name', NEW.first_name || ' ' || NEW.last_name,
        'first_name', NEW.first_name,
        'last_name', NEW.last_name,
        'email', NEW.email,
        'company', NEW.company,
        'phone', NEW.phone,
        'title', NEW.title,
        'industry', NEW.industry,
        'score', NEW.score
      )::jsonb,
      NEW.organization_id
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS trigger_deal_created_automation ON public.deals;
DROP TRIGGER IF EXISTS trigger_deal_stage_changed_automation ON public.deals;
DROP TRIGGER IF EXISTS trigger_contact_created_automation ON public.contacts;
DROP TRIGGER IF EXISTS trigger_company_created_automation ON public.companies;
DROP TRIGGER IF EXISTS trigger_lead_status_changed_automation ON public.leads;

-- Create triggers for automation
CREATE TRIGGER trigger_deal_created_automation
  AFTER INSERT ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.handle_deal_created();

CREATE TRIGGER trigger_deal_stage_changed_automation
  AFTER UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.handle_deal_stage_changed();

CREATE TRIGGER trigger_contact_created_automation
  AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.handle_contact_created();

CREATE TRIGGER trigger_company_created_automation
  AFTER INSERT ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.handle_company_created();

CREATE TRIGGER trigger_lead_status_changed_automation
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.handle_lead_status_changed();