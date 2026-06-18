-- Move pg_cron extension from public schema to extensions schema
DROP EXTENSION IF EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;