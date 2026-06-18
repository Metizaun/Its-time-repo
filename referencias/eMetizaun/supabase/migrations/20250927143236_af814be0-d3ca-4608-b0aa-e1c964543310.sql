-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Update the trigger_task_automation function to use the correct HTTP function
CREATE OR REPLACE FUNCTION public.trigger_task_automation(trigger_type text, trigger_data jsonb, org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Try to call the edge function using pg_net
  BEGIN
    SELECT net.http_post(
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
$$;