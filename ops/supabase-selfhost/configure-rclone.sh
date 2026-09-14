#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
secrets_file="${MIGRATION_SECRETS_FILE:-/opt/supabase-migration/migration-secrets.env}"

[ -s "$install_dir/.env" ] || { echo "Missing $install_dir/.env" >&2; exit 1; }
[ -s "$secrets_file" ] || { echo "Missing $secrets_file" >&2; exit 1; }

read_env_value() {
  key="$1"
  sed -n "s/^${key}=//p" "$install_dir/.env" | tail -1
}

S3_PROTOCOL_ACCESS_KEY_ID=$(read_env_value S3_PROTOCOL_ACCESS_KEY_ID)
S3_PROTOCOL_ACCESS_KEY_SECRET=$(read_env_value S3_PROTOCOL_ACCESS_KEY_SECRET)
selfhost_region=$(read_env_value REGION)

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a

: "${PLATFORM_S3_ACCESS_KEY_ID:?PLATFORM_S3_ACCESS_KEY_ID is required}"
: "${PLATFORM_S3_SECRET_ACCESS_KEY:?PLATFORM_S3_SECRET_ACCESS_KEY is required}"
: "${PLATFORM_S3_ENDPOINT:?PLATFORM_S3_ENDPOINT is required}"
: "${S3_PROTOCOL_ACCESS_KEY_ID:?S3_PROTOCOL_ACCESS_KEY_ID is required}"
: "${S3_PROTOCOL_ACCESS_KEY_SECRET:?S3_PROTOCOL_ACCESS_KEY_SECRET is required}"
platform_region="${PLATFORM_S3_REGION:-sa-east-1}"

mkdir -p /root/.config/rclone
rclone config create platform s3 \
  provider Other env_auth false \
  access_key_id "$PLATFORM_S3_ACCESS_KEY_ID" \
  secret_access_key "$PLATFORM_S3_SECRET_ACCESS_KEY" \
  endpoint "$PLATFORM_S3_ENDPOINT" \
  region "$platform_region" acl private >/dev/null

selfhost_s3_endpoint="${SELFHOST_S3_ENDPOINT:-https://supa.itstime.pro/storage/v1/s3}"
if [ "$selfhost_s3_endpoint" = "internal" ]; then
  gateway_ip=$(docker inspect supabase-envoy --format '{{(index .NetworkSettings.Networks "supabase_default").IPAddress}}')
  selfhost_s3_endpoint="http://$gateway_ip:8000/storage/v1/s3"
elif [ "$selfhost_s3_endpoint" = "storage-internal" ]; then
  storage_ip=$(docker inspect supabase-storage --format '{{(index .NetworkSettings.Networks "supabase_default").IPAddress}}')
  selfhost_s3_endpoint="http://$storage_ip:5000/s3"
fi
rclone config create selfhost s3 \
  provider Other env_auth false \
  access_key_id "$S3_PROTOCOL_ACCESS_KEY_ID" \
  secret_access_key "$S3_PROTOCOL_ACCESS_KEY_SECRET" \
  endpoint "$selfhost_s3_endpoint" \
  region "$selfhost_region" acl private force_path_style true >/dev/null

chmod 600 /root/.config/rclone/rclone.conf
echo "rclone remotes configured without printing credentials"
