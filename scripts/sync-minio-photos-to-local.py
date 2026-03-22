#!/usr/bin/env python3
"""
Sync QField photos from MinIO to local storage.

Copies construction_qa_photos with source='qfield' and storage_url IS NULL
from MinIO (via docker exec mc cat) to /home/velo/storage/qa-photos/{project}/{pole}/{filename},
then updates the DB record to source='local'.

This eliminates slow docker exec proxying — local files serve instantly via
the photo-proxy's 'local' source handler.

Usage:
  python3 scripts/sync-minio-photos-to-local.py [--dry-run] [--limit 1000] [--project lawley]

Requires: psycopg2, docker with qfieldcloud-minio-1 container accessible
Cron:     */30 * * * * cd /home/hein/Workspace/FF_Next.js && python3 scripts/sync-minio-photos-to-local.py --limit 500 >> /var/log/fibreflow/minio-photo-sync.log 2>&1
"""

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# Unbuffered stdout for cron/background visibility
sys.stdout.reconfigure(line_buffering=True)

import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

MINIO_BUCKET = "qfieldcloud-prod"
MINIO_CONTAINER = "qfieldcloud-minio-1"
STORAGE_ROOT = Path("/home/velo/storage/qa-photos")

def build_project_slug_map(cur) -> dict[str, str]:
    """Build QF project UUID → local directory slug map from DB.

    Joins qfield_projects → qfield_project_links → projects to get
    the project name, then lowercases it for the local directory slug.
    """
    cur.execute("""
        SELECT qp.qfield_project_id, LOWER(TRIM(p.project_name)) AS slug
        FROM qfield_project_links qpl
        JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
        JOIN projects p ON p.id = qpl.fibreflow_project_id
        WHERE qp.is_active = true
    """)
    return {row["qfield_project_id"]: row["slug"] for row in cur.fetchall()}


# ── Helpers ───────────────────────────────────────────────────────────────────

def extract_qf_project_id(storage_key: str) -> str | None:
    """Extract QFieldCloud project UUID from storage key.

    Format: projects/{uuid}/files/DCIM/{filename}[/{version}]
    """
    parts = storage_key.strip("/").split("/")
    if len(parts) >= 2 and parts[0] == "projects":
        return parts[1]
    return None


def extract_filename(storage_key: str) -> str | None:
    """Extract bare filename from storage key.

    projects/{uuid}/files/DCIM/IMG_0001.jpg          -> IMG_0001.jpg
    projects/{uuid}/files/DCIM/IMG_0001.jpg/v202...  -> IMG_0001.jpg
    """
    parts = storage_key.strip("/").split("/")
    if len(parts) >= 5 and parts[0] == "projects" and parts[2] == "files" and parts[3] == "DCIM":
        filename = parts[4]
        # If filename looks like a version segment (v2026...), it's likely a corrupt key
        if filename.startswith("v20") and "." not in filename:
            return None
        return filename
    return None


def derive_filename_from_key(storage_key: str) -> str:
    """Best-effort filename extraction, handles versioned and unversioned keys."""
    fn = extract_filename(storage_key)
    if fn:
        return fn
    # Fallback: last segment that looks like a real filename
    for seg in reversed(storage_key.strip("/").split("/")):
        if "." in seg and not seg.startswith("v20"):
            return seg
    return "photo.jpg"


def resolve_versioned_key(storage_key: str) -> str:
    """If key has no version segment, try to resolve the latest from MinIO."""
    parts = storage_key.strip("/").split("/")

    # Already versioned (has v2... segment after filename)
    if len(parts) >= 6 and parts[5].startswith("v"):
        return storage_key

    # Try listing versions
    mc_path = f"local/{MINIO_BUCKET}/{storage_key.strip('/')}/"
    try:
        result = subprocess.run(
            ["docker", "exec", MINIO_CONTAINER, "mc", "ls", mc_path],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return storage_key

        lines = result.stdout.strip().split("\n")
        for line in reversed(lines):
            seg = line.strip().split()[-1].rstrip("/")
            if seg.startswith("v"):
                return f"{storage_key.strip('/')}/{seg}"

    except Exception:
        pass

    return storage_key


def download_from_minio(storage_key: str, verbose: bool = False) -> bytes | None:
    """Download a photo binary from MinIO via docker exec mc cat."""
    key = resolve_versioned_key(storage_key)
    mc_path = f"local/{MINIO_BUCKET}/{key.strip('/')}"

    try:
        result = subprocess.run(
            ["docker", "exec", MINIO_CONTAINER, "mc", "cat", mc_path],
            capture_output=True, timeout=30,
        )

        if result.returncode != 0:
            if verbose:
                stderr = result.stderr.decode("utf-8", errors="replace")[:200] if result.stderr else ""
                print(f"    mc cat failed ({result.returncode}): {stderr}")
            return None

        data = result.stdout
        if not data or len(data) < 100:
            if verbose:
                print(f"    mc cat returned {len(data) if data else 0} bytes (too small)")
            return None

        # Verify image magic bytes
        is_jpeg = data[0] == 0xFF and data[1] == 0xD8 and data[2] == 0xFF
        is_png = data[0] == 0x89 and data[1] == 0x50 and data[2] == 0x4E and data[3] == 0x47
        if not is_jpeg and not is_png:
            if verbose:
                print(f"    Not a valid image (magic: {data[:4].hex()})")
            return None

        return data

    except subprocess.TimeoutExpired:
        if verbose:
            print(f"    mc cat timed out")
        return None
    except Exception as e:
        if verbose:
            print(f"    mc cat error: {e}")
        return None


def save_locally(project_slug: str, pole_number: str, filename: str, data: bytes) -> Path:
    """Save photo to local storage and return the relative storage key."""
    dest_dir = STORAGE_ROOT / project_slug / pole_number
    dest_dir.mkdir(parents=True, exist_ok=True)

    dest_file = dest_dir / filename
    dest_file.write_bytes(data)
    return dest_file


# ── Main sync logic ──────────────────────────────────────────────────────────

def sync_photos(db_url: str, dry_run: bool = False, limit: int = 500, project_filter: str | None = None, verbose: bool = False):
    """Sync QField photos from MinIO to local storage."""
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print(f"\n{'=' * 70}")
    print(f"  MinIO → Local Photo Sync")
    print(f"  Started: {now}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"  Limit: {limit}")
    if project_filter:
        print(f"  Project filter: {project_filter}")
    print(f"{'=' * 70}\n")

    # ── 0. Build project slug map from DB ─────────────────────────────────────
    project_slug_map = build_project_slug_map(cur)
    print(f"  Project mappings loaded: {len(project_slug_map)}")

    # ── 1. Fetch photos to sync ───────────────────────────────────────────────
    query = """
        SELECT
            cqp.id,
            cqp.storage_key,
            cqp.filename,
            cqr.feature_id AS pole_number,
            p.project_name
        FROM construction_qa_photos cqp
        JOIN construction_qa_reviews cqr ON cqr.id = cqp.review_id
        JOIN projects p ON p.id = cqp.project_id
        WHERE cqp.source = 'qfield'
          AND cqp.upload_status = 'available'
          AND cqp.storage_url IS NULL
    """
    params = []

    if project_filter:
        query += " AND LOWER(p.project_name) = LOWER(%s)"
        params.append(project_filter)

    query += " ORDER BY cqp.created_at DESC LIMIT %s"
    params.append(limit)

    cur.execute(query, params)
    photos = cur.fetchall()

    if not photos:
        print("  No photos to sync. All caught up!")
        cur.close()
        conn.close()
        return

    print(f"  Found {len(photos)} photo(s) to sync.\n")

    # ── 2. Process each photo ─────────────────────────────────────────────────
    stats = {
        "synced": 0,
        "skipped_no_project": 0,
        "skipped_no_pole": 0,
        "skipped_download_fail": 0,
        "skipped_already_exists": 0,
    }

    batch_size = 50
    batch_count = 0

    for i, photo in enumerate(photos):
        photo_id = str(photo["id"])
        storage_key = photo["storage_key"]
        filename = photo["filename"] or derive_filename_from_key(storage_key)
        pole_number = photo["pole_number"]
        project_name = photo["project_name"]

        # Resolve project slug from QF UUID → DB map, fallback to project name
        qf_id = extract_qf_project_id(storage_key)
        project_slug = project_slug_map.get(qf_id) if qf_id else None

        if not project_slug and project_name:
            project_slug = project_name.lower().strip()

        if not project_slug:
            stats["skipped_no_project"] += 1
            continue

        if not pole_number:
            stats["skipped_no_pole"] += 1
            continue

        # Check if already exists locally
        local_path = STORAGE_ROOT / project_slug / pole_number / filename
        if local_path.exists():
            # File already on disk — just update DB
            local_key = f"{project_slug}/{pole_number}/{filename}"
            if not dry_run:
                cur.execute("""
                    UPDATE construction_qa_photos
                    SET source = 'local',
                        storage_key = %s,
                        updated_at = NOW()
                    WHERE id = %s::uuid
                """, (local_key, photo_id))
                batch_count += 1
            stats["skipped_already_exists"] += 1
            continue

        # Download from MinIO
        if dry_run:
            print(f"  [{i+1}/{len(photos)}] WOULD sync: {pole_number}/{filename}")
            stats["synced"] += 1
            continue

        data = download_from_minio(storage_key, verbose=verbose)
        if not data:
            stats["skipped_download_fail"] += 1
            print(f"  [{i+1}/{len(photos)}] Download failed: {storage_key[:100]}")
            continue

        # Save locally
        save_locally(project_slug, pole_number, filename, data)

        # Update DB: source → local, storage_key → relative local path
        local_key = f"{project_slug}/{pole_number}/{filename}"
        cur.execute("""
            UPDATE construction_qa_photos
            SET source = 'local',
                storage_key = %s,
                updated_at = NOW()
            WHERE id = %s::uuid
        """, (local_key, photo_id))

        batch_count += 1
        stats["synced"] += 1

        # Commit in batches to avoid long transactions
        if batch_count >= batch_size:
            conn.commit()
            batch_count = 0
            print(f"  [{i+1}/{len(photos)}] Committed batch ({stats['synced']} synced so far)")

    # Final commit
    if batch_count > 0 and not dry_run:
        conn.commit()

    # ── 3. Summary ────────────────────────────────────────────────────────────
    print(f"\n{'=' * 70}")
    print(f"  SYNC {'(DRY RUN) ' if dry_run else ''}COMPLETE")
    print(f"  Synced to local:        {stats['synced']}")
    print(f"  Already on disk:        {stats['skipped_already_exists']}")
    print(f"  Download failed:        {stats['skipped_download_fail']}")
    print(f"  No project mapping:     {stats['skipped_no_project']}")
    print(f"  No pole number:         {stats['skipped_no_pole']}")
    print(f"{'=' * 70}\n")

    cur.close()
    conn.close()


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Sync QField photos from MinIO to local storage"
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Report changes without downloading or updating the database",
    )
    parser.add_argument(
        "--limit", type=int, default=500,
        help="Max photos to process per run (default: 500)",
    )
    parser.add_argument(
        "--project", type=str, default=None,
        help="Filter to a specific project (e.g., 'lawley')",
    )
    parser.add_argument(
        "--verbose", "-v", action="store_true",
        help="Show detailed download debug info",
    )
    parser.add_argument(
        "--db-url", type=str, default=None,
        help="PostgreSQL connection string (defaults to DATABASE_URL env var)",
    )
    args = parser.parse_args()

    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: No database URL. Set DATABASE_URL or use --db-url")
        sys.exit(1)

    # Verify MinIO container is accessible
    try:
        result = subprocess.run(
            ["docker", "exec", MINIO_CONTAINER, "mc", "version"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            print(f"ERROR: Cannot reach MinIO container '{MINIO_CONTAINER}'")
            print(f"  {result.stderr.strip()[:200]}")
            sys.exit(1)
    except Exception as e:
        print(f"ERROR: Docker not available: {e}")
        sys.exit(1)

    # Verify storage root exists
    if not STORAGE_ROOT.exists():
        print(f"ERROR: Storage root does not exist: {STORAGE_ROOT}")
        sys.exit(1)

    sync_photos(db_url, dry_run=args.dry_run, limit=args.limit, project_filter=args.project, verbose=args.verbose)


if __name__ == "__main__":
    main()
