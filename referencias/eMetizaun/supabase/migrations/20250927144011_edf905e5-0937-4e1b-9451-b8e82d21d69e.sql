-- Ensure pg_net extension exists in the correct schema for HTTP calls from triggers
CREATE SCHEMA IF NOT EXISTS net;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA net;