#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_ref="${SUPABASE_PROJECT_REF:-hvziqfbnkicryfndoepk}"
pooler_host="${SUPABASE_POOLER_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
pooler_port="${SUPABASE_POOLER_PORT:-6543}"
work_root="${MIGRATION_WORK_ROOT:-/opt/supabase-migration}"
secrets_file="${MIGRATION_SECRETS_FILE:-$work_root/migration-secrets.env}"

[ -s "$secrets_file" ] || { echo "Missing $secrets_file" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

output_file="${1:-$work_root/migrations.sql}"
temporary_dir=$(mktemp -d)
trap 'rm -rf -- "$temporary_dir"' EXIT

connection_args=(
  --host "$pooler_host"
  --port "$pooler_port"
  --username "postgres.$project_ref"
  --dbname postgres
)
docker exec -e PGPASSWORD="$SUPABASE_DB_PASSWORD" supabase-db pg_dump \
  "${connection_args[@]}" \
  --schema-only \
  --no-owner \
  --no-privileges \
  --table supabase_migrations.schema_migrations \
  > "$temporary_dir/schema.sql"
docker exec -e PGPASSWORD="$SUPABASE_DB_PASSWORD" supabase-db pg_dump \
  "${connection_args[@]}" \
  --data-only \
  --no-owner \
  --no-privileges \
  --table supabase_migrations.schema_migrations \
  > "$temporary_dir/data.sql"

{
  printf 'CREATE SCHEMA IF NOT EXISTS supabase_migrations;\n'
  cat "$temporary_dir/schema.sql" "$temporary_dir/data.sql"
} > "$output_file"
chmod 600 "$output_file"
unset SUPABASE_DB_PASSWORD
echo "Managed migration history exported to $output_file"
