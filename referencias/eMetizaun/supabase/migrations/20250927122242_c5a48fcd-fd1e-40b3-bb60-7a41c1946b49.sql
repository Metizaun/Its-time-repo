-- Check current extensions
SELECT extname, nspname FROM pg_extension JOIN pg_namespace ON extnamespace = pg_namespace.oid;

-- Enable pg_cron extension properly (should be installed at system level)
-- We'll create the cron job without explicitly creating the extension
SELECT cron.schedule(
  'contract-notifications-daily',
  '0 9 * * *', -- Run at 9 AM every day
  $$
  SELECT
    net.http_post(
      url := 'https://utxhciesdxvnnvwtfves.supabase.co/functions/v1/contract-notifications',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0eGhjaWVzZHh2bm52d3RmdmVzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODUwMTE0MCwiZXhwIjoyMDc0MDc3MTQwfQ.gP9s-qg9vkkmRAI0u2_mAYpOBVS6_GhGfCJ2d8rqEBE"}'::jsonb,
      body := '{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);