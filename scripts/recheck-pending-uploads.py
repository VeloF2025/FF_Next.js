#!/usr/bin/env python3
"""
Recheck construction_qa_photos records that are still waiting for their photo
binary to be uploaded to QFieldCloud MinIO.

Technicians may sync their GPKG data (which records filenames) before the
actual photo files have been uploaded from the field device.  This cron job
runs after every QField sync to promote photos from 'pending_upload' to
'available' once their versioned MinIO entry exists.

Records older than 7 days that are still not found are marked 'missing' so
they are permanently excluded from VLM classification.

Usage:
  python3 scripts/recheck-pending-uploads.py [--dry-run] [--db-url URL]

Requires: psycopg2, docker with qfieldcloud-minio-1 container accessible
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

MINIO_BUCKET = "qfieldcloud-prod"
MINIO_CONTAINER = "qfieldcloud-minio-1"
MISSING_THRESHOLD_DAYS = 7


# ── MinIO helpers ─────────────────────────────────────────────────────────────

def minio_list_dcim_directory(qf_project_id):
    """Batch-list the DCIM directory for a QFieldCloud project in MinIO.

    Returns a dict mapping filename (e.g. 'IMG_0001.jpg') to the latest
    versioned storage key (e.g. 'projects/{uuid}/files/DCIM/IMG_0001.jpg/v202...').

    Returns an empty dict when the directory is inaccessible.
    """
    dcim_prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/DCIM/"
    try:
        result = subprocess.run(
            ["docker", "exec", MINIO_CONTAINER, "mc", "ls", "--recursive", dcim_prefix],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            print(f"    WARN: mc ls DCIM failed for {qf_project_id}: {result.stderr.strip()[:120]}")
            return {}

        # mc ls --recursive output lines (relative to dcim_prefix):
        #   [date] [time]     size  DCIM/IMG_0001.jpg/v20260310120500-7bc5005f
        dcim_files = {}
        for line in result.stdout.strip().split("\n"):
            parts = line.strip().split()
            if not parts:
                continue
            rel_path = parts[-1].rstrip("/")
            # Strip leading DCIM/ when mc includes it
            if rel_path.startswith("DCIM/"):
                rel_path = rel_path[len("DCIM/"):]
            slash_idx = rel_path.rfind("/")
            if slash_idx == -1:
                continue
            filename = rel_path[:slash_idx]
            version_seg = rel_path[slash_idx + 1:]
            if not version_seg.startswith("v"):
                continue
            # Keep latest version (lexicographic sort of ISO-like timestamps)
            existing = dcim_files.get(filename)
            if existing is None or version_seg > existing.rsplit("/", 1)[-1]:
                dcim_files[filename] = (
                    f"projects/{qf_project_id}/files/DCIM/{filename}/{version_seg}"
                )
        return dcim_files
    except Exception as e:
        print(f"    WARN: minio_list_dcim_directory error for {qf_project_id}: {e}")
        return {}


def extract_qf_project_id(storage_key):
    """Extract the QFieldCloud project UUID from a storage key.

    Expected format: projects/{uuid}/files/DCIM/{filename}[/{version}]
    Returns None if the key does not match.
    """
    parts = storage_key.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "projects":
        return parts[1]
    return None


def extract_filename(storage_key):
    """Extract the bare filename from a storage key.

    Examples:
      projects/{uuid}/files/DCIM/IMG_0001.jpg          -> IMG_0001.jpg
      projects/{uuid}/files/DCIM/IMG_0001.jpg/v202...  -> IMG_0001.jpg
    """
    parts = storage_key.strip("/").split("/")
    # parts[4] is the filename when format is: projects / uuid / files / DCIM / filename
    if len(parts) >= 5 and parts[0] == "projects" and parts[2] == "files" and parts[3] == "DCIM":
        return parts[4]
    return None


# ── Main recheck logic ────────────────────────────────────────────────────────

def recheck_pending_uploads(db_url, dry_run=False):
    """Find all pending_upload photos, recheck MinIO, and update status."""
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print(f"\n{'='*70}")
    print(f"  QField Photo Upload Status Recheck")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"  Missing threshold: {MISSING_THRESHOLD_DAYS} days")
    print(f"{'='*70}\n")

    # ── 1. Fetch all pending_upload photos ────────────────────────────────────
    cur.execute("""
        SELECT id, storage_key, created_at
        FROM construction_qa_photos
        WHERE upload_status = 'pending_upload'
        ORDER BY created_at ASC
    """)
    pending = cur.fetchall()

    if not pending:
        print("  No pending_upload photos found. Nothing to do.")
        cur.close()
        conn.close()
        return

    print(f"  Found {len(pending)} pending_upload photo(s).\n")

    # ── 2. Group by QFieldCloud project UUID ─────────────────────────────────
    # Map: qf_project_id -> list of (row_id, storage_key, created_at)
    by_project = {}
    skipped_bad_key = 0
    for row in pending:
        qf_id = extract_qf_project_id(row["storage_key"])
        if not qf_id:
            print(f"    WARN: Cannot extract project UUID from key: {row['storage_key']}")
            skipped_bad_key += 1
            continue
        by_project.setdefault(qf_id, []).append(row)

    print(f"  Projects to recheck: {len(by_project)}")
    if skipped_bad_key:
        print(f"  Skipped {skipped_bad_key} record(s) with unrecognised key format")

    # ── 3. Process each project ───────────────────────────────────────────────
    now_utc = datetime.now(timezone.utc)
    missing_cutoff = now_utc - timedelta(days=MISSING_THRESHOLD_DAYS)

    stats = {
        "promoted": 0,    # pending_upload -> available
        "still_pending": 0,
        "marked_missing": 0,
    }

    for qf_id, rows in by_project.items():
        print(f"\n  Project {qf_id} ({len(rows)} photos)")
        dcim_index = minio_list_dcim_directory(qf_id)
        print(f"    MinIO DCIM entries: {len(dcim_index)}")

        for row in rows:
            photo_id = str(row["id"])
            storage_key = row["storage_key"]
            created_at = row["created_at"]

            # Make created_at timezone-aware for comparison
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)

            filename = extract_filename(storage_key)
            if not filename:
                print(f"    WARN: Cannot extract filename from: {storage_key}")
                continue

            versioned_key = dcim_index.get(filename)

            if versioned_key:
                # File is now in MinIO — promote to available
                print(f"    FOUND  {filename} -> {versioned_key.split('/')[-1]}")
                if not dry_run:
                    cur.execute("""
                        UPDATE construction_qa_photos
                        SET
                            upload_status = 'available',
                            storage_key   = %s,
                            updated_at    = NOW()
                        WHERE id = %s::uuid
                    """, (versioned_key, photo_id))
                stats["promoted"] += 1

            elif created_at < missing_cutoff:
                # Older than threshold and still not found — mark as missing
                age_days = (now_utc - created_at).days
                print(f"    MISSING {filename} (age {age_days}d, threshold {MISSING_THRESHOLD_DAYS}d)")
                if not dry_run:
                    cur.execute("""
                        UPDATE construction_qa_photos
                        SET
                            upload_status = 'missing',
                            updated_at    = NOW()
                        WHERE id = %s::uuid
                    """, (photo_id,))
                stats["marked_missing"] += 1

            else:
                # Still within tolerance window — leave as pending_upload
                age_days = (now_utc - created_at).days
                print(f"    WAITING {filename} (age {age_days}d)")
                stats["still_pending"] += 1

        if not dry_run:
            conn.commit()

    # ── 4. Summary ────────────────────────────────────────────────────────────
    print(f"\n{'='*70}")
    print(f"  RECHECK {'(DRY RUN) ' if dry_run else ''}COMPLETE")
    print(f"  Promoted to available:  {stats['promoted']}")
    print(f"  Still pending:          {stats['still_pending']}")
    print(f"  Marked missing:         {stats['marked_missing']}")
    print(f"  Skipped (bad key):      {skipped_bad_key}")
    print(f"{'='*70}\n")

    cur.close()
    conn.close()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Recheck pending QField photo uploads against MinIO"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report changes without writing to the database",
    )
    parser.add_argument(
        "--db-url",
        type=str,
        default=None,
        help="PostgreSQL connection string (defaults to DATABASE_URL env var)",
    )
    args = parser.parse_args()

    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: No database URL. Set DATABASE_URL or use --db-url")
        sys.exit(1)

    recheck_pending_uploads(db_url, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
