#!/usr/bin/env bash
set -Eeuo pipefail

install_dir="${SUPABASE_INSTALL_DIR:-/opt/supabase-selfhost}"
min_disk_kb=$((20 * 1024 * 1024))
min_available_mem_kb=$((1024 * 1024))
failed=0

pass() { printf 'PASS | %s\n' "$1"; }
fail() { printf 'FAIL | %s\n' "$1" >&2; failed=1; }

disk_kb=$(df -Pk "$install_dir" | awk 'NR==2 {print $4}')
if [ "$disk_kb" -ge "$min_disk_kb" ]; then pass "20 GiB or more free on the Supabase volume"; else fail "less than 20 GiB free"; fi

available_mem_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
if [ "$available_mem_kb" -ge "$min_available_mem_kb" ]; then pass "1 GiB or more currently available"; else fail "less than 1 GiB currently available"; fi

container_count=$(docker ps -a --filter name='supabase-' --format '{{.Names}}' | wc -l)
if [ "$container_count" -gt 0 ]; then pass "Supabase containers exist"; else fail "no Supabase containers exist"; fi

if docker inspect supabase-envoy >/dev/null 2>&1; then
  pass "Envoy API gateway exists"
else
  fail "supabase-envoy container is missing"
fi

published=$(docker ps --format '{{.Names}}|{{.Ports}}' | grep '^supabase-' | grep -E '0\.0\.0\.0|\[::\]' || true)
if [ -z "$published" ]; then pass "no Supabase container port is bound publicly"; else fail "public Supabase container port found: $published"; fi

unhealthy=$(docker ps --filter name='supabase-' --format '{{.Names}}|{{.Status}}' | grep -Ev 'healthy|Up .*\(health: starting\)' || true)
if [ "$container_count" -gt 0 ]; then
  if [ -z "$unhealthy" ]; then pass "Supabase containers are up/healthy"; else fail "unhealthy or restarting containers: $unhealthy"; fi
fi

container_ids=$(docker ps -aq --filter name='supabase-')
if [ -n "$container_ids" ]; then
  # shellcheck disable=SC2086
  oom=$(docker inspect $container_ids --format '{{.Name}}|{{.State.OOMKilled}}|{{.RestartCount}}' 2>/dev/null | awk -F'|' '$2=="true" || $3+0>0' || true)
else
  oom=""
fi
if [ -z "$oom" ]; then pass "no OOM kill or container restart recorded"; else fail "OOM/restart detected: $oom"; fi

if docker exec supabase-db pg_isready -U postgres -d postgres >/dev/null 2>&1; then
  pass "Postgres accepts connections"
  postgres_version_num=$(docker exec supabase-db psql -U postgres -d postgres -XAtq -c 'show server_version_num')
  if [ "$postgres_version_num" -ge 150000 ]; then
    pass "Postgres 15 or newer"
  else
    fail "Postgres older than 15 is unsupported: $postgres_version_num"
  fi

  required_extensions=$(docker exec supabase-db psql -U postgres -d postgres -XAtq -c \
    "select count(*) from pg_extension where extname in ('pg_cron','pgcrypto')")
  if [ "$required_extensions" = "2" ]; then
    pass "pg_cron and pgcrypto are installed"
  else
    fail "pg_cron and/or pgcrypto are missing"
  fi
else
  fail "Postgres is not ready"
fi

exit "$failed"
