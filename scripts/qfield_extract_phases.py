"""
The network/DB stages of one project's photo extraction.

extract_project() was 393 lines of straight-line code with distinct stages threaded
through one 355-line try block. Each stage takes what the previous produced and either
yields the next value or aborts the whole extraction. Pulling them out leaves a
coordinator you can read in one screen, and gives each stage a name and a signature.

Reading the GPKG itself lives in qfield_gpkg_table (pure local sqlite); everything
here talks to MinIO or Postgres.

Abort convention: a stage that decides the extraction must stop returns None, and the
coordinator turns that into (0, 0). This preserves the original early-`return 0, 0`
behaviour exactly — including that a bail-out happens BEFORE any sync-state is written,
so a stuck project keeps looking stuck instead of looking freshly synced.

IMPORTANT for tests — read before adding a call here. The characterization harness
intercepts I/O by setattr()ing stubs onto the module where the call is RESOLVED, and
CPython resolves a function's globals in the module where that function is DEFINED. So
every patchable name this module calls (minio_download_latest,
minio_list_dcim_directory, resolve_spatial_pon_map, sync_hierarchy) must be patched
HERE, not only on extract-gpkg-photos.py. qfield_extract_testkit patches every module
in its _patch_targets list and asserts interception actually happened; if you add a new
I/O call, add its module there or the suite will silently hit real MinIO.
"""
import re
from datetime import datetime, timezone

from qfield_gpkg_storage import minio_download_latest
from qfield_hierarchy_sync import resolve_spatial_pon_map, sync_hierarchy
from qfield_photo_storage import minio_list_dcim_directory

# Keep re-scanning a same-version GPKG while it has pending (not-yet-uploaded) photos,
# but stop once the GPKG is this old — photos still missing after this many days are
# treated as never-coming. Mirrors recheck-pending-uploads.py's MISSING_THRESHOLD_DAYS
# so a permanently-stuck GPKG doesn't force a full re-scan on every cron run forever.
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


def download_and_check_delta(qf_id, gpkg_path, tmp_path, state, force,
                             hierarchy_backfill):
    """Download the GPKG; return its version, or None to abort the extraction.

    Aborts when the download fails, or when the delta check says this exact version
    was already processed and nothing is outstanding.
    """
    version, size = minio_download_latest(qf_id, gpkg_path, tmp_path)
    if not version:
        print(f"  SKIP: Could not download GPKG")
        return None

    print(f"  Version: {version} ({size // 1024}KB)")

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
            return None
        if hierarchy_backfill:
            print("  RE-SCAN: Work QA hierarchy backfill required")
        else:
            print(f"  RE-SCAN: same version but {pending} photo(s) were pending upload last run")
    return version


def build_photo_index(cur, qf_id, ff_id, config):
    """(spatial_pon_map, combined_dcim, linked_qf_ids) for this project.

    combined_dcim maps filename -> (qf_id_where_found, versioned_storage_key) across
    the primary project and every linked one. Primary wins on conflict so re-runs are
    stable.
    """
    spatial_pon_map = (
        resolve_spatial_pon_map(qf_id)
        if config.get("spatial_pon")
        else {}
    )

    print(f"  Listing MinIO DCIM directory...")
    dcim_index = minio_list_dcim_directory(qf_id)
    print(f"  MinIO DCIM files found: {len(dcim_index)}")

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

    return spatial_pon_map, combined_dcim, linked_qf_ids


def load_dedup_sets(cur, qf_id, ff_id, linked_qf_ids):
    """(existing_keys, existing_filenames, existing_photo_keys) already ingested.

    The dedup query spans the primary AND every linked project: photos inserted with
    `resolved_qf_id != qf_id` would otherwise never be dedup-detected on re-run and the
    cron would pile up duplicates each day. There is no UNIQUE constraint on photo_key
    — the in-memory existing_keys set is the only guard.
    """
    dedup_project_ids = [qf_id] + linked_qf_ids
    cur.execute(
        "SELECT photo_key FROM qfield_photo_validations WHERE project_id = ANY(%s::uuid[])",
        (dedup_project_ids,),
    )
    existing_keys = set(r["photo_key"] for r in cur.fetchall())

    # Filename index so dedup survives versioned/unversioned key mismatches
    # e.g. "projects/.../DCIM/file.jpg/v2026..." → "file.jpg"
    existing_filenames = set()
    for k in existing_keys:
        parts = k.split("/")
        for i, part in enumerate(parts):
            if re.match(r'v\d{14}-', part):
                if i > 0:
                    existing_filenames.add(parts[i - 1])
                break
        else:
            if parts:
                existing_filenames.add(parts[-1])

    cur.execute(
        "SELECT storage_key FROM construction_qa_photos WHERE project_id = %s AND source = 'qfield'",
        (ff_id,),
    )
    existing_photo_keys = set(r["storage_key"] for r in cur.fetchall())
    return existing_keys, existing_filenames, existing_photo_keys


def finalize(cur, conn, qf_id, ff_id, config, gpkg_path, version, table,
             spatial_pon_map, photos_skipped_missing, dry_run):
    """Sync hierarchy and record sync-state. No-op under dry_run."""
    if dry_run:
        return

    hierarchy_result = sync_hierarchy(
        cur,
        conn,
        ff_id,
        table.rows,
        table.label_col,
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

    # pending_count records how many photo references were skipped this run because
    # their binary is not yet in MinIO — so the next run re-scans this GPKG (see the
    # delta check) and ingests them once they finish uploading, without waiting for a
    # GPKG re-upload.
    cur.execute("""
        INSERT INTO qfield_gpkg_sync_state (qf_project_id, gpkg_path, last_version, last_synced_at, row_count, pending_count)
        VALUES (%s::uuid, %s, %s, NOW(), %s, %s)
        ON CONFLICT (qf_project_id, gpkg_path) DO UPDATE SET
            last_version = EXCLUDED.last_version,
            last_synced_at = NOW(),
            row_count = EXCLUDED.row_count,
            pending_count = EXCLUDED.pending_count
    """, (qf_id, gpkg_path, version, len(table.rows), photos_skipped_missing))

    # Retire the row we just superseded. After a redirect the old path keeps a row
    # whose last_version can never advance again — nothing writes to it and nothing
    # deletes it — so the staleness monitor would report it as behind forever, paging
    # on this fix's own success and burying the real signal. Scoped to the configured
    # path of THIS project: the resolver only ever redirects away from that one name.
    if gpkg_path != config["gpkg_path"]:
        cur.execute(
            "DELETE FROM qfield_gpkg_sync_state WHERE qf_project_id = %s::uuid AND gpkg_path = %s",
            (qf_id, config["gpkg_path"]),
        )
        if cur.rowcount:
            print(f"  Retired superseded sync-state row for '{config['gpkg_path']}'")
    conn.commit()
