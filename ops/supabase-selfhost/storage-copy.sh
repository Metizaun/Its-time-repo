#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

mode="${1:-copy}"
case "$mode" in copy|check|size) ;; *) echo "Usage: $0 [copy|check|size]" >&2; exit 2 ;; esac

buckets=(automation-media chat-attachments collection-imports visagism-catalog)
for bucket in "${buckets[@]}"; do
  case "$mode" in
    copy)
      rclone copy "platform:$bucket" "selfhost:$bucket" \
        --transfers 4 --checkers 8 --checksum --log-level INFO
      ;;
    check)
      rclone check "platform:$bucket" "selfhost:$bucket" --one-way --download
      ;;
    size)
      echo "[$bucket platform]"
      rclone size "platform:$bucket"
      echo "[$bucket selfhost]"
      rclone size "selfhost:$bucket"
      ;;
  esac
done
