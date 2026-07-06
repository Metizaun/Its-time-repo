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
BACKEND_UPDATE_ORDER="${BACKEND_UPDATE_ORDER:-start-first}"
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
ELEVENLABS_TTS_ENABLED="${ELEVENLABS_TTS_ENABLED:-false}"
ELEVENLABS_DEFAULT_VOICE_ID="${ELEVENLABS_DEFAULT_VOICE_ID:-}"
ELEVENLABS_TTS_MODEL="${ELEVENLABS_TTS_MODEL:-eleven_flash_v2_5}"
ELEVENLABS_OUTPUT_FORMAT="${ELEVENLABS_OUTPUT_FORMAT:-mp3_44100_128}"
TOOL_MEDIA_ALLOWED_HOSTS="${TOOL_MEDIA_ALLOWED_HOSTS:-}"
VISAGISM_TOOL_ENABLED="${VISAGISM_TOOL_ENABLED:-false}"
VISAGISM_INTERNAL_RUNTIME_ENABLED="${VISAGISM_INTERNAL_RUNTIME_ENABLED:-true}"
VISAGISM_ANALYSIS_WORKER_MODEL="${VISAGISM_ANALYSIS_WORKER_MODEL:-gemini-2.5-flash}"
VISAGISM_MATCHING_WORKER_MODEL="${VISAGISM_MATCHING_WORKER_MODEL:-gemini-2.5-flash}"
VISAGISM_IMAGE_WORKER_MODEL="${VISAGISM_IMAGE_WORKER_MODEL:-gpt-image-1}"
PRESCRIPTION_WORKER_ENABLED="${PRESCRIPTION_WORKER_ENABLED:-true}"
PRESCRIPTION_WORKER_MODEL="${PRESCRIPTION_WORKER_MODEL:-gemini-2.5-flash}"
BI_PROJECTION_WORKER_ENABLED="${BI_PROJECTION_WORKER_ENABLED:-false}"
BI_PROJECTION_BATCH_SIZE="${BI_PROJECTION_BATCH_SIZE:-100}"
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
require_env_value GUPSHUP_WEBHOOK_SECRET
require_env_value WEBHOOK_PUBLIC_BASE_URL
require_env_value CORS_ORIGINS

if [[ "$ELEVENLABS_TTS_ENABLED" == "true" ]]; then
  require_env_value ELEVENLABS_API_KEY
fi

if [[ "$VISAGISM_TOOL_ENABLED" == "true" ]]; then
  require_env_value OPENAI_API_KEY
fi

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
export OPENAI_API_KEY="${OPENAI_API_KEY:-}"
export OPENAI_TRANSCRIPTION_MODEL="${OPENAI_TRANSCRIPTION_MODEL:-gpt-4o-mini-transcribe}"
export OPENAI_VISION_MODEL="${OPENAI_VISION_MODEL:-gpt-4.1-mini}"
export ELEVENLABS_TTS_ENABLED
export ELEVENLABS_API_KEY="${ELEVENLABS_API_KEY:-}"
export ELEVENLABS_DEFAULT_VOICE_ID
export ELEVENLABS_TTS_MODEL
export ELEVENLABS_OUTPUT_FORMAT
export TOOL_MEDIA_ALLOWED_HOSTS
export VISAGISM_TOOL_ENABLED
export VISAGISM_INTERNAL_RUNTIME_ENABLED
export VISAGISM_ANALYSIS_WORKER_MODEL
export VISAGISM_MATCHING_WORKER_MODEL
export VISAGISM_IMAGE_WORKER_MODEL
export PRESCRIPTION_WORKER_ENABLED
export PRESCRIPTION_WORKER_MODEL
export REDIS_URL_FOR_CONTAINER
export EVOLUTION_API_URL
export EVOLUTION_API_KEY
export EVOLUTION_WEBHOOK_SECRET="${EVOLUTION_WEBHOOK_SECRET:-}"
export GUPSHUP_WEBHOOK_SECRET
export META_PROVIDER_MODE="${META_PROVIDER_MODE:-mock}"
export META_GRAPH_API_VERSION="${META_GRAPH_API_VERSION:-v20.0}"
export META_WEBHOOK_VERIFY_TOKEN="${META_WEBHOOK_VERIFY_TOKEN:-local-dev-verify-token}"
export META_WEBHOOK_APP_SECRET="${META_WEBHOOK_APP_SECRET:-}"
export META_WEBHOOK_APP_SECRET_REF="${META_WEBHOOK_APP_SECRET_REF:-}"
export META_TEMPLATES_FIXTURE_PATH="${META_TEMPLATES_FIXTURE_PATH:-}"
export WEBHOOK_PUBLIC_BASE_URL
export CORS_ORIGINS
export API_PORT
export AUTOMATION_WORKER_ENABLED
export AUTOMATION_WORKER_POLL_MS
export AUTOMATION_WORKER_BATCH_SIZE
export BI_PROJECTION_WORKER_ENABLED
export BI_PROJECTION_BATCH_SIZE
export BACKEND_IMAGE
export BACKEND_REPLICAS
export BACKEND_UPDATE_ORDER
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
