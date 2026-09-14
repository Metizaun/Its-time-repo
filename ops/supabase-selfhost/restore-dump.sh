#!/usr/bin/env bash
set -Eeuo pipefail

dump_dir="${1:-}"
if [ -z "$dump_dir" ] || [ ! -d "$dump_dir" ]; then
  echo "Usage: $0 /protected/path/to/dump-directory" >&2
  exit 2
fi
if [ "${CONFIRM_RESTORE_TARGET_IS_CLEAN:-}" != "YES" ]; then
  echo "Refusing restore: set CONFIRM_RESTORE_TARGET_IS_CLEAN=YES after verifying the destination is disposable and clean" >&2
  exit 1
fi

for file in roles.sql schema.sql data.sql SHA256SUMS; do
  [ -s "$dump_dir/$file" ] || { echo "Missing or empty $dump_dir/$file" >&2; exit 1; }
done
(cd "$dump_dir" && sha256sum -c SHA256SUMS)

restore_data_file=$(mktemp)
if ! awk '
  /^COPY "storage"\."buckets_vectors" / || /^COPY "storage"\."vector_indexes" / {
    skip = 1
    found++
    next
  }
  skip && $0 == "\\." {
    skip = 0
    next
  }
  skip {
    if ($0 != "") unexpected_data = 1
    next
  }
  { print }
  END {
    if (skip || unexpected_data || found != 2) exit 42
  }
' "$dump_dir/data.sql" > "$restore_data_file"; then
  rm -f -- "$restore_data_file"
  echo "Refusing restore: unsupported Storage vector tables were not both empty" >&2
  exit 1
fi
echo "Prepared restore data without the two empty, unsupported Storage vector tables"

container_dir="/tmp/itstime-migration-$(date -u +%Y%m%dT%H%M%SZ)"
docker exec supabase-db mkdir -p "$container_dir"
trap 'rm -f -- "$restore_data_file"; docker exec supabase-db rm -rf -- "$container_dir" >/dev/null 2>&1 || true' EXIT
docker cp "$dump_dir/roles.sql" "supabase-db:$container_dir/roles.sql"
docker cp "$dump_dir/schema.sql" "supabase-db:$container_dir/schema.sql"
docker cp "$restore_data_file" "supabase-db:$container_dir/data.sql"

started_at=$(date +%s)
docker exec supabase-db psql \
  --username postgres \
  --dbname postgres \
  --single-transaction \
  --variable ON_ERROR_STOP=1 \
  --file "$container_dir/roles.sql" \
  --file "$container_dir/schema.sql" \
  --command 'SET session_replication_role = replica' \
  --file "$container_dir/data.sql"
elapsed=$(( $(date +%s) - started_at ))
echo "Restore completed in $elapsed seconds"
