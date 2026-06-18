-- Enable the net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS http;

-- Update the trigger_task_automation function to handle missing net extension gracefully
CREATE OR REPLACE FUNCTION public.trigger_task_automation(trigger_type text, trigger_data jsonb, org_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Try to call the edge function, but don't fail if net extension is not available
  BEGIN
    PERFORM net.http_post(
      url := 'https://utxhciesdxvnnvwtfves.supabase.co/functions/v1/task-automation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0eGhjaWVzZHh2bm52d3RmdmVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODUwMTE0MCwiZXhwIjoyMDc0MDc3MTQwfQ.gP9s-qg9vkkmRAI0u2_mAYpOBVS6_GhGfCJ2d8rqEBE"}'::jsonb,
      body := json_build_object(
        'trigger_type', trigger_type,
        'data', trigger_data,
        'organization_id', org_id
      )::jsonb
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log the error but don't fail the transaction
    RAISE NOTICE 'Task automation trigger failed: %', SQLERRM;
  END;
END;
$function$;

-- Add triggers for deals table
DROP TRIGGER IF EXISTS trigger_deal_created ON public.deals;
CREATE TRIGGER trigger_deal_created
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deal_created();

DROP TRIGGER IF EXISTS trigger_deal_stage_changed ON public.deals;  
CREATE TRIGGER trigger_deal_stage_changed
  AFTER UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_deal_stage_changed();