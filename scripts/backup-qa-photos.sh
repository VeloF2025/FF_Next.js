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
# DISK TOPOLOGY (this is the whole point — verify before changing paths).
# Mount source -> physical disk (`df --output=source` then `lsblk -no PKNAME`):
#   /srv/storage  /dev/nvme2n1p1 -> nvme2n1   (source: qa-photos live here)
#   /srv/data     /dev/nvme1n1p1 -> nvme1n1   (destination: a DIFFERENT disk)
#   /             /dev/mapper/ubuntu--vg-ubuntu--lv -> nvme0n1  (91% full — never a target)
# Backing up to the same physical disk protects nothing, so the run below
# compares PKNAME and refuses if SRC and DEST share a drive. Note /srv/data and
# /srv/ml are DIFFERENT mount sources on the SAME disk (nvme1n1) — that pair is
# exactly what the PKNAME check exists to reject, and a mount-source comparison
# alone would wave it through.
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
# Compare the underlying DISK (lsblk PKNAME), not just the mount source: two
# different LVs/partitions can sit on one NVMe, which would pass a mount-source
# check while giving zero redundancy against that drive failing.
src_dev=$(df --output=source "$SRC" | tail -1)
dest_dev=$(df --output=source "$DEST" | tail -1)
src_disk=$(lsblk -no PKNAME "$src_dev" 2>/dev/null | head -1 || true)
dest_disk=$(lsblk -no PKNAME "$dest_dev" 2>/dev/null | head -1 || true)

if [[ "$src_dev" == "$dest_dev" ]]; then
  log "FATAL: source and destination are on the same device ($src_dev). Refusing — this would not be a backup."
  exit 1
fi
if [[ -n "$src_disk" && -n "$dest_disk" && "$src_disk" == "$dest_disk" ]]; then
  log "FATAL: source and destination are both on physical disk ${src_disk} (${src_dev} vs ${dest_dev}). Refusing — this would not survive that disk failing."
  exit 1
fi
if [[ -z "$src_disk" || -z "$dest_disk" ]]; then
  log "WARNING: could not resolve a physical disk for ${src_dev} and/or ${dest_dev}; fell back to mount-source comparison only."
fi

# 10#: df can emit zero-padded values, which bash would read as octal.
free_gb=$(df -BG --output=avail "$DEST" | tail -1 | tr -dc '0-9')
if (( 10#${free_gb:-0} < 10#$MIN_FREE_GB )); then
  log "FATAL: only ${free_gb}G free on $DEST (need ${MIN_FREE_GB}G)."
  exit 1
fi

log "Starting QA photo backup: $SRC ($src_dev) -> $DEST ($dest_dev) ${DRY_RUN}"

# NOTE: intentionally NO --delete. This is evidence, not a mirror: a bad
# delete on the source must never propagate and destroy the only other copy.
# The backup is additive; prune deliberately if it ever needs reclaiming.
rsync -a --stats $DRY_RUN "$SRC/" "$DEST/" >>"$LOG_FILE" 2>&1

# `|| true` on every pipeline below: SRC is the LIVE photo directory, so find can
# exit non-zero merely because a file vanished mid-scan. Under `set -euo pipefail`
# that would kill the script here — after rsync already succeeded — with no log
# line saying why. A count is not worth losing the diagnostic trail over.
src_files=$(find "$SRC" -type f 2>/dev/null | wc -l || true)
dest_files=$(find "$DEST" -type f 2>/dev/null | wc -l || true)
src_size=$(du -sh "$SRC" 2>/dev/null | cut -f1 || true)
dest_size=$(du -sh "$DEST" 2>/dev/null | cut -f1 || true)

log "Source: ${src_files} files (${src_size}) | Backup: ${dest_files} files (${dest_size})"

# A zero source count means the enumeration itself failed (the live directory is
# never empty). Say so — otherwise the dest>=src check below trivially passes and
# a broken scan reads as a clean backup.
if (( 10#${src_files:-0} == 0 )); then
  log "WARNING: enumerated 0 source files — scan failed; integrity check skipped."
  exit 1
fi

if [[ -z "$DRY_RUN" ]] && (( 10#${dest_files:-0} < 10#${src_files:-0} )); then
  log "WARNING: backup has fewer files than source (${dest_files} < ${src_files})."
  exit 1
fi

log "QA photo backup complete."
