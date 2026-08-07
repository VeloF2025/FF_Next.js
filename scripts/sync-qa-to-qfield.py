#!/usr/bin/env python3
"""
Sync Construction QA decisions back to QField Civil Audit GPKG files.

Updates pole attributes in QField based on FibreFlow QA review statuses.
Status strings are PER-PROJECT and must match each QField layer's "Status"
ValueMap exactly (see FF_TO_QF_CIVIL_AUDIT and the note further down). Only
HUMAN QA-centre decisions are written; VLM auto 'retake_required' flags are
never pushed as failures:
  - workflow_status 'approved'                 → status_approved (e.g. Mohadin
                                                  "(ADMIN) Q/A Passed")
  - workflow_status 'rejected'/'rework_needed' → status_failed   ("Q/A Failed")
  - planted, QField Status currently NULL      → status_planted_incomplete
                                                  ("Pole Planted - Photos Incomplete")
  - existing field statuses / 'retake_required'/ no photos → left as-is

Pole Plant Date is gap-filled only (never overwrites a date the field captured).

Process:
  1. Download the pole GPKG from MinIO
  2. Update rows via SQLite
  3. Upload back to MinIO (new version)
  4. QFieldCloud syncs to tablets on next sync

Usage:
  python3 scripts/sync-qa-to-qfield.py [--project "Mohadin"] [--dry-run] [--approved-only]

  --approved-only skips writes for reject/rework poles and the planted gap-fill;
  only approved poles get status_approved. Skipped poles are reported in the
  summary so the operator can tell suppression apart from "nothing to do".
"""

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qfield_gpkg_table import require_column  # noqa: E402

# ── Config ────────────────────────────────────────────────────────────────────

# DATABASE_URL must come from the environment (post-Neon-cutover this points at
# Supabase). Never hard-code a connection string with a password in a tracked file.
DB_URL = os.environ.get("DATABASE_URL", "")
MINIO_BUCKET = "qfieldcloud-prod"

# FibreFlow project → QFieldCloud project mapping
# Each FF project may have multiple QField projects, but the Civil Audit
# GPKG is typically in the "Site Audit 2026" project
FF_TO_QF_CIVIL_AUDIT = {
    "Thembisa POP 1": {
        "qf_project_id": "63341eb4-bc81-4607-a3d6-580ea2a7457c",
        "ff_project_id": "7d8b94d6-8e5a-4dbb-9ede-69ce3884e004",
        "gpkg_path": "Poles.gpkg",
        "table_name": "Poles",
        "label_col": "label_1",
        "qa_comments_col": "Q/A Civil Comments ",
        "qa_date_col": "Q/A Date",
    },
    "Thembisa POP 3": {
        "qf_project_id": "5f3b962a-7901-43f7-a284-1c1a9ed7f3d1",
        "ff_project_id": "1de088dd-fe24-43fb-b8d3-94fca61ef91d",
        "gpkg_path": "THM_3_Poles.gpkg",
        "table_name": "thm_3_poles",
        "label_col": "label",
        "qa_comments_col": "Q/A Civil Comments",
        "qa_date_col": "Q/A Date",
    },
    "Lawley": {
        "qf_project_id": "2e988631-462b-448f-ae15-bb693a68cd55",
        "ff_project_id": "4eb13426-b2a1-472d-9b3c-277082ae9b55",
        "gpkg_path": "LAWPoles.gpkg",
        "table_name": "LAWPoles",
        "label_col": "label",
        "qa_comments_col": "Q/A Civil Comments",
        "qa_date_col": "Q/A Date",
    },
    "Mohadin": {
        "qf_project_id": "bec5f353-2e83-4f6b-989a-fca83ad94e16",
        "ff_project_id": "bf9a90db-e758-4c05-b999-694cd63c451f",
        "gpkg_path": "MOAPoles.gpkg",
        "table_name": "MOAPoles",
        "label_col": "label",
        "qa_comments_col": "QA Civil Comments",
        "qa_date_col": "QA Date",
        # Status strings below MUST match the QField "Civil Audit" ValueMap
        # exactly — verified against MOA_Site_Audit_2026_cloud.qgs on 2026-06-22.
        # The pole layer has NO generic "Q/A Complete"; approved poles use
        # "(ADMIN) Q/A Passed". "Q/A Failed" is being ADDED to the ValueMap.
        "status_approved": "(ADMIN) Q/A Passed",
        "status_failed": "Q/A Failed",
        "status_planted_incomplete": "Pole Planted - Photos Incomplete",
    },
    "Mamelodi": {
        "qf_project_id": "2ce80264-170c-4f05-ada1-68220d7e5885",
        "ff_project_id": "7003dc06-9af7-4a7c-bc6c-a177d77784f2",
        "gpkg_path": "MAMPoles.gpkg",
        "table_name": "MAMPoles",
        "label_col": "label",
        "qa_comments_col": "Q/A Civil Comments ",
        "qa_date_col": "Q/A Date",
    },
    "Etwatwa": {
        "qf_project_id": "47585401-1b25-4d3b-8d18-4337ea26df88",
        "ff_project_id": "c7255076-1d2f-41ce-97bb-858b8c87ee27",
        "gpkg_path": "PolesAudit.gpkg",
        "table_name": "PolesAudit",
        "label_col": "label",
        "qa_comments_col": "Q/A Civil Comments",
        "qa_date_col": "Q/A Date",
        # Verified against ETW POP 2 Site Audit 2026_cloud.qgs ValueMap 2026-06-23 —
        # identical vocabulary to Mohadin. Pole layer has no "Q/A Failed" option
        # (would need adding to the .qgs, same as Mohadin) for the rework poles.
        "status_approved": "(ADMIN) Q/A Passed",
        "status_failed": "Q/A Failed",
        "status_planted_incomplete": "Pole Planted - Photos Incomplete",
    },
}

# ── Status mapping ────────────────────────────────────────────────────────────
#
# Status vocabulary is PER-PROJECT — each QField project's "Status" ValueMap
# differs, so writing a single hard-coded string corrupts the dropdown. The
# previous global map ("(ADMIN) Q/A Complete" / "Pole Verified/ Civil Complete")
# matched NO option in the live Mohadin pole layer. Values now live in
# FF_TO_QF_CIVIL_AUDIT[project]["status_approved" | "status_failed" |
# "status_planted_incomplete"]. A project WITHOUT those keys is treated as
# un-audited and skipped (we refuse to write unverified Status values).
#
# Only HUMAN QA-centre outcomes are pushed:
#   workflow_status == 'approved'              -> status_approved
#   workflow_status in (rejected/rework_needed)-> status_failed
# 'retake_required' is a VLM auto-flag (no human review) and is NEVER written
# as a failure. Planted poles only get a NULL-gap-fill (status_planted_incomplete)
# when their QField Status is currently blank — existing field statuses are
# never overwritten.

# ── MinIO helpers ─────────────────────────────────────────────────────────────

def minio_download(qf_project_id: str, gpkg_path: str, dest: str) -> bool:
    """Download the latest GPKG version from MinIO.

    Uses shell=False arg lists (no shell metachar/quoting hazard) and selects
    the latest version by `lastModified` from `mc ls --json` — not by output
    line ordering, which mc does not guarantee. Picking a stale version would
    silently apply QA writes to old data and revert newer field captures, so
    the selection is made explicit.
    """
    base = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/"
    ls = subprocess.run(
        ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", "--json", base],
        capture_output=True, text=True,
    )
    if ls.returncode != 0:
        print(f"  ERROR listing GPKG versions: {ls.stderr.strip()}")
        return False

    versions = []
    for line in ls.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if obj.get("key") and obj.get("lastModified"):
            versions.append(obj)
    if not versions:
        print(f"  ERROR: No versions found for {gpkg_path}")
        return False

    latest = max(versions, key=lambda o: o["lastModified"])["key"]
    print(f"  Latest version: {latest}")

    with open(dest, "wb") as f:
        cat = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat", base + latest],
            stdout=f, stderr=subprocess.PIPE,
        )
    if cat.returncode != 0:
        print(f"  ERROR downloading: {cat.stderr.decode().strip()}")
        return False

    size = os.path.getsize(dest)
    print(f"  Downloaded {size:,} bytes → {dest}")
    return size > 1000


def qfieldcloud_upload(qf_project_id: str, gpkg_path: str, src: str) -> bool:
    """Upload the updated GPKG via the qfieldcloud_sdk (login + upload_files).

    QFieldCloud's Token-header auth is rejected for these service uploads
    (HTTP 401); the SDK username/password login is the supported path and is
    what the live OES sync uses. Credentials come from the environment — the
    same values the nightly OES wrapper exports from the prod .env:
      QFIELD_USERNAME, QFIELD_PASSWORD, QFIELD_API_URL
    upload_files derives the remote path from the file's path relative to
    project_path, so we stage the file under its remote name in a temp dir and
    glob exactly that file. QFieldCloud auto-triggers process_projectfile.
    """
    import shutil
    import tempfile

    try:
        from qfieldcloud_sdk import sdk
    except ImportError:
        print("  ERROR: qfieldcloud_sdk not installed")
        return False

    api_url = os.environ.get("QFIELD_API_URL", "https://qfield.fibreflow.app/api/v1/")
    username = os.environ.get("QFIELD_USERNAME", "admin")
    password = os.environ.get("QFIELD_PASSWORD")
    if not password:
        print("  ERROR: QFIELD_PASSWORD not set in environment")
        return False

    try:
        client = sdk.Client(api_url)
        client.login(username, password)
    except Exception as e:
        print(f"  ERROR: QFieldCloud login failed: {e}")
        return False

    staging = tempfile.mkdtemp()
    dest = os.path.join(staging, gpkg_path)
    parent = os.path.dirname(dest)
    if parent:
        os.makedirs(parent, exist_ok=True)
    shutil.copy(src, dest)

    try:
        results = list(client.upload_files(
            project_id=qf_project_id,
            upload_type=sdk.FileTransferType.PROJECT,
            project_path=staging,
            filter_glob=gpkg_path,
        ))
    except Exception as e:
        print(f"  ERROR: GPKG upload failed: {e}")
        return False
    finally:
        shutil.rmtree(staging, ignore_errors=True)

    ok = any(str(r.get("status", "")).lower().endswith("success") for r in results)
    for r in results:
        print(f"  upload: {r.get('name')} -> {r.get('status')}")
    return ok


# ── Main sync logic ───────────────────────────────────────────────────────────

def sync_project(project_name: str, config: dict, dry_run: bool = False, approved_only: bool = False) -> bool:
    """Sync QA decisions for one project to its QField GPKG. Returns True on
    success (including an intentional un-audited skip), False on a download or
    upload failure so the caller can set a non-zero exit code."""
    print(f"\n{'='*60}")
    print(f"Syncing: {project_name}")
    print(f"{'='*60}")

    ff_project_id = config["ff_project_id"]
    qf_project_id = config["qf_project_id"]
    gpkg_path = config["gpkg_path"]
    table_name = config["table_name"]
    label_col = config.get("label_col", "label_1")
    qa_comments_col = config.get("qa_comments_col", "Q/A Civil Comments")
    qa_date_col = config.get("qa_date_col", "Q/A Date")

    # Per-project Status ValueMap (see note above). No config → un-audited → skip.
    status_approved = config.get("status_approved")
    status_failed = config.get("status_failed")
    status_planted_incomplete = config.get("status_planted_incomplete")
    if not (status_approved and status_failed and status_planted_incomplete):
        print("  SKIP: no audited Status ValueMap for this project — refusing "
              "to write unverified Status values. Audit the .qgs and add "
              "status_approved/status_failed/status_planted_incomplete first.")
        return True

    # 1. Get QA review data from FibreFlow
    conn = psycopg2.connect(DB_URL)
    cur = conn.cursor(cursor_factory=RealDictCursor)

    cur.execute("""
        SELECT
            r.feature_id,
            r.workflow_status,
            r.qa_decision,
            r.qa_decision_at,
            r.qa_notes,
            r.photo_count,
            MIN(p.captured_at) as earliest_photo,
            MIN(p.captured_at) FILTER (WHERE p.checklist_step = 7) as step7_photo_date
        FROM construction_qa_reviews r
        LEFT JOIN construction_qa_photos p ON p.review_id = r.id
        WHERE r.project_id = %s::uuid
          AND r.feature_type = 'pole'
        GROUP BY r.id, r.feature_id, r.workflow_status, r.qa_decision,
                 r.qa_decision_at, r.qa_notes, r.photo_count
        ORDER BY r.feature_id
    """, (ff_project_id,))

    reviews = {row["feature_id"]: row for row in cur.fetchall()}
    cur.close()
    conn.close()

    print(f"  FibreFlow reviews: {len(reviews)}")

    # 2. Download GPKG (mkstemp, not the deprecated/race-prone mktemp)
    fd, tmp = tempfile.mkstemp(suffix=".gpkg")
    os.close(fd)
    if not minio_download(qf_project_id, gpkg_path, tmp):
        print("  FAILED to download GPKG, skipping")
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False

    # 3. Update GPKG
    gpkg_conn = sqlite3.connect(tmp)
    gpkg_cur = gpkg_conn.cursor()

    # Disable R-tree spatial triggers that call ST_IsEmpty (SpatiaLite function
    # not available in plain SQLite). We only update attribute columns, not geom,
    # so the R-tree index stays valid.
    gpkg_cur.execute("""
        SELECT name, sql FROM sqlite_master
        WHERE type='trigger' AND sql LIKE '%ST_IsEmpty%'
    """)
    disabled_triggers = [(name, sql) for name, sql in gpkg_cur.fetchall()]
    for trig_name, _ in disabled_triggers:
        gpkg_cur.execute(f'DROP TRIGGER IF EXISTS "{trig_name}"')
    if disabled_triggers:
        print(f"  Temporarily disabled {len(disabled_triggers)} spatial triggers")

    # Verify table exists
    gpkg_cur.execute(f"SELECT COUNT(*) FROM \"{table_name}\"")
    total_poles = gpkg_cur.fetchone()[0]
    print(f"  GPKG poles: {total_poles}")

    stats = {
        "qa_passed": 0, "qa_failed": 0, "planted_gapfill": 0, "unchanged": 0,
        "vlm_retake_seen": 0, "skipped_failed": 0,
    }

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    # Field-set statuses we must never clobber with a gap-fill.
    PROTECTED = {"Pole Removed/Canceled"}

    # Get all poles from GPKG. Validate first: SQLite reads an unresolvable
    # "identifier" as a string literal rather than raising, so a stale label_col
    # would hand back one constant-valued row per pole instead of failing.
    require_column(gpkg_conn, table_name, label_col, purpose="label")
    require_column(gpkg_conn, table_name, qa_date_col, purpose="QA date")
    gpkg_cur.execute(f'SELECT fid, "{label_col}", "Status", "Pole Plant Date", "{qa_date_col}" FROM "{table_name}"')
    poles = gpkg_cur.fetchall()

    for fid, label, current_status, plant_date, qa_date in poles:
        if not label:
            stats["unchanged"] += 1
            continue

        review = reviews.get(label)
        if not review:
            # No review = no photos taken = leave as-is.
            stats["unchanged"] += 1
            continue

        wf_status = review["workflow_status"]
        photo_count = review["photo_count"] or 0
        cur_norm = (current_status or "").strip()
        # Pole Plant Date = Step 7 (After Photo) date, fall back to earliest photo.
        plant_src = review["step7_photo_date"] or review["earliest_photo"]
        plant_dt = plant_src.strftime("%Y-%m-%d") if plant_src else None

        # Never touch a pole the field marked removed/cancelled.
        if cur_norm in PROTECTED:
            stats["unchanged"] += 1
            continue

        new_status = qa_comment = qa_dt = None
        is_human = wf_status == "approved" or wf_status in ("rejected", "rework_needed")

        if wf_status == "approved":
            if cur_norm == status_approved:
                stats["unchanged"] += 1
                continue  # already passed; no-op
            new_status = status_approved
            qa_comment = review.get("qa_notes") or "PASS"
            qa_dt = review["qa_decision_at"].strftime("%Y-%m-%d") if review["qa_decision_at"] else today
            stats["qa_passed"] += 1

        elif wf_status in ("rejected", "rework_needed"):
            if approved_only:
                stats["skipped_failed"] += 1
                continue
            new_status = status_failed
            qa_comment = review.get("qa_notes") or f"QA {wf_status}"
            qa_dt = review["qa_decision_at"].strftime("%Y-%m-%d") if review["qa_decision_at"] else today
            stats["qa_failed"] += 1

        else:
            # pending / retake_required (VLM auto-flag) / unidentified — NO human
            # decision. Never push as a failure. Only NULL-gap-fill a blank
            # status; never overwrite the field's own marking.
            if wf_status == "retake_required":
                stats["vlm_retake_seen"] += 1
            if approved_only or photo_count == 0 or cur_norm != "":
                stats["unchanged"] += 1
                continue
            new_status = status_planted_incomplete
            stats["planted_gapfill"] += 1

        if dry_run:
            # Always show human decisions; sample the gap-fills.
            if is_human or stats["planted_gapfill"] <= 8:
                tag = "PASS" if wf_status == "approved" else "FAIL" if is_human else "gap-fill"
                print(f"  [DRY] {label}: {cur_norm or '<NULL>'} -> {new_status}  ({tag})")
            continue

        # Build UPDATE. Plant date is gap-filled (COALESCE existing first) so we
        # never overwrite a date the field already captured.
        if qa_comment is not None:
            gpkg_cur.execute(f"""
                UPDATE "{table_name}"
                SET "Status" = ?,
                    "Pole Plant Date" = COALESCE("Pole Plant Date", ?),
                    "{qa_comments_col}" = ?,
                    "{qa_date_col}" = ?
                WHERE fid = ?
            """, (new_status, plant_dt, qa_comment, qa_dt, fid))
        else:
            gpkg_cur.execute(f"""
                UPDATE "{table_name}"
                SET "Status" = ?,
                    "Pole Plant Date" = COALESCE("Pole Plant Date", ?)
                WHERE fid = ?
            """, (new_status, plant_dt, fid))

    # Re-create disabled spatial triggers
    for trig_name, trig_sql in disabled_triggers:
        gpkg_cur.execute(trig_sql)

    if not dry_run:
        gpkg_conn.commit()

    gpkg_conn.close()

    writes = stats["qa_passed"] + stats["qa_failed"] + stats["planted_gapfill"]
    print(f"\n  Results{' (dry-run — nothing written)' if dry_run else ''}:")
    print(f"    Q/A Passed (human approved):       {stats['qa_passed']}  -> {status_approved!r}")
    print(f"    Q/A Failed (human reject/rework):  {stats['qa_failed']}  -> {status_failed!r}")
    print(f"    Planted NULL-gap-fill:             {stats['planted_gapfill']}  -> {status_planted_incomplete!r}")
    print(f"    Unchanged:                         {stats['unchanged']}")
    print(f"    VLM retake_required seen (NOT pushed as failed): {stats['vlm_retake_seen']}")
    if approved_only:
        print(f"    Skipped (--approved-only): {stats['skipped_failed']} reject/rework")

    # 4. Upload back to MinIO
    upload_ok = True
    if not dry_run and writes > 0:
        upload_ok = qfieldcloud_upload(qf_project_id, gpkg_path, tmp)
        print("  ✓ GPKG uploaded to MinIO" if upload_ok else "  ✗ FAILED to upload GPKG")

    # Cleanup
    try:
        os.unlink(tmp)
    except OSError:
        pass

    return upload_ok


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sync QA decisions to QField")
    parser.add_argument("--project", type=str, default=None, help="Single project name")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes only")
    parser.add_argument("--approved-only", action="store_true",
                        help="Only write status_approved for approved poles; skip reject/rework and the planted gap-fill")
    args = parser.parse_args()

    if not DB_URL:
        print("ERROR: DATABASE_URL not set. Export it (Supabase) before running.")
        sys.exit(1)

    projects = FF_TO_QF_CIVIL_AUDIT
    if args.project:
        if args.project not in projects:
            print(f"Unknown project: {args.project}")
            print(f"Available: {', '.join(projects.keys())}")
            sys.exit(1)
        projects = {args.project: projects[args.project]}

    print(f"QA → QField Sync | {len(projects)} project(s) | "
          f"dry_run={args.dry_run} | approved_only={args.approved_only}")

    failures = []
    for name, config in projects.items():
        try:
            if not sync_project(name, config, dry_run=args.dry_run, approved_only=args.approved_only):
                failures.append(name)
        except Exception as e:
            print(f"\n  ERROR syncing {name}: {type(e).__name__}: {e}")
            failures.append(name)

    print(f"\n{'='*60}")
    print("Done.")
    if failures:
        print(f"FAILED ({len(failures)}): {', '.join(failures)}")
        sys.exit(1)


if __name__ == "__main__":
    main()
