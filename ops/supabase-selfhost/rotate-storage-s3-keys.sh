#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
env_file="$install_dir/.env"

[ -s "$env_file" ] || { echo "Missing $env_file" >&2; exit 1; }
command -v openssl >/dev/null

set_env_value() {
  key="$1"
  value="$2"
  escaped_value=$(printf '%s' "$value" | sed -e 's/[&|]/\\&/g')
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

set_env_value S3_PROTOCOL_ACCESS_KEY_ID "$(openssl rand -hex 16)"
set_env_value S3_PROTOCOL_ACCESS_KEY_SECRET "$(openssl rand -hex 32)"
chmod 600 "$env_file"

cd "$install_dir"
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --force-recreate --wait storage
echo "Storage S3 protocol keys rotated and container recreated"
