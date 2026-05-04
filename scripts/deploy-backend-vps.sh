#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
API_DIR="${API_DIR:-$APP_DIR/Project/IA}"
STACK_FILE="${STACK_FILE:-$APP_DIR/docker-stack.backend.yml}"
STACK_NAME="${STACK_NAME:-itstime-api}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env.local}"
GIT_REMOTE="${GIT_REMOTE:-origin}"
GIT_BRANCH="${GIT_BRANCH:-main}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-false}"
API_DOMAIN="${API_DOMAIN:-api.itstime.pro}"
TRAEFIK_NETWORK="${TRAEFIK_NETWORK:-lukas_net}"
TRAEFIK_ENTRYPOINTS="${TRAEFIK_ENTRYPOINTS:-websecure}"
TRAEFIK_CERT_RESOLVER="${TRAEFIK_CERT_RESOLVER:-letsencryptresolver}"
TRAEFIK_ROUTER_NAME="${TRAEFIK_ROUTER_NAME:-itstime-api}"
TRAEFIK_SERVICE_NAME="${TRAEFIK_SERVICE_NAME:-itstime-api}"
BACKEND_IMAGE_REPO="${BACKEND_IMAGE_REPO:-chat-query-backend}"
BACKEND_REPLICAS="${BACKEND_REPLICAS:-1}"
SWARM_NODE_HOSTNAME="${SWARM_NODE_HOSTNAME:-$(hostname)}"

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

require_env_value() {
  local var_name="$1"
  local value="${!var_name:-}"
  [[ -n "$value" ]] || fail "Variavel obrigatoria ausente em $ENV_FILE: $var_name"
}

load_env_file() {
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
}

autodetect_redis_url() {
  if docker service ls --format '{{.Name}}' 2>/dev/null | grep -Fxq 'evolution_redis'; then
    printf '%s' 'redis://evolution_redis:6379'
    return 0
  fi

  if docker ps --format '{{.Names}}' 2>/dev/null | grep -Fxq 'evolution_redis'; then
    printf '%s' 'redis://evolution_redis:6379'
    return 0
  fi

  return 1
}

wait_for_service() {
  local service_name="${STACK_NAME}_api"
  local expected="${BACKEND_REPLICAS}/${BACKEND_REPLICAS}"
  local attempt

  for attempt in $(seq 1 24); do
    local replicas
    replicas="$(
      docker service ls --format '{{.Name}} {{.Replicas}}' \
        | awk -v name="$service_name" '$1 == name { print $2 }'
    )"

    if [[ "$replicas" == "$expected" ]]; then
      return 0
    fi

    sleep 5
  done

  docker service ps "$service_name" --no-trunc || true
  fail "Servico $service_name nao ficou saudavel a tempo"
}

require_command docker
require_command curl

[[ -d "$API_DIR" ]] || fail "Pasta do backend nao encontrada em $API_DIR"
[[ -f "$STACK_FILE" ]] || fail "Stack file nao encontrado em $STACK_FILE"
[[ -f "$ENV_FILE" ]] || fail "Arquivo de ambiente nao encontrado em $ENV_FILE."

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

load_env_file

if [[ -z "${SUPABASE_ANON_KEY:-}" && -z "${SUPABASE_KEY:-}" ]]; then
  fail "Defina SUPABASE_ANON_KEY ou SUPABASE_KEY em $ENV_FILE"
fi

SUPABASE_ANON_KEY="${SUPABASE_ANON_KEY:-$SUPABASE_KEY}"
SUPABASE_KEY="${SUPABASE_KEY:-$SUPABASE_ANON_KEY}"
API_PORT="${API_PORT:-${PORT:-3000}}"
AUTOMATION_WORKER_ENABLED="${AUTOMATION_WORKER_ENABLED:-true}"
AUTOMATION_WORKER_POLL_MS="${AUTOMATION_WORKER_POLL_MS:-15000}"
AUTOMATION_WORKER_BATCH_SIZE="${AUTOMATION_WORKER_BATCH_SIZE:-50}"
REDIS_URL_FOR_CONTAINER="${REDIS_URL_FOR_CONTAINER:-${REDIS_URL:-}}"

if [[ -z "$REDIS_URL_FOR_CONTAINER" || "$REDIS_URL_FOR_CONTAINER" =~ ^redis://(localhost|127\.0\.0\.1|::1)(:|/|$) ]]; then
  if AUTODETECTED_REDIS_URL="$(autodetect_redis_url)"; then
    REDIS_URL_FOR_CONTAINER="$AUTODETECTED_REDIS_URL"
    log "Usando Redis Docker detectado automaticamente em $REDIS_URL_FOR_CONTAINER"
  elif [[ -z "$REDIS_URL_FOR_CONTAINER" ]]; then
    fail "Defina REDIS_URL ou REDIS_URL_FOR_CONTAINER apontando para o Redis Docker."
  else
    fail "REDIS_URL aponta para localhost. Em container, use o hostname do Redis Docker, por exemplo redis://evolution_redis:6379"
  fi
fi

require_env_value SUPABASE_URL
require_env_value SUPABASE_SERVICE_ROLE_KEY
require_env_value GEMINI_API_KEY
require_env_value EVOLUTION_API_URL
require_env_value EVOLUTION_API_KEY
require_env_value WEBHOOK_PUBLIC_BASE_URL
require_env_value CORS_ORIGINS

if [[ -d "$APP_DIR/.git" ]]; then
  IMAGE_REF_SUFFIX="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo local)"
else
  IMAGE_REF_SUFFIX="manual"
fi

IMAGE_TAG="${IMAGE_TAG:-${IMAGE_REF_SUFFIX}-$(date '+%Y%m%d%H%M%S')}"
BACKEND_IMAGE="${BACKEND_IMAGE:-${BACKEND_IMAGE_REPO}:${IMAGE_TAG}}"

export SUPABASE_URL
export SUPABASE_ANON_KEY
export SUPABASE_KEY
export SUPABASE_SERVICE_ROLE_KEY
export GEMINI_API_KEY
export REDIS_URL_FOR_CONTAINER
export EVOLUTION_API_URL
export EVOLUTION_API_KEY
export EVOLUTION_WEBHOOK_SECRET="${EVOLUTION_WEBHOOK_SECRET:-}"
export WEBHOOK_PUBLIC_BASE_URL
export CORS_ORIGINS
export API_PORT
export AUTOMATION_WORKER_ENABLED
export AUTOMATION_WORKER_POLL_MS
export AUTOMATION_WORKER_BATCH_SIZE
export BACKEND_IMAGE
export BACKEND_REPLICAS
export API_DOMAIN
export TRAEFIK_NETWORK
export TRAEFIK_ENTRYPOINTS
export TRAEFIK_CERT_RESOLVER
export TRAEFIK_ROUTER_NAME
export TRAEFIK_SERVICE_NAME
export SWARM_NODE_HOSTNAME

log "Usando arquivo de ambiente $ENV_FILE"
log "Gerando imagem Docker $BACKEND_IMAGE"
docker build -f "$API_DIR/Dockerfile" -t "$BACKEND_IMAGE" "$APP_DIR"

log "Validando schema do Supabase antes do deploy"
docker run --rm \
  --env SUPABASE_URL \
  --env SUPABASE_SERVICE_ROLE_KEY \
  --entrypoint node \
  "$BACKEND_IMAGE" \
  dist/schema-preflight.js

log "Publicando stack $STACK_NAME no Docker Swarm"
docker stack deploy -c "$STACK_FILE" "$STACK_NAME"

log "Aguardando o servico ficar saudavel"
wait_for_service

log "Status atual do servico"
docker service ls

log "Testando healthcheck publico"
if curl --fail --silent --show-error "https://${API_DOMAIN}/health"; then
  printf '\n'
elif curl --fail --silent --show-error "http://${API_DOMAIN}/health"; then
  printf '\n'
else
  log "Healthcheck publico ainda nao respondeu. Se for a primeira subida, confira DNS e Traefik."
fi

log "Deploy do backend concluido"
log "Logs: docker service logs -f ${STACK_NAME}_api"
