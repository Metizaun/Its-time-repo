#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

APP_DIR="${APP_DIR:-$REPO_ROOT}"
API_DOMAIN="${API_DOMAIN:-api.itstime.pro}"
APP_DOMAIN="${APP_DOMAIN:-app.itstime.pro}"
API_PORT="${API_PORT:-3000}"
PM2_APP_NAME="${PM2_APP_NAME:-itstime-api}"
ENABLE_SSL="${ENABLE_SSL:-true}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
NPM_NODE_MAJOR="${NPM_NODE_MAJOR:-20}"
USE_VPS_ENV_LOCAL="${USE_VPS_ENV_LOCAL:-true}"
APP_OWNER="${APP_OWNER:-${SUDO_USER:-$USER}}"

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

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    fail "Execute com sudo: sudo bash scripts/setup-backend-vps.sh"
  fi
}

write_nginx_config() {
  cat > /etc/nginx/sites-available/itstime-api <<EOF
server {
    listen 80;
    server_name ${API_DOMAIN};

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
}

require_root
require_command apt
require_command curl
require_command systemctl

[[ -d "$APP_DIR" ]] || fail "Repositorio nao encontrado em $APP_DIR"
[[ -f "$APP_DIR/scripts/deploy-backend-vps.sh" ]] || fail "Script de deploy nao encontrado em $APP_DIR/scripts"

log "Instalando dependencias do sistema"
apt update
apt install -y nginx curl git
curl -fsSL "https://deb.nodesource.com/setup_${NPM_NODE_MAJOR}.x" | bash -
apt install -y nodejs

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
fi

if [[ "$USE_VPS_ENV_LOCAL" == "true" && -f "$APP_DIR/.env.vps.local" ]]; then
  log "Copiando .env.vps.local para .env.local"
  cp "$APP_DIR/.env.vps.local" "$APP_DIR/.env.local"
fi

[[ -f "$APP_DIR/.env.local" ]] || fail "Arquivo $APP_DIR/.env.local nao encontrado."

log "Ajustando permissao do projeto para $APP_OWNER"
chown -R "$APP_OWNER:$APP_OWNER" "$APP_DIR"

log "Configurando Nginx para ${API_DOMAIN}"
write_nginx_config
ln -sfn /etc/nginx/sites-available/itstime-api /etc/nginx/sites-enabled/itstime-api
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "Executando deploy do backend como $APP_OWNER"
sudo -u "$APP_OWNER" APP_DIR="$APP_DIR" API_PORT="$API_PORT" PM2_APP_NAME="$PM2_APP_NAME" \
  bash "$APP_DIR/scripts/deploy-backend-vps.sh"

if [[ "$ENABLE_SSL" == "true" ]]; then
  log "Instalando Certbot"
  apt install -y certbot python3-certbot-nginx

  if [[ -n "$LETSENCRYPT_EMAIL" ]]; then
    log "Emitindo certificado SSL com email $LETSENCRYPT_EMAIL"
    certbot --nginx --non-interactive --agree-tos -m "$LETSENCRYPT_EMAIL" -d "$API_DOMAIN"
  else
    log "Emitindo certificado SSL sem email"
    certbot --nginx --non-interactive --agree-tos --register-unsafely-without-email -d "$API_DOMAIN"
  fi
fi

log "Testando healthcheck remoto"
curl --fail --silent --show-error "https://${API_DOMAIN}/health" || \
  curl --fail --silent --show-error "http://${API_DOMAIN}/health" || \
  fail "Nao foi possivel validar o healthcheck remoto em ${API_DOMAIN}"

log "Setup concluido"
log "Frontend esperado: https://${APP_DOMAIN}"
log "Backend esperado: https://${API_DOMAIN}"
