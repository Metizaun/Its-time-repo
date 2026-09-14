#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

secrets_file="${MIGRATION_SECRETS_FILE:-/opt/supabase-migration/migration-secrets.env}"
test_config=$(mktemp)
trap 'rm -f -- "$test_config"' EXIT
set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a

check() {
  label="$1"
  shift
  rm -f -- "$test_config"
  if rclone --config "$test_config" config create test s3 provider Other "$@" --no-output >/dev/null 2>&1; then
    echo "PASS | $label"
  else
    echo "FAIL | $label"
  fi
}

check base
check literal-access-key access_key_id abc
check access-key access_key_id "$PLATFORM_S3_ACCESS_KEY_ID"
check secret-key secret_access_key "$PLATFORM_S3_SECRET_ACCESS_KEY"
check endpoint endpoint "$PLATFORM_S3_ENDPOINT"
check region region "${PLATFORM_S3_REGION:-sa-east-1}"
