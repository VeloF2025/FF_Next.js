#!/usr/bin/env python3
"""
Extract photo references from QFieldCloud GPKG files and upsert into
qfield_photo_validations with proper feature_id and checklist_step.

Then triggers the FibreFlow ingestion API to create construction_qa_reviews
and construction_qa_photos records.

Usage:
  python3 scripts/extract-gpkg-photos.py [--project "Lawley"] [--dry-run] [--force]
  python3 scripts/extract-gpkg-photos.py --all
"""

import argparse
import os
import re
import sqlite3
import sys
import tempfile
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

# Pure photo-column detection (no DB deps) — unit-tested/CI-gated by
# scripts/test_extract_gpkg_step_detection.py. scripts/ is sys.path[0] when this
# file is run as `python3 scripts/extract-gpkg-photos.py` (the only invocation).
from qfield_step_detection import detect_step_columns, is_photo_value
from qfield_hierarchy_sync import (
    hierarchy_backfill_needed,
    resolve_spatial_pon_map,
    sync_hierarchy,
)

# Pure GPKG family resolution (no MinIO/DB deps) — unit-tested/CI-gated by
# scripts/test_qfield_gpkg_resolution.py. Lets a project survive the crew renaming
# its audit GPKG ("Civil audit.gpkg" → "Civil audit updated_27_07.gpkg").
from qfield_gpkg_resolution import pick_photo_table

# The ingestion allow-list. Lives in its own module so works-qa-coverage-check.py can
# read the SAME source of truth and tell "never registered" apart from "registered but
# resolving nothing". Add new projects THERE, not here.
from qfield_project_registry import ALTERNATE_GPKGS, OPTICAL_GPKGS, PROJECTS

# Storage I/O. Imported BY NAME, not module-qualified: the characterization harness
# monkeypatches these via setattr() on this module, which only works for names bound
# in this namespace. `qfield_gpkg_storage.minio_download_latest(...)` would bypass the
# patch and silently blind the test suite.
# Only the four names this file actually CALLS are imported. The lower-level helpers
# (minio_list_gpkg_versions/_family, qfc_list_dcim_files) are reached from inside the
# storage modules' own namespaces, so importing them here would be dead — and worse
# than dead: it would imply they are patchable from this module, which they are not.
from qfield_gpkg_storage import minio_download_latest, resolve_gpkg_path
from qfield_photo_storage import minio_list_dcim_directory, minio_resolve_photo_version

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get("DATABASE_URL")

# PROJECTS / ALTERNATE_GPKGS / OPTICAL_GPKGS are imported at the top of this file
# from qfield_project_registry. MINIO_BUCKET moved to the storage modules.


# ── Step column detection ─────────────────────────────────────────────────────
# STEP_PATTERNS / OPTICAL_STEP_PATTERNS / EXTRA_PHOTO_PATTERNS / detect_step_columns
# / is_photo_value now live in qfield_step_detection.py (imported at the top) so the
# detection logic is pure and CI-gated by test_extract_gpkg_step_detection.py.


# Keep re-scanning a same-version GPKG while it has pending (not-yet-uploaded) photos, but
# stop once the GPKG is this old — photos still missing after this many days are treated as
# never-coming. Mirrors recheck-pending-uploads.py's MISSING_THRESHOLD_DAYS so a
# permanently-stuck GPKG doesn't force a full re-scan on every cron run forever.
PENDING_RESCAN_MAX_AGE_DAYS = 7


def _gpkg_version_age_days(version):
    """Age in whole days of a QFieldCloud GPKG version like 'v20260624102601-abcd1234'.

    The leading 14 digits are a YYYYMMDDHHMMSS UTC timestamp. Returns None when the
    timestamp can't be parsed — callers then favour re-scanning (correctness over the
    re-scan-cost optimisation)."""
    m = re.match(r"v(\d{14})", version or "")
    if not m:
        return None
    try:
        ts = datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - ts).days




def sqlite_ident(name):
    """Quote a SQLite identifier that came from an untrusted GPKG.

    Table names now reach SQL from the file itself (pick_photo_table's fallback picks
    any layer in sqlite_master), not just from the hard-coded PROJECTS config — so the
    bracket-quoting these queries used is no longer backed by a trusted value. SQLite
    escapes a double quote inside a quoted identifier by doubling it.
    """
    return '"' + str(name).replace('"', '""') + '"'


# ── Main extraction ───────────────────────────────────────────────────────────

def fetch_linked_qf_project_ids(cur, ff_id, primary_qf_id):
    """Return additional QField project UUIDs linked to this FibreFlow project
    (excluding the primary one already being processed). Used so the script can
    resolve photo references against ALL linked QField projects, not just the
    hardcoded primary in PROJECTS. Without this, photos uploaded to an "audit"
    QField project that shares a FibreFlow project with a primary "production"
    QField project are silently skipped as `pending_upload`."""
    cur.execute(
        """
        SELECT qp.qfield_project_id
        FROM qfield_project_links qpl
        JOIN qfield_projects qp ON qp.id = qpl.qfield_project_id
        WHERE qpl.fibreflow_project_id = %s::uuid
          AND qp.qfield_project_id <> %s
          AND qp.is_active = TRUE
        """,
        (ff_id, primary_qf_id),
    )
    return [r["qfield_project_id"] for r in cur.fetchall()]


def extract_project(conn, project_name, config, dry_run=False, force=False):
    """Extract photo references from a project's GPKG and upsert into DB."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    qf_id = config["qf_project_id"]
    ff_id = config["ff_project_id"]

    print(f"\n{'='*60}")
    print(f"Project: {project_name}")
    print(f"  QField: {qf_id}")

    # Crews rename an audit GPKG rather than overwriting it, which silently pins the
    # ingest to a dead file (Mahikeng: 918 photos missed over 5 days). Follow the
    # rename to the newest member of the configured file's family. Every downstream
    # step — sync-state lookup, download, sync-state upsert — must use gpkg_path, not
    # config["gpkg_path"], or the delta check compares against the wrong state row.
    gpkg_path = resolve_gpkg_path(qf_id, config["gpkg_path"])
    print(f"  GPKG:   {gpkg_path}")

    # Check delta — skip if GPKG version unchanged AND nothing was left pending last run.
    # pending_count = photos referenced by the GPKG whose binary had not yet uploaded to
    # MinIO on the previous run. Those binaries arrive asynchronously (technicians sync the
    # GPKG before all photos finish uploading), so a GPKG with outstanding pending photos
    # must be re-scanned even when its version is unchanged — otherwise the late binaries
    # are never ingested until the next GPKG re-upload. See migration 423.
    hierarchy_backfill = hierarchy_backfill_needed(cur, ff_id, config)
    if not force:
        cur.execute(
            "SELECT last_version, pending_count FROM qfield_gpkg_sync_state WHERE qf_project_id = %s AND gpkg_path = %s",
            (qf_id, gpkg_path),
        )
        state = cur.fetchone()
    else:
        state = None

    # Download GPKG
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        version, size = minio_download_latest(qf_id, gpkg_path, tmp_path)
        if not version:
            print(f"  SKIP: Could not download GPKG")
            return 0, 0

        print(f"  Version: {version} ({size // 1024}KB)")

        # Delta check
        if state and state["last_version"] == version and not force:
            pending = state.get("pending_count") or 0
            # Re-scan an unchanged GPKG only while it still has pending photos AND the GPKG
            # is recent. Photos still missing PENDING_RESCAN_MAX_AGE_DAYS after the GPKG was
            # uploaded are treated as never-coming (mirrors recheck-pending-uploads.py's
            # MISSING_THRESHOLD_DAYS), so a permanently-stuck GPKG stops being re-scanned
            # every run. A fresh GPKG upload (new version) restarts the window; an operator
            # can always --force to override.
            version_age = _gpkg_version_age_days(version)
            stale = version_age is not None and version_age > PENDING_RESCAN_MAX_AGE_DAYS
            if (pending == 0 or stale) and not hierarchy_backfill:
                reason = ("Already processed this version" if pending == 0
                          else f"{pending} still pending but GPKG is {version_age}d old "
                               f"(>{PENDING_RESCAN_MAX_AGE_DAYS}d) — giving up")
                print(f"  SKIP: {reason}")
                return 0, 0
            if hierarchy_backfill:
                print("  RE-SCAN: Work QA hierarchy backfill required")
            else:
                print(f"  RE-SCAN: same version but {pending} photo(s) were pending upload last run")

        # Open GPKG
        db = sqlite3.connect(tmp_path)
        db.row_factory = sqlite3.Row

        # Find the table
        table_name = config["table_name"]
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'gpkg%'"
        ).fetchall()]

        if table_name not in tables:
            # Try case-insensitive match
            match = [t for t in tables if t.lower() == table_name.lower()]
            if match:
                table_name = match[0]
            else:
                # A renamed GPKG renames its layer too ('civil_audit' →
                # 'civil_audit_updated_27_07'), so fall back to whichever table
                # actually carries photo columns. Counting rather than guessing
                # also skips GPKG relation side-tables ('civil_audit__civil_audit'),
                # which have none.
                photo_col_counts = {}
                for t in tables:
                    t_cols = [r[1] for r in db.execute(f"PRAGMA table_info({sqlite_ident(t)})").fetchall()]
                    t_steps, t_extra = detect_step_columns(t_cols)
                    photo_col_counts[t] = len(t_steps) + len(t_extra)
                fallback = pick_photo_table(config["table_name"], photo_col_counts, prefer_stem=gpkg_path)
                if fallback:
                    print(f"  TABLE-FALLBACK: '{config['table_name']}' absent; using "
                          f"'{fallback}' ({photo_col_counts[fallback]} photo columns). "
                          f"Available: {tables}")
                    table_name = fallback
                else:
                    print(f"  ERROR: Table '{config['table_name']}' not found and no "
                          f"table has photo columns. Available: {tables}")
                    db.close()
                    return 0, 0

        rows = db.execute(f"SELECT * FROM {sqlite_ident(table_name)}").fetchall()
        columns = rows[0].keys() if rows else []
        label_col = config["label_col"]

        # Detect step columns
        step_cols, extra_cols = detect_step_columns(columns)
        print(f"  Rows: {len(rows)}, Step columns: {len(step_cols)}, Extra photo cols: {len(extra_cols)}")
        for col, (step, label, disc) in sorted(step_cols.items(), key=lambda x: x[1][0]):
            print(f"    Step {step} ({label}, {disc}): {col[:55]}...")

        if not step_cols and not extra_cols:
            print(f"  SKIP: No photo columns detected")
            db.close()
            return 0, 0

        # A layer can carry photo columns and still be the wrong one — the fallback
        # picks by photo-column count, which a sibling form also satisfies. Without the
        # label column every row is skipped later, yet execution would still reach the
        # sync-state upsert and stamp last_version/last_synced_at for a run that
        # ingested nothing: the project then looks freshly synced forever. Bail BEFORE
        # any state is written so the freeze stays visible.
        if rows and label_col not in columns:
            print(f"  ERROR: table '{table_name}' has {len(step_cols) + len(extra_cols)} photo "
                  f"column(s) but no label column '{label_col}' — refusing to record a sync. "
                  f"Columns: {list(columns)[:12]}")
            db.close()
            return 0, 0

        spatial_pon_map = (
            resolve_spatial_pon_map(qf_id)
            if config.get("spatial_pon")
            else {}
        )

        # ── Batch-list MinIO DCIM directory once per project ─────────────────
        # dcim_index maps filename.jpg -> versioned storage key (or absent if not uploaded)
        print(f"  Listing MinIO DCIM directory...")
        dcim_index = minio_list_dcim_directory(qf_id)
        print(f"  MinIO DCIM files found: {len(dcim_index)}")

        # Combined index across primary + every additional linked QField project.
        # Map: filename -> (qf_id_where_found, versioned_storage_key). Primary
        # wins on conflict so that re-runs are stable.
        combined_dcim = {fn: (qf_id, key) for fn, key in dcim_index.items()}
        linked_qf_ids = fetch_linked_qf_project_ids(cur, ff_id, qf_id)
        if linked_qf_ids:
            print(f"  Also searching {len(linked_qf_ids)} linked QField project(s): {linked_qf_ids}")
            for extra_qf in linked_qf_ids:
                extra_idx = minio_list_dcim_directory(extra_qf)
                added = 0
                for fn, key in extra_idx.items():
                    if fn not in combined_dcim:
                        combined_dcim[fn] = (extra_qf, key)
                        added += 1
                print(f"    {extra_qf}: +{added} unique files (had {len(extra_idx)})")

        # Get existing photo keys in qfield_photo_validations across the primary
        # and every linked QField project. Without including the linked ids,
        # photos inserted with `resolved_qf_id != qf_id` (the multi-project
        # resolution added in this commit) would never be dedup-detected on
        # re-run and the cron would pile up duplicates each day. There is no
        # UNIQUE constraint on photo_key — the in-memory `existing_keys` set is
        # the only guard.
        dedup_project_ids = [qf_id] + linked_qf_ids
        cur.execute(
            "SELECT photo_key FROM qfield_photo_validations WHERE project_id = ANY(%s::uuid[])",
            (dedup_project_ids,),
        )
        existing_keys = set(r["photo_key"] for r in cur.fetchall())
        # Build filename-based index for dedup across versioned/unversioned keys
        # e.g. "projects/.../DCIM/file.jpg/v2026..." → "file.jpg"
        existing_filenames = set()
        for k in existing_keys:
            # Strip version suffix if present: .../filename.jpg/v20260408... → filename.jpg
            parts = k.split("/")
            for i, part in enumerate(parts):
                if re.match(r'v\d{14}-', part):
                    # Previous part is the filename
                    if i > 0:
                        existing_filenames.add(parts[i - 1])
                    break
            else:
                # No version suffix — last part is the filename
                if parts:
                    existing_filenames.add(parts[-1])

        # Also get existing photo storage_keys in construction_qa_photos
        cur.execute(
            "SELECT storage_key FROM construction_qa_photos WHERE project_id = %s AND source = 'qfield'",
            (ff_id,),
        )
        existing_photo_keys = set(r["storage_key"] for r in cur.fetchall())

        photos_found = 0
        photos_upserted = 0
        photos_skipped_missing = 0

        def _resolve_key(dcim_path):
            """Return (storage_key, resolved_qf_id, upload_status) for a DCIM-relative path.

            Looks up the combined index across all linked QField projects (primary
            first) so photos uploaded to an "audit" QField project linked to the
            same FibreFlow project are resolved correctly. `resolved_qf_id` is the
            QField project where the blob actually lives — used as the row's
            `project_id` in qfield_photo_validations so future syncs find it.
            """
            filename = dcim_path.replace("DCIM/", "").lstrip("/")
            if combined_dcim:
                entry = combined_dcim.get(filename)
                if entry:
                    resolved_qf_id, versioned = entry
                    return versioned, resolved_qf_id, "available"
                # File referenced in GPKG but absent from every linked MinIO bucket
                return f"projects/{qf_id}/files/{dcim_path}", qf_id, "pending_upload"
            # Batch listing failed — fall back to individual resolution against primary
            versioned = minio_resolve_photo_version(qf_id, dcim_path)
            if versioned:
                return versioned, qf_id, "available"
            return f"projects/{qf_id}/files/{dcim_path}", qf_id, "pending_upload"

        for row in rows:
            feature_id = row[label_col] if label_col in row.keys() else None
            if not feature_id:
                continue
            feature_id = str(feature_id).strip()
            if not feature_id:
                continue

            # Collect photos from step columns
            for col, (step, step_label, discipline) in step_cols.items():
                val = row[col]
                if not is_photo_value(val):
                    continue

                dcim_path = str(val).strip()
                photos_found += 1

                full_key, resolved_qf_id, upload_status = _resolve_key(dcim_path)

                if upload_status == "pending_upload":
                    print(f"    SKIP (not in MinIO): {dcim_path}")
                    photos_skipped_missing += 1
                    continue

                # Skip if already in DB (either validations or photos table)
                base_fn = dcim_path.replace("DCIM/", "").lstrip("/")
                if full_key in existing_keys:
                    continue
                # Filename-based dedup: catches versioned vs unversioned key mismatches
                if base_fn in existing_filenames:
                    continue
                # Check by filename match in existing construction_qa_photos
                if any(base_fn in k for k in existing_photo_keys):
                    continue

                if dry_run:
                    photos_upserted += 1
                    continue

                # Upsert into qfield_photo_validations — use resolved_qf_id so
                # the row points at the QField project where the blob actually
                # lives. Without this, photos hosted in an audit project would
                # be recorded as if owned by the primary project.
                cur.execute("""
                    INSERT INTO qfield_photo_validations
                    (id, photo_key, feature_id, feature_type, work_type, project_id,
                     checklist_step, step_label, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s::uuid, %s, %s, NOW())
                    ON CONFLICT (id) DO NOTHING
                """, (
                    str(uuid.uuid4()), full_key, feature_id,
                    "joint" if discipline == "optical" else "pole",
                    "dome_joint" if discipline == "optical" else "pole_installation",
                    resolved_qf_id,
                    step, step_label,
                ))
                existing_keys.add(full_key)
                existing_filenames.add(base_fn)
                photos_upserted += 1

            # Extra photo columns (no step)
            for col in extra_cols:
                if col not in row.keys():
                    continue
                val = row[col]
                if not is_photo_value(val):
                    continue

                dcim_path = str(val).strip()
                photos_found += 1

                full_key, resolved_qf_id, upload_status = _resolve_key(dcim_path)

                if upload_status == "pending_upload":
                    print(f"    SKIP (not in MinIO): {dcim_path}")
                    photos_skipped_missing += 1
                    continue

                base_fn = dcim_path.replace("DCIM/", "").lstrip("/")
                if full_key in existing_keys:
                    continue
                if base_fn in existing_filenames:
                    continue
                if any(base_fn in k for k in existing_photo_keys):
                    continue

                if dry_run:
                    photos_upserted += 1
                    continue

                cur.execute("""
                    INSERT INTO qfield_photo_validations
                    (id, photo_key, feature_id, feature_type, work_type, project_id,
                     checklist_step, step_label, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s::uuid, %s, %s, NOW())
                    ON CONFLICT (id) DO NOTHING
                """, (
                    str(uuid.uuid4()), full_key, feature_id,
                    "pole", "pole_installation", resolved_qf_id,
                    None, None,
                ))
                existing_keys.add(full_key)
                existing_filenames.add(base_fn)
                photos_upserted += 1

        if photos_skipped_missing:
            print(f"  Skipped {photos_skipped_missing} photos not yet uploaded to MinIO")

        db.close()

        # ── Sync PON/zone assignments into planning, reviews, and Work QA ──
        if not dry_run:
            hierarchy_result = sync_hierarchy(
                cur,
                conn,
                ff_id,
                rows,
                label_col,
                config,
                spatial_pon_map,
            )
            print(
                "  Hierarchy: "
                f"{hierarchy_result['mapped']} GPKG poles mapped; "
                f"{hierarchy_result['qa_poles']} Work QA rows, "
                f"{hierarchy_result['poles']} planning poles, and "
                f"{hierarchy_result['reviews']} reviews changed"
            )

        if not dry_run:
            # Update sync state. pending_count records how many photo references were
            # skipped this run because their binary is not yet in MinIO — so the next run
            # re-scans this GPKG (see the delta check above) and ingests them once they
            # finish uploading, without waiting for a GPKG re-upload.
            cur.execute("""
                INSERT INTO qfield_gpkg_sync_state (qf_project_id, gpkg_path, last_version, last_synced_at, row_count, pending_count)
                VALUES (%s::uuid, %s, %s, NOW(), %s, %s)
                ON CONFLICT (qf_project_id, gpkg_path) DO UPDATE SET
                    last_version = EXCLUDED.last_version,
                    last_synced_at = NOW(),
                    row_count = EXCLUDED.row_count,
                    pending_count = EXCLUDED.pending_count
            """, (qf_id, gpkg_path, version, len(rows), photos_skipped_missing))

            # Retire the row we just superseded. After a redirect the old path keeps a
            # row whose last_version can never advance again — nothing writes to it and
            # nothing deletes it — so the staleness monitor would report it as behind
            # forever, paging on this fix's own success and burying the real signal.
            # Scoped to the configured path of THIS project: the resolver only ever
            # redirects away from that one name.
            if gpkg_path != config["gpkg_path"]:
                cur.execute(
                    "DELETE FROM qfield_gpkg_sync_state WHERE qf_project_id = %s::uuid AND gpkg_path = %s",
                    (qf_id, config["gpkg_path"]),
                )
                if cur.rowcount:
                    print(f"  Retired superseded sync-state row for '{config['gpkg_path']}'")
            conn.commit()

        print(f"  Photos found: {photos_found}, New upserted: {photos_upserted}, Skipped (no MinIO): {photos_skipped_missing}")
        return photos_found, photos_upserted

    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def resolve_unversioned_keys(conn):
    """Resolve unversioned storage keys in both qfield_photo_validations and construction_qa_photos."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Fix qfield_photo_validations
    cur.execute("""
        SELECT DISTINCT photo_key FROM qfield_photo_validations
        WHERE photo_key NOT LIKE '%%/v2%%' AND photo_key IS NOT NULL
    """)
    qpv_keys = [r["photo_key"] for r in cur.fetchall()]

    # Fix construction_qa_photos
    cur.execute("""
        SELECT DISTINCT storage_key FROM construction_qa_photos
        WHERE source = 'qfield' AND storage_key NOT LIKE '%%/v2%%' AND storage_key IS NOT NULL
    """)
    cqp_keys = [r["storage_key"] for r in cur.fetchall()]

    all_keys = set(qpv_keys + cqp_keys)
    if not all_keys:
        return

    print(f"\n  Resolving {len(all_keys)} unversioned storage keys...")
    resolved = 0

    for key in all_keys:
        # Extract project_id and dcim_path from key like projects/{uuid}/files/DCIM/filename.jpg
        parts = key.split("/")
        if len(parts) < 4 or parts[0] != "projects":
            continue
        qf_id = parts[1]
        dcim_path = "/".join(parts[3:])  # DCIM/filename.jpg

        versioned = minio_resolve_photo_version(qf_id, dcim_path)
        if not versioned:
            continue

        # Update both tables
        cur.execute(
            "UPDATE qfield_photo_validations SET photo_key = %s WHERE photo_key = %s",
            (versioned, key),
        )
        cur.execute(
            "UPDATE construction_qa_photos SET storage_key = %s WHERE storage_key = %s",
            (versioned, key),
        )
        resolved += 1

    conn.commit()
    print(f"  Resolved {resolved}/{len(all_keys)} keys to versioned paths")


def main():
    parser = argparse.ArgumentParser(description="Extract GPKG photo references → qfield_photo_validations")
    parser.add_argument("--project", type=str, help="Process single project by name")
    parser.add_argument("--all", action="store_true", help="Process all projects")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    parser.add_argument("--force", action="store_true", help="Skip delta check, reprocess even if version unchanged")
    args = parser.parse_args()

    if not args.project and not args.all:
        print("Usage: --project 'Lawley' or --all")
        sys.exit(1)

    if not DB_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False

    projects_to_run = {}
    if args.project:
        if args.project not in PROJECTS:
            print(f"Unknown project: {args.project}. Available: {list(PROJECTS.keys())}")
            sys.exit(1)
        projects_to_run[args.project] = PROJECTS[args.project]
    else:
        projects_to_run = PROJECTS

    total_found = 0
    total_upserted = 0

    for name, config in projects_to_run.items():
        found, upserted = extract_project(conn, name, config, args.dry_run, args.force)
        total_found += found
        total_upserted += upserted

        # Also try alternate GPKG if available
        if name in ALTERNATE_GPKGS:
            alt = {**config, **ALTERNATE_GPKGS[name]}
            print(f"  Checking alternate GPKG: {alt['gpkg_path']}")
            f2, u2 = extract_project(conn, f"{name} (alt)", alt, args.dry_run, args.force)
            total_found += f2
            total_upserted += u2

        # Also process the per-pole OPTICAL dome-audit GPKG if available
        if name in OPTICAL_GPKGS:
            opt = {**config, **OPTICAL_GPKGS[name]}
            print(f"  Checking optical GPKG: {opt['gpkg_path']}")
            f3, u3 = extract_project(conn, f"{name} (optical)", opt, args.dry_run, args.force)
            total_found += f3
            total_upserted += u3

    # ── Resolve previously-unversioned storage keys ──────────────────────────
    if not args.dry_run:
        resolve_unversioned_keys(conn)

    print(f"\n{'='*60}")
    print(f"TOTAL: {total_found} photos found, {total_upserted} new upserted")
    if args.dry_run:
        print("DRY RUN — no changes written")
    print(f"{'='*60}")

    conn.close()


if __name__ == "__main__":
    main()
