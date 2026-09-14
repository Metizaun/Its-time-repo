#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

project_ref="${SUPABASE_PROJECT_REF:-hvziqfbnkicryfndoepk}"
pooler_host="${SUPABASE_POOLER_HOST:-aws-1-sa-east-1.pooler.supabase.com}"
pooler_port="${SUPABASE_POOLER_PORT:-5432}"
work_root="${MIGRATION_WORK_ROOT:-/opt/supabase-migration}"
secrets_file="${MIGRATION_SECRETS_FILE:-$work_root/migration-secrets.env}"
recipient_file="${BACKUP_AGE_RECIPIENT_FILE:-$work_root/backup-age-recipient.txt}"

for command_name in supabase jq age sha256sum docker; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done

[ -f "$secrets_file" ] || { echo "Missing $secrets_file" >&2; exit 1; }
[ -f "$recipient_file" ] || { echo "Missing $recipient_file" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD is required}"

encoded_password=$(printf '%s' "$SUPABASE_DB_PASSWORD" | jq -sRr @uri)
db_url="postgresql://postgres.${project_ref}:${encoded_password}@${pooler_host}:${pooler_port}/postgres"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
dump_dir="$work_root/dumps/$timestamp"
encrypted_file="$work_root/dumps/managed-$timestamp.tar.zst.age"
mkdir -p "$dump_dir"
chmod 700 "$work_root" "$work_root/dumps" "$dump_dir"

started_at=$(date +%s)
supabase db dump --db-url "$db_url" -f "$dump_dir/roles.sql" --role-only
supabase db dump --db-url "$db_url" -f "$dump_dir/schema.sql"
supabase db dump --db-url "$db_url" -f "$dump_dir/data.sql" --use-copy --data-only
SUPABASE_POOLER_HOST="$pooler_host" \
SUPABASE_POOLER_PORT="$pooler_port" \
  "$work_root/export-managed-migrations.sh" "$dump_dir/migrations.sql"
unset db_url encoded_password SUPABASE_DB_PASSWORD

for dump in roles.sql schema.sql data.sql migrations.sql; do
  [ -s "$dump_dir/$dump" ] || { echo "Empty dump: $dump" >&2; exit 1; }
done

(
  cd "$dump_dir"
  sha256sum roles.sql schema.sql data.sql migrations.sql > SHA256SUMS
  supabase --version > TOOL_VERSION
  tar -cf - roles.sql schema.sql data.sql migrations.sql SHA256SUMS TOOL_VERSION \
    | zstd -T0 -q \
    | age -r "$(cat "$recipient_file")" -o "$encrypted_file"
)
sha256sum "$encrypted_file" > "$encrypted_file.sha256"
elapsed=$(( $(date +%s) - started_at ))
printf 'dump_dir=%s\nencrypted_file=%s\nelapsed_seconds=%s\n' "$dump_dir" "$encrypted_file" "$elapsed"
