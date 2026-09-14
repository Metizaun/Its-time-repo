#!/usr/bin/env bash
set -Eeuo pipefail

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
container_name="${STORAGE_CONTAINER_NAME:-supabase-storage}"

read_file_value() {
  key="$1"
  sed -n "s/^${key}=//p" "$install_dir/.env" | tail -1
}

read_container_value() {
  key="$1"
  docker inspect "$container_name" --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | sed -n "s/^${key}=//p"
}

file_id=$(read_file_value S3_PROTOCOL_ACCESS_KEY_ID)
file_secret=$(read_file_value S3_PROTOCOL_ACCESS_KEY_SECRET)
container_id=$(read_container_value S3_PROTOCOL_ACCESS_KEY_ID)
container_secret=$(read_container_value S3_PROTOCOL_ACCESS_KEY_SECRET)

[ -n "$file_id" ] && [ -n "$file_secret" ]
[ "$file_id" = "$container_id" ] && echo "access_key=match" || echo "access_key=mismatch"
[ "$file_secret" = "$container_secret" ] && echo "secret=match" || echo "secret=mismatch"
printf 'file_lengths=%s,%s container_lengths=%s,%s\n' \
  "${#file_id}" "${#file_secret}" "${#container_id}" "${#container_secret}"
