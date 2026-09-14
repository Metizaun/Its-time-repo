#!/usr/bin/env sh
set -eu

install_dir="${1:-/opt/supabase-selfhost}"
secrets_file="${2:-/opt/supabase-migration/migration-secrets.env}"
env_file="$install_dir/.env"

if [ ! -f "$env_file" ] || [ ! -f "$secrets_file" ]; then
  echo "Missing protected .env or migration secrets file" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root so the secret files remain root-only" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a

require_secret() {
  eval "value=\${$1:-}"
  if [ -z "$value" ]; then
    echo "Missing required secret: $1" >&2
    exit 1
  fi
}

require_secret SMTP_PASSWORD

set_env() {
  key="$1"
  value="$2"
  escaped_value=$(printf '%s' "$value" | sed 's/[&|]/\\&/g')
  if grep -q "^${key}=" "$env_file"; then
    sed -i "s|^${key}=.*|${key}=${escaped_value}|" "$env_file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

set_env SMTP_PASS "$SMTP_PASSWORD"

chmod 600 "$env_file" "$secrets_file"
echo "Runtime secrets applied without printing their values"
