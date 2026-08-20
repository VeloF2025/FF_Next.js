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
import traceback

import psycopg2
import psycopg2.extras

# Pure photo-column detection (no DB deps) — unit-tested/CI-gated by
# scripts/test_extract_gpkg_step_detection.py. scripts/ is sys.path[0] when this
# file is run as `python3 scripts/extract-gpkg-photos.py` (the only invocation).
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
from qfield_gpkg_storage import resolve_gpkg_paths
from qfield_photo_storage import minio_resolve_photo_version
from qfield_row_ingest import ingest_rows

# The extraction phases. extract_project below is now only their coordinator.
# NOTE: the patchable I/O these phases call resolves in THAT module's namespace, so
# the test harness patches qfield_extract_phases too — see its docstring.
from qfield_extract_phases import (
    ProjectContext,
    download_and_check_delta,
    finalize,
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



# [(project_name, gpkg_path, error)] for every family member that failed this run.
# Swallowing a per-file error to protect the other files is only safe if the RUN still
# reports failure — otherwise cron reads exit 0 and nobody learns a project was skipped.
EXTRACT_FAILURES = []


def extract_project(conn, project_name, config, dry_run=False, force=False):
    """Extract photo references from every GPKG in the project's family.

    Crews both RENAME an audit GPKG rather than overwriting it (Mahikeng: 918 photos
    missed over 5 days) and SPLIT one into concurrent layers (Namakgale: four
    civil-audit phase files, all live). Reading only the newest member handles the
    first and silently drops the second, so every member is read; each keeps its own
    sync-state row, so an unchanged one costs a download and a SKIP.
    """
    qf_id = config["qf_project_id"]

    print(f"\n{'='*60}")
    print(f"Project: {project_name}")
    print(f"  QField: {qf_id}")

    total_found = 0
    total_upserted = 0
    # Built once and SHARED across the family. The photo index shells out an `mc ls`
    # over the whole DCIM directory (9 309 objects on Mahikeng) and the dedup sets cost
    # two queries; none of it varies between members of the same project. Sharing the
    # dedup sets also keeps a photo referenced by two members from being counted twice —
    # a real run dedups against the DB between members, but a --dry-run commits nothing
    # and would otherwise report the overlap twice in the figure an operator reads.
    shared = ProjectContext(conn, config)
    for gpkg_path in resolve_gpkg_paths(qf_id, config["gpkg_path"]):
        try:
            found, upserted = extract_gpkg(
                conn, config, gpkg_path, shared, dry_run=dry_run, force=force)
        except Exception as exc:
            # One member must not take the rest of the family — or, since main() has no
            # per-project guard either, every project queued behind it — down with it.
            # Reading N files means N times the transient-MinIO surface of reading one.
            print(f"  ERROR: '{gpkg_path}' failed, continuing with the rest: "
                  f"{type(exc).__name__}: {exc}")
            traceback.print_exc()
            # MANDATORY, not tidiness. The connection runs autocommit=False, so if the
            # exception came from a statement, Postgres has put it in "current
            # transaction is aborted, commands ignored until end of transaction block".
            # Continuing without this means every later statement — the rest of this
            # family, every project after it in an --all run, and
            # resolve_unversioned_keys() at the end — raises and is swallowed here, so
            # the run writes nothing further while printing as though it recovered.
            try:
                conn.rollback()
            except Exception as rb_exc:      # a dead connection cannot be rolled back
                print(f"  ERROR: rollback after '{gpkg_path}' failed: {rb_exc}")
                raise
            EXTRACT_FAILURES.append((project_name, gpkg_path, f"{type(exc).__name__}: {exc}"))
            continue
        total_found += found
        total_upserted += upserted
    return total_found, total_upserted


def extract_gpkg(conn, config, gpkg_path, shared, dry_run=False, force=False):
    """Extract photo references from ONE GPKG and upsert into DB.

    Coordinates the phases in qfield_extract_phases. A phase returning None means
    "abort this file" and becomes (0, 0) here — see that module for why every abort
    must happen before any sync-state is written. Every step — sync-state lookup,
    download, sync-state upsert — must use gpkg_path, not config["gpkg_path"], or the
    delta check compares against the wrong state row.
    """
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    qf_id = config["qf_project_id"]
    ff_id = config["ff_project_id"]

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
        spatial_pon_map, combined_dcim, _linked_qf_ids = shared.photo_index()
        existing_keys, existing_filenames, existing_photo_keys = shared.dedup_sets()

        photos_found, photos_upserted, photos_skipped_missing = ingest_rows(
            cur, qf_id, table, combined_dcim,
            existing_keys, existing_filenames, existing_photo_keys, dry_run)

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
    if EXTRACT_FAILURES:
        print(f"{len(EXTRACT_FAILURES)} GPKG(s) FAILED and were skipped:")
        for project_name, gpkg_path, err in EXTRACT_FAILURES:
            print(f"  {project_name} / {gpkg_path}: {err}")
    print(f"{'='*60}")

    conn.close()
    # Per-file recovery keeps the other files moving; it must not turn a real failure
    # into a green cron run. The wrapper (cron-qa-ingest.sh) branches on this status.
    return 1 if EXTRACT_FAILURES else 0


if __name__ == "__main__":
    sys.exit(main())
