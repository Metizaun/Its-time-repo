#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

work_root="${BACKUP_WORK_ROOT:-/opt/supabase-migration/backups}"
recipient_file="${BACKUP_AGE_RECIPIENT_FILE:-/opt/supabase-migration/backup-age-recipient.txt}"
ssh_key="${BACKUP_SSH_KEY:-/root/.ssh/itstime-supabase-backup-ed25519}"
backup_host="${BACKUP_HOST:-72.60.251.89}"
backup_user="${BACKUP_USER:-supabase-backup}"
remote_root="${BACKUP_REMOTE_ROOT:-/srv/itstime-supabase-backups}"
storage_dir="${SUPABASE_STORAGE_DIR:-/opt/supabase-selfhost/volumes/storage}"

exec 9>/run/lock/itstime-supabase-backup.lock
flock -n 9 || { echo "A backup is already running"; exit 0; }

for command_name in docker age sha256sum ssh scp; do
  command -v "$command_name" >/dev/null || { echo "Missing command: $command_name" >&2; exit 1; }
done
[ -s "$recipient_file" ] || { echo "Missing age recipient" >&2; exit 1; }
[ -s "$ssh_key" ] || { echo "Missing backup SSH key" >&2; exit 1; }

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
hour=$(date -u +%H)
weekday=$(date -u +%u)
day=$(date -u +%d)
mkdir -p "$work_root"
tmp_dir=$(mktemp -d "$work_root/.tmp-$timestamp-XXXXXX")
trap 'rm -rf -- "$tmp_dir"' EXIT
archive="supabase-$timestamp.tar.zst.age"

chmod 700 "$work_root" "$tmp_dir"

docker inspect supabase-db >/dev/null
docker exec supabase-db pg_isready -U postgres -d postgres >/dev/null
docker exec supabase-db pg_dumpall -U postgres --roles-only > "$tmp_dir/globals.sql"
docker exec supabase-db pg_dump -U postgres -d postgres --format=custom --no-password -f /tmp/database.dump
docker cp supabase-db:/tmp/database.dump "$tmp_dir/database.dump"
docker exec supabase-db rm -f /tmp/database.dump
[ -d "$storage_dir" ] || { echo "Missing Storage directory: $storage_dir" >&2; exit 1; }
tar -C "$storage_dir" -cf "$tmp_dir/storage.tar" .

(
  cd "$tmp_dir"
  sha256sum globals.sql database.dump storage.tar > CONTENT_SHA256SUMS
  tar -cf - globals.sql database.dump storage.tar CONTENT_SHA256SUMS \
    | zstd -T0 -q \
    | age -r "$(cat "$recipient_file")" -o "$archive"
  sha256sum "$archive" > "$archive.sha256"
)

ssh_opts=(-i "$ssh_key" -o BatchMode=yes -o StrictHostKeyChecking=yes)
upload_category() {
  category="$1"
  ssh "${ssh_opts[@]}" "$backup_user@$backup_host" "install -d -m 700 '$remote_root/$category'"
  scp "${ssh_opts[@]}" "$tmp_dir/$archive" "$tmp_dir/$archive.sha256" "$backup_user@$backup_host:$remote_root/$category/"
  ssh "${ssh_opts[@]}" "$backup_user@$backup_host" "cd '$remote_root/$category' && sha256sum -c '$archive.sha256'"
}

upload_category hourly
[ "$hour" = "02" ] && upload_category daily
[ "$hour" = "02" ] && [ "$weekday" = "7" ] && upload_category weekly
[ "$hour" = "02" ] && [ "$day" = "01" ] && upload_category monthly

ssh "${ssh_opts[@]}" "$backup_user@$backup_host" \
  "find '$remote_root/hourly' -type f -mmin +2880 -delete; \
   find '$remote_root/daily' -type f -mtime +7 -delete 2>/dev/null || true; \
   find '$remote_root/weekly' -type f -mtime +35 -delete 2>/dev/null || true; \
   find '$remote_root/monthly' -type f -mtime +100 -delete 2>/dev/null || true"

echo "Encrypted backup transferred and verified: $archive"
