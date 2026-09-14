#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_ref="${SUPABASE_PROJECT_REF:-hvziqfbnkicryfndoepk}"
pooler_host="${SUPABASE_POOLER_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
secrets_file="${MIGRATION_SECRETS_FILE:-/opt/supabase-migration/migration-secrets.env}"

[ -s "$secrets_file" ] || { echo "Missing $secrets_file" >&2; exit 1; }
command -v docker >/dev/null || { echo "Missing docker" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

check_connection() {
  label="$1"
  host="$2"
  port="$3"
  user="$4"
  error_file=$(mktemp)
  if docker exec \
      -e PGPASSWORD="$SUPABASE_DB_PASSWORD" \
      -e PGCONNECT_TIMEOUT=10 \
      supabase-db psql "host=$host port=$port dbname=postgres user=$user sslmode=require" \
      -XAtqc 'select 1' >/dev/null 2>"$error_file"; then
    printf '%s=ok\n' "$label"
  elif grep -qi 'password authentication failed' "$error_file"; then
    printf '%s=bad_password\n' "$label"
  elif grep -qiE 'could not translate host|Network is unreachable|timeout expired|could not connect' "$error_file"; then
    printf '%s=unreachable\n' "$label"
  else
    printf '%s=failed\n' "$label"
  fi
  rm -f -- "$error_file"
}

check_connection session_pooler "$pooler_host" 5432 "postgres.$project_ref"
check_connection transaction_pooler "$pooler_host" 6543 "postgres.$project_ref"
check_connection direct "db.$project_ref.supabase.co" 5432 postgres
unset SUPABASE_DB_PASSWORD
