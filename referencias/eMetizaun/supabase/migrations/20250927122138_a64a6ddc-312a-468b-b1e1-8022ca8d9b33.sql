-- Enable pg_cron extension for scheduled tasks
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the contract notifications function to run daily at 9 AM
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