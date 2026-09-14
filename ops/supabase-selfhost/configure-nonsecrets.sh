#!/usr/bin/env sh
set -eu

install_dir="${1:-/opt/supabase-selfhost}"
env_file="$install_dir/.env"

if [ ! -f "$env_file" ]; then
  echo "Missing $env_file" >&2
  exit 1
fi

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

set_env SUPABASE_PUBLIC_URL "https://supa.itstime.pro"
set_env API_EXTERNAL_URL "https://supa.itstime.pro/auth/v1"
set_env SITE_URL "https://app.itstime.pro"
set_env ADDITIONAL_REDIRECT_URLS "https://app.itstime.pro/auth"
set_env STUDIO_DEFAULT_ORGANIZATION "Its Time"
set_env STUDIO_DEFAULT_PROJECT "CRM Its Time"
set_env SMTP_ADMIN_EMAIL "matheus@itstime.pro"
set_env SMTP_HOST "smtp.hostinger.com"
set_env SMTP_PORT "465"
set_env SMTP_USER "matheus@itstime.pro"
set_env SMTP_SENDER_NAME "Its Time"
set_env ENABLE_EMAIL_SIGNUP "true"
set_env ENABLE_EMAIL_AUTOCONFIRM "false"
set_env DISABLE_SIGNUP "false"
set_env REGION "stub"
set_env GLOBAL_S3_BUCKET "stub"
set_env COMPOSE_FILE "docker-compose.yml:docker-compose.production.yml"

chmod 600 "$env_file"

echo "Configured non-secret production values in $env_file"
