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
import sys
import tempfile
import uuid

import psycopg2
import psycopg2.extras

# Pure photo-column detection (no DB deps) — unit-tested/CI-gated by
# scripts/test_extract_gpkg_step_detection.py. scripts/ is sys.path[0] when this
# file is run as `python3 scripts/extract-gpkg-photos.py` (the only invocation).
from qfield_step_detection import is_photo_value
from qfield_hierarchy_sync import hierarchy_backfill_needed

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
from qfield_gpkg_storage import resolve_gpkg_path
from qfield_photo_storage import minio_resolve_photo_version

# The extraction phases. extract_project below is now only their coordinator.
# NOTE: the patchable I/O these phases call resolves in THAT module's namespace, so
# the test harness patches qfield_extract_phases too — see its docstring.
from qfield_extract_phases import (
    build_photo_index,
    download_and_check_delta,
    finalize,
    load_dedup_sets,
)
from qfield_gpkg_table import open_gpkg

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get("DATABASE_URL")

# PROJECTS / ALTERNATE_GPKGS / OPTICAL_GPKGS are imported at the top of this file
# from qfield_project_registry. MINIO_BUCKET moved to the storage modules.


# ── Step column detection ─────────────────────────────────────────────────────
# STEP_PATTERNS / OPTICAL_STEP_PATTERNS / EXTRA_PHOTO_PATTERNS / detect_step_columns
# / is_photo_value now live in qfield_step_detection.py (imported at the top) so the
# detection logic is pure and CI-gated by test_extract_gpkg_step_detection.py.



def extract_project(conn, project_name, config, dry_run=False, force=False):
    """Extract photo references from a project's GPKG and upsert into DB.

    Coordinates the phases in qfield_extract_phases. A phase returning None means
    "abort this project" and becomes (0, 0) here — see that module for why every
    abort must happen before any sync-state is written.
    """
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

    # pending_count = photos referenced by the GPKG whose binary had not yet uploaded
    # to MinIO on the previous run; download_and_check_delta decides what to do with it.
    hierarchy_backfill = hierarchy_backfill_needed(cur, ff_id, config)
    if not force:
        cur.execute(
            "SELECT last_version, pending_count FROM qfield_gpkg_sync_state WHERE qf_project_id = %s AND gpkg_path = %s",
            (qf_id, gpkg_path),
        )
        state = cur.fetchone()
    else:
        state = None

    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        version = download_and_check_delta(
            qf_id, gpkg_path, tmp_path, state, force, hierarchy_backfill)
        if version is None:
            return 0, 0

        table = open_gpkg(tmp_path, config, gpkg_path)
        if table is None:
            return 0, 0
        # Local aliases: the row loop below reads these names directly. PR-4 moves that
        # loop out; until then the aliases keep its body untouched.
        rows, columns = table.rows, table.columns
        label_col, step_cols, extra_cols = table.label_col, table.step_cols, table.extra_cols

        spatial_pon_map, combined_dcim, linked_qf_ids = build_photo_index(
            cur, qf_id, ff_id, config)

        existing_keys, existing_filenames, existing_photo_keys = load_dedup_sets(
            cur, qf_id, ff_id, linked_qf_ids)

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

        table.db.close()

        finalize(cur, conn, qf_id, ff_id, config, gpkg_path, version, table,
                 spatial_pon_map, photos_skipped_missing, dry_run)

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
