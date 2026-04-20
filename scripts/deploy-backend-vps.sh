#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
API_DIR="${API_DIR:-$APP_DIR/Project/IA}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-itstime-api}"
API_PORT="${API_PORT:-3000}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-false}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '\n[ERRO] %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Comando obrigatorio ausente: $1"
}

require_command npm
require_command node
require_command pm2
require_command curl

[[ -d "$API_DIR" ]] || fail "Pasta do backend nao encontrada em $API_DIR"

if [[ ! -f "$APP_DIR/.env.local" ]]; then
  fail "Arquivo $APP_DIR/.env.local nao encontrado. Crie o arquivo antes do deploy."
fi

if [[ "$SKIP_GIT_PULL" != "true" && -d "$APP_DIR/.git" ]]; then
  require_command git
  log "Atualizando codigo da branch $GIT_BRANCH"
  cd "$APP_DIR"
  git fetch "$GIT_REMOTE"
  git checkout "$GIT_BRANCH"
  git pull --ff-only "$GIT_REMOTE" "$GIT_BRANCH"
else
  log "Etapa de git ignorada"
fi

log "Instalando dependencias do backend"
cd "$API_DIR"
npm ci

log "Gerando build do backend"
npm run build

log "Subindo processo no PM2"
if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env
else
  pm2 start dist/api-server.js --name "$PM2_APP_NAME" --cwd "$API_DIR"
fi

pm2 save >/dev/null

log "Status atual do PM2"
pm2 status "$PM2_APP_NAME"

log "Testando healthcheck local"
HEALTH_RESPONSE="$(curl --fail --silent --show-error "http://127.0.0.1:${API_PORT}/health")" \
  || fail "Healthcheck falhou em http://127.0.0.1:${API_PORT}/health"

printf '%s\n' "$HEALTH_RESPONSE"

log "Deploy do backend concluido"
