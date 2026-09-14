#!/usr/bin/env bash
set -Eeuo pipefail

image_file="/var/lib/itstime-supabase-data.ext4"
mount_dir="/srv/itstime-supabase-data"
db_source="$mount_dir/postgres"
storage_source="$mount_dir/storage"
db_target="/opt/supabase-selfhost/volumes/db/data"
storage_target="/opt/supabase-selfhost/volumes/storage"
size="20G"

[ "$(id -u)" -eq 0 ] || { echo "Run as root" >&2; exit 1; }

if [ ! -e "$image_file" ]; then
  fallocate -l "$size" "$image_file"
  chmod 600 "$image_file"
  mkfs.ext4 -F -L itstime-supabase-data "$image_file" >/dev/null
  # mkfs may discard sparse extents; allocate again so the host really reserves 20 GiB.
  fallocate -l "$size" "$image_file"
fi

mkdir -p "$mount_dir"
fstab_line="$image_file $mount_dir ext4 loop,nofail,noatime 0 2"
grep -Fqx "$fstab_line" /etc/fstab || printf '%s\n' "$fstab_line" >> /etc/fstab
mountpoint -q "$mount_dir" || mount "$mount_dir"

mkdir -p "$db_source" "$storage_source" "$db_target" "$storage_target"
chmod 755 "$db_source" "$storage_source"

for target in "$db_target" "$storage_target"; do
  if ! mountpoint -q "$target" && [ -n "$(find "$target" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    echo "Refusing to hide non-empty directory: $target" >&2
    exit 1
  fi
done

db_bind_line="$db_source $db_target none bind,x-systemd.requires-mounts-for=$mount_dir 0 0"
storage_bind_line="$storage_source $storage_target none bind,x-systemd.requires-mounts-for=$mount_dir 0 0"
grep -Fqx "$db_bind_line" /etc/fstab || printf '%s\n' "$db_bind_line" >> /etc/fstab
grep -Fqx "$storage_bind_line" /etc/fstab || printf '%s\n' "$storage_bind_line" >> /etc/fstab
mountpoint -q "$db_target" || mount "$db_target"
mountpoint -q "$storage_target" || mount "$storage_target"

available=$(df -h --output=avail "$mount_dir" | tail -1 | xargs)
echo "Supabase persistent data volume mounted; available space: $available"
