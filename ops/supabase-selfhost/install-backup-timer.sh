#!/usr/bin/env sh
set -eu

install_dir="${1:-/opt/supabase-selfhost}"
chmod 0750 "$install_dir/hourly-backup.sh"
install -m 0644 "$install_dir/itstime-supabase-backup.service" /etc/systemd/system/itstime-supabase-backup.service
install -m 0644 "$install_dir/itstime-supabase-backup.timer" /etc/systemd/system/itstime-supabase-backup.timer
systemctl daemon-reload
systemctl enable itstime-supabase-backup.timer
echo "Backup timer installed but not started; start it only after the self-hosted database is live"
