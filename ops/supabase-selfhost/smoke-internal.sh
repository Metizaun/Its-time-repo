#!/usr/bin/env bash
set -Eeuo pipefail

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
gateway_ip=$(docker inspect supabase-envoy --format '{{(index .NetworkSettings.Networks "supabase_default").IPAddress}}')
publishable_key=$(sed -n 's/^SUPABASE_PUBLISHABLE_KEY=//p' "$install_dir/.env" | tail -1)
service_role_key=$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$install_dir/.env" | tail -1)
: "${publishable_key:?Missing publishable key}"
: "${service_role_key:?Missing service role key}"

status() {
  name="$1"
  expected="$2"
  shift 2
  actual=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 "$@")
  if [ "$actual" = "$expected" ]; then
    printf 'PASS | %s | HTTP %s\n' "$name" "$actual"
  else
    printf 'FAIL | %s | expected HTTP %s, got %s\n' "$name" "$expected" "$actual" >&2
    return 1
  fi
}

status_denied() {
  name="$1"
  shift
  actual=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 10 "$@")
  case "$actual" in
    401|403|406) printf 'PASS | %s | HTTP %s\n' "$name" "$actual" ;;
    *)
      printf 'FAIL | %s | expected HTTP 401, 403 or 406, got %s\n' "$name" "$actual" >&2
      return 1
      ;;
  esac
}

base_url="http://$gateway_ip:8000"
status auth-health 200 --header "apikey: $publishable_key" "$base_url/auth/v1/health"
status storage-status 200 --header "apikey: $publishable_key" "$base_url/storage/v1/status"
status auth-admin-users 200 \
  --header "apikey: $service_role_key" \
  --header "Authorization: Bearer $service_role_key" \
  "$base_url/auth/v1/admin/users?page=1&per_page=1"
status rest-crm-read 200 \
  --header "apikey: $service_role_key" \
  --header "Authorization: Bearer $service_role_key" \
  --header 'Accept-Profile: crm' \
  "$base_url/rest/v1/leads?select=id&limit=1"
status rest-agenda-service-role-read 200 \
  --header "apikey: $service_role_key" \
  --header "Authorization: Bearer $service_role_key" \
  --header 'Accept-Profile: agenda_sync' \
  "$base_url/rest/v1/connections?select=id&limit=1"
status_denied rest-agenda-anon-denied \
  --header "apikey: $publishable_key" \
  --header "Authorization: Bearer $publishable_key" \
  --header 'Accept-Profile: agenda_sync' \
  "$base_url/rest/v1/connections?select=id&limit=1"
status invitation-rejects-anonymous 401 \
  --request POST \
  --header "apikey: $publishable_key" \
  --header 'content-type: application/json' \
  --data '{}' \
  "$base_url/functions/v1/send-user-invitation"
status buscar-leads-rejects-anonymous 401 \
  --request POST \
  --header "apikey: $publishable_key" \
  --header 'content-type: application/json' \
  --data '{"action":"counter"}' \
  "$base_url/functions/v1/buscar-leads"
status import-leads-rejects-anonymous 401 \
  --request POST \
  --header "apikey: $publishable_key" \
  --header 'content-type: application/json' \
  --data '{}' \
  "$base_url/functions/v1/import-leads-csv"
