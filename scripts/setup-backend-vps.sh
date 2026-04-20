#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
API_DOMAIN="${API_DOMAIN:-api.itstime.pro}"
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-lukas_net}"
TRAEFIK_CERT_RESOLVER="${TRAEFIK_CERT_RESOLVER:-letsencryptresolver}"
AUTO_CREATE_TRAEFIK_NETWORK="${AUTO_CREATE_TRAEFIK_NETWORK:-false}"
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

require_command docker

[[ -d "$APP_DIR" ]] || fail "Repositorio nao encontrado em $APP_DIR"
[[ -f "$APP_DIR/scripts/deploy-backend-vps.sh" ]] || fail "Script de deploy nao encontrado em $APP_DIR/scripts"
[[ -f "$APP_DIR/.env.local" ]] || fail "Arquivo $APP_DIR/.env.local nao encontrado."

SWARM_STATE="$(docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null || true)"
[[ "$SWARM_STATE" == "active" ]] || fail "Docker Swarm nao esta ativo nesta VPS."

if ! docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1; then
  if [[ "$AUTO_CREATE_TRAEFIK_NETWORK" == "true" ]]; then
    log "Criando rede overlay ${TRAEFIK_NETWORK}"
    docker network create --driver overlay --attachable "$TRAEFIK_NETWORK"
  else
    fail "Rede ${TRAEFIK_NETWORK} nao encontrada. Se ela existir com outro nome, rode TRAEFIK_NETWORK=nome-da-rede bash scripts/setup-backend-vps.sh"
  fi
fi

log "Traefik detectado na rede ${TRAEFIK_NETWORK}"
log "Usando cert resolver ${TRAEFIK_CERT_RESOLVER}"

APP_DIR="$APP_DIR" \
API_DOMAIN="$API_DOMAIN" \
TRAEFIK_NETWORK="$TRAEFIK_NETWORK" \
TRAEFIK_CERT_RESOLVER="$TRAEFIK_CERT_RESOLVER" \
SKIP_GIT_PULL="$SKIP_GIT_PULL" \
  bash "$APP_DIR/scripts/deploy-backend-vps.sh"

log "Setup concluido"
log "Backend esperado: https://${API_DOMAIN}"
