#!/usr/bin/env bash
set -Eeuo pipefail

stack_file="${TRAEFIK_STACK_FILE:-/opt/stacks/traefik-v3.yaml}"
[ -s "$stack_file" ] || { echo "Missing $stack_file" >&2; exit 1; }

if ! grep -q -- '--providers.docker.endpoint=unix:///var/run/docker.sock' "$stack_file"; then
  cp -a "$stack_file" "$stack_file.before-supabase-$(date -u +%Y%m%dT%H%M%SZ)"
  sed -i '/--providers.swarm.network=lukas_net/a\      - "--providers.docker.endpoint=unix:///var/run/docker.sock"\n      - "--providers.docker.exposedbydefault=false"\n      - "--providers.docker.network=lukas_net"' "$stack_file"
fi

grep -q -- '--providers.docker.exposedbydefault=false' "$stack_file"
grep -q -- '--providers.docker.network=lukas_net' "$stack_file"
docker stack deploy --detach=true --prune -c "$stack_file" traefik

for _ in $(seq 1 30); do
  replicas=$(docker service ls --filter name=traefik_traefik --format '{{.Replicas}}')
  [ "$replicas" = "1/1" ] && { echo "Traefik Docker provider enabled"; exit 0; }
  sleep 2
done
echo "Traefik did not converge to 1/1" >&2
exit 1
