#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
work_root="${MIGRATION_WORK_ROOT:-/opt/supabase-migration}"
secrets_file="${MIGRATION_SECRETS_FILE:-$work_root/migration-secrets.env}"
python_bin="${STORAGE_COPY_PYTHON:-$work_root/venv-boto3/bin/python}"

set -a
# shellcheck disable=SC1090
. "$secrets_file"
set +a
SELFHOST_SERVICE_ROLE_KEY=$(sed -n 's/^SERVICE_ROLE_KEY=//p' "$install_dir/.env" | tail -1)
export SELFHOST_SERVICE_ROLE_KEY

"$python_bin" "$work_root/recover-storage-object-via-rest.py" "$@"
unset SELFHOST_SERVICE_ROLE_KEY PLATFORM_SERVICE_ROLE_KEY
