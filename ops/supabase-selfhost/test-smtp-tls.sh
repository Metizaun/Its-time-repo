#!/usr/bin/env bash
set -Eeuo pipefail

container_env=$(docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}')
smtp_host=$(printf '%s\n' "$container_env" | sed -n 's/^GOTRUE_SMTP_HOST=//p')
smtp_port=$(printf '%s\n' "$container_env" | sed -n 's/^GOTRUE_SMTP_PORT=//p')
: "${smtp_host:?Missing SMTP host in Auth container}"
: "${smtp_port:?Missing SMTP port in Auth container}"

if timeout 15 openssl s_client \
    -connect "$smtp_host:$smtp_port" \
    -servername "$smtp_host" \
    </dev/null 2>/dev/null \
    | grep -q 'Verify return code: 0 (ok)'; then
  echo "smtp_tls=verified"
else
  echo "smtp_tls=failed" >&2
  exit 1
fi
