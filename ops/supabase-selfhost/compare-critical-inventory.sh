#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_ref="${SUPABASE_PROJECT_REF:-hvziqfbnkicryfndoepk}"
pooler_host="${SUPABASE_POOLER_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
pooler_port="${SUPABASE_POOLER_PORT:-6543}"
secrets_file="${MIGRATION_SECRETS_FILE:-/opt/supabase-migration/migration-secrets.env}"

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

source_connection="host=$pooler_host port=$pooler_port dbname=postgres user=postgres.$project_ref sslmode=require"

run_source() {
  docker exec -e PGPASSWORD="$SUPABASE_DB_PASSWORD" supabase-db psql \
    "$source_connection" -XAtq -v ON_ERROR_STOP=1 -c "$1"
}

run_destination() {
  docker exec supabase-db psql -U postgres -d postgres -XAtq -v ON_ERROR_STOP=1 -c "$1"
}

critical_sql="
select 'auth_users', count(*)::text from auth.users
union all select 'auth_identities', count(*)::text from auth.identities
union all select 'storage_buckets', count(*)::text from storage.buckets
union all select 'storage_objects', count(*)::text from storage.objects
union all select 'storage_objects_archived', count(*)::text from storage.objects where archived_at is not null
union all select 'storage_delete_markers', count(*)::text from storage.objects where is_delete_marker
union all select 'migrations', count(*)::text from supabase_migrations.schema_migrations
union all select 'latest_migration', max(version) from supabase_migrations.schema_migrations
union all select 'app_triggers', count(*)::text from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in ('agents','agenda_sync','bi','calendar','collections','costs','crm','gupshup','instagram','locator','meta','public','rb')
union all select 'policies', count(*)::text from pg_policies;
"

echo "source"
run_source "$critical_sql"
echo "destination"
run_destination "$critical_sql"
unset SUPABASE_DB_PASSWORD
