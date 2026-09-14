#!/usr/bin/env bash
set -Eeuo pipefail

count=$(docker exec supabase-db psql \
  --username postgres \
  --dbname postgres \
  --no-psqlrc \
  --tuples-only \
  --no-align \
  --command "select count(*) from information_schema.tables where table_schema in ('public', 'crm', 'calendar');")
count=$(printf '%s' "$count" | tr -d '[:space:]')

if [ "$count" != "0" ]; then
  echo "target_clean=false application_tables=$count" >&2
  exit 1
fi
echo "target_clean=true application_tables=0"
