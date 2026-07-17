#!/usr/bin/env bash
# ============================================================
# QA Photo Evidence Backup (rsync)
# ============================================================
# Backs up the QA photo evidence that FibreFlow serves from local storage.
#
# WHY THIS EXISTS: /srv/storage has no RAID and no backup job. Every other
# backup on this box (db-backup.sh, qfc-pg-backup.sh, bugsink/backup.sh)
# covers a database, not the photo evidence. Once construction_qa_photos
# rows flip source='qfield' -> source='local', /srv/storage holds the ONLY
# copy of that evidence.
#
# DISK TOPOLOGY (this is the whole point — verify before changing paths):
#   /srv/storage -> nvme2n1   (source: qa-photos live here)
#   /srv/data    -> nvme1n1   (destination: a DIFFERENT physical disk)
#   /            -> nvme0n1   (91% full — never a backup target)
# Backing up to the same physical disk protects nothing. Keep SRC and DEST
# on different NVMe devices; `lsblk -o NAME,SIZE,MOUNTPOINT` confirms.
#
# Cron (SAST): 30 1 * * *  /home/velo/fibreflow-production/scripts/backup-qa-photos.sh
# Usage: bash scripts/backup-qa-photos.sh [--dry-run]
# ============================================================

set -euo pipefail

SRC="${QA_PHOTO_STORAGE:-/srv/storage/qa-photos}"
DEST="${QA_PHOTO_BACKUP:-/srv/data/backups/qa-photos}"
LOG_FILE="${QA_PHOTO_BACKUP_LOG:-/srv/data/backups/qa-photos-backup.log}"
MIN_FREE_GB="${MIN_FREE_GB:-60}"

DRY_RUN=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="--dry-run"
fi

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

if [[ ! -d "$SRC" ]]; then
  echo "Source does not exist: $SRC" >&2
  exit 1
fi

mkdir -p "$DEST" "$(dirname "$LOG_FILE")"

# Refuse to back up onto the same physical disk — that is not a backup.
src_dev=$(df --output=source "$SRC" | tail -1)
dest_dev=$(df --output=source "$DEST" | tail -1)
if [[ "$src_dev" == "$dest_dev" ]]; then
  log "FATAL: source and destination are on the same device ($src_dev). Refusing — this would not be a backup."
  exit 1
fi

free_gb=$(df -BG --output=avail "$DEST" | tail -1 | tr -dc '0-9')
if (( free_gb < MIN_FREE_GB )); then
  log "FATAL: only ${free_gb}G free on $DEST (need ${MIN_FREE_GB}G)."
  exit 1
fi

log "Starting QA photo backup: $SRC ($src_dev) -> $DEST ($dest_dev) ${DRY_RUN}"

# NOTE: intentionally NO --delete. This is evidence, not a mirror: a bad
# delete on the source must never propagate and destroy the only other copy.
# The backup is additive; prune deliberately if it ever needs reclaiming.
rsync -a --stats $DRY_RUN "$SRC/" "$DEST/" >>"$LOG_FILE" 2>&1

src_files=$(find "$SRC" -type f | wc -l)
dest_files=$(find "$DEST" -type f | wc -l)
src_size=$(du -sh "$SRC" | cut -f1)
dest_size=$(du -sh "$DEST" | cut -f1)

log "Source: ${src_files} files (${src_size}) | Backup: ${dest_files} files (${dest_size})"

if [[ -z "$DRY_RUN" ]] && (( dest_files < src_files )); then
  log "WARNING: backup has fewer files than source (${dest_files} < ${src_files})."
  exit 1
fi

log "QA photo backup complete."
