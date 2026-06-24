#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

ENV_FILE="${1:-.env.local}"
SECRET_NAME="${2:-ELEVENLABS_API_KEY}"

if [[ "$SECRET_NAME" != "ELEVENLABS_API_KEY" ]]; then
  printf 'Segredo nao permitido: %s\n' "$SECRET_NAME" >&2
  exit 1
fi

read -r -s -p "Informe ${SECRET_NAME} (a entrada ficara oculta): " SECRET_VALUE
printf '\n'

if [[ -z "$SECRET_VALUE" || ! "$SECRET_VALUE" =~ ^[A-Za-z0-9_-]+$ ]]; then
  printf 'Valor vazio ou com caracteres invalidos.\n' >&2
  exit 1
fi

mkdir -p "$(dirname -- "$ENV_FILE")"
TEMP_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f -- "$TEMP_FILE"' EXIT

if [[ -f "$ENV_FILE" ]]; then
  awk -v name="$SECRET_NAME" -v value="$SECRET_VALUE" '
    BEGIN { found = 0 }
    index($0, name "=") == 1 { print name "=" value; found = 1; next }
    { print }
    END { if (!found) print name "=" value }
  ' "$ENV_FILE" > "$TEMP_FILE"
else
  printf '%s=%s\n' "$SECRET_NAME" "$SECRET_VALUE" > "$TEMP_FILE"
fi

mv -f -- "$TEMP_FILE" "$ENV_FILE"
trap - EXIT
unset SECRET_VALUE
printf '%s gravado em arquivo ignorado pelo Git. O valor nao foi exibido.\n' "$SECRET_NAME"
