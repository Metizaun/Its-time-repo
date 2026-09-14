#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
work_root="${MIGRATION_WORK_ROOT:-/opt/supabase-migration}"
secrets_file="${MIGRATION_SECRETS_FILE:-$work_root/migration-secrets.env}"
python_bin="${STORAGE_COPY_PYTHON:-$work_root/venv-boto3/bin/python}"

[ -s "$secrets_file" ] || { echo "Missing $secrets_file" >&2; exit 1; }
[ -x "$python_bin" ] || { echo "Missing Python environment: $python_bin" >&2; exit 1; }
[ -s "$install_dir/.env" ] || { echo "Missing $install_dir/.env" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a
SELFHOST_SERVICE_ROLE_KEY=$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$install_dir/.env" | tail -1)
export SELFHOST_SERVICE_ROLE_KEY

"$python_bin" "$work_root/copy-storage-via-api.py" "$@"
unset SELFHOST_SERVICE_ROLE_KEY PLATFORM_S3_ACCESS_KEY_ID PLATFORM_S3_SECRET_ACCESS_KEY
