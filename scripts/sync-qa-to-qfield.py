#!/usr/bin/env python3
"""
Sync Construction QA decisions back to QField Civil Audit GPKG files.

Updates pole attributes in QField based on FibreFlow QA review statuses:
  - Poles with photos → Status: "Pole Verified/ Civil Complete", Pole Plant Date
  - QA approved → Status: "(ADMIN) Q/A Complete", Q/A Date, Q/A Civil Comments
  - QA failed/retake → Status: "Q/A Failed", Q/A Date, Q/A Civil Comments (missing steps)
  - No photos → Status left as-is (NULL or "To be Planted")

Process:
  1. Download Civil Audit.gpkg from MinIO
  2. Update rows via SQLite
  3. Upload back to MinIO (new version)
  4. QFieldCloud syncs to tablets on next sync

Usage:
  python3 scripts/sync-qa-to-qfield.py [--project "Thembisa POP 1"] [--dry-run]
"""

import argparse
import os
import sqlite3
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

import psycopg2
from psycopg2.extras import RealDictCursor

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get("DATABASE_URL", "postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require")
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
        "label_col": "label_1",
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
    },
}

# ── Status mapping ────────────────────────────────────────────────────────────

QA_STATUS_MAP = {
    "approved":         "(ADMIN) Q/A Complete",
    "rejected":         "Q/A Failed",
    "retake_required":  "Q/A Failed",
    "rework_needed":    "Q/A Failed",
}

PLANTED_STATUS = "Pole Verified/ Civil Complete"

# ── MinIO helpers ─────────────────────────────────────────────────────────────

def minio_download(qf_project_id: str, gpkg_path: str, dest: str) -> bool:
    """Download latest GPKG version from MinIO."""
    # List versions to get the latest
    ls_cmd = f'docker exec qfieldcloud-minio-1 mc ls "local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/"'
    result = subprocess.run(ls_cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR listing GPKG versions: {result.stderr.strip()}")
        return False

    lines = result.stdout.strip().split("\n")
    if not lines or not lines[-1].strip():
        print(f"  ERROR: No versions found for {gpkg_path}")
        return False

    # Last line has the latest version
    latest = lines[-1].strip().split()[-1]
    print(f"  Latest version: {latest}")

    cat_cmd = f'docker exec qfieldcloud-minio-1 mc cat "local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/{latest}"'
    with open(dest, "wb") as f:
        result = subprocess.run(cat_cmd, shell=True, stdout=f, stderr=subprocess.PIPE)

    if result.returncode != 0:
        print(f"  ERROR downloading: {result.stderr.decode().strip()}")
        return False

    size = os.path.getsize(dest)
    print(f"  Downloaded {size:,} bytes → {dest}")
    return size > 1000


def qfieldcloud_upload(qf_project_id: str, gpkg_path: str, src: str) -> bool:
    """Upload updated GPKG via QFieldCloud REST API.

    Uses curl for reliable multipart upload with SSL handling.
    The API handles versioning, DB registration, and auto-triggers
    a process_projectfile job for tablet sync.
    """
    import urllib.parse

    token = os.environ.get("QFIELD_API_TOKEN", "")
    if not token:
        print("  ERROR: QFIELD_API_TOKEN not set")
        return False

    encoded_path = urllib.parse.quote(gpkg_path)
    url = f"https://qfield.fibreflow.app/api/v1/files/{qf_project_id}/{encoded_path}/"
    size = os.path.getsize(src)

    result = subprocess.run([
        "curl", "-sk", "-X", "POST", url,
        "-H", f"Authorization: Token {token}",
        "-F", f"file=@{src};filename={gpkg_path};type=application/octet-stream",
        "-w", "\n%{http_code}",
    ], capture_output=True, text=True, timeout=120)

    lines = result.stdout.strip().split("\n")
    status_code = lines[-1] if lines else "0"

    if status_code in ("200", "201"):
        print(f"  Uploaded via API (HTTP {status_code}, {size:,} bytes)")
        return True
    else:
        print(f"  ERROR API upload: HTTP {status_code} | {result.stdout[:200]}")
        return False


# ── Main sync logic ───────────────────────────────────────────────────────────

def sync_project(project_name: str, config: dict, dry_run: bool = False):
    """Sync QA decisions for one project to its QField GPKG."""
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

    # 2. Download GPKG
    tmp = tempfile.mktemp(suffix=".gpkg")
    if not minio_download(qf_project_id, gpkg_path, tmp):
        print("  FAILED to download GPKG, skipping")
        return

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

    stats = {"planted": 0, "qa_complete": 0, "qa_failed": 0, "unchanged": 0}

    # Get all poles from GPKG
    gpkg_cur.execute(f'SELECT fid, "{label_col}", "Status", "Pole Plant Date", "{qa_date_col}" FROM "{table_name}"')
    poles = gpkg_cur.fetchall()

    for fid, label, current_status, plant_date, qa_date in poles:
        if not label:
            stats["unchanged"] += 1
            continue

        review = reviews.get(label)

        if not review:
            # No review = no photos taken = leave as-is or mark "To be Planted"
            stats["unchanged"] += 1
            continue

        wf_status = review["workflow_status"]
        earliest = review["earliest_photo"]
        step7_date = review["step7_photo_date"]
        photo_count = review["photo_count"] or 0

        # Pole Plant Date = Step 7 (After Photo) date, fall back to earliest photo
        plant_src = step7_date or earliest

        # Determine new status
        if wf_status == "approved":
            new_status = "(ADMIN) Q/A Complete"
            qa_comment = review.get("qa_notes") or "PASS - automated QA"
            qa_dt = review["qa_decision_at"].strftime("%Y-%m-%d") if review["qa_decision_at"] else datetime.now(timezone.utc).strftime("%Y-%m-%d")
            new_plant_date = plant_src.strftime("%Y-%m-%d") if plant_src else plant_date
            stats["qa_complete"] += 1

        elif wf_status in ("retake_required", "rejected", "rework_needed"):
            new_status = "Q/A Failed"
            qa_comment = review.get("qa_notes") or f"QA {wf_status}"
            qa_dt = review["qa_decision_at"].strftime("%Y-%m-%d") if review["qa_decision_at"] else datetime.now(timezone.utc).strftime("%Y-%m-%d")
            new_plant_date = plant_src.strftime("%Y-%m-%d") if plant_src else plant_date
            stats["qa_failed"] += 1

        elif photo_count > 0:
            # Has photos but QA not done yet → planted, awaiting QA
            if current_status == "(ADMIN) Q/A Complete":
                stats["unchanged"] += 1
                continue  # Don't downgrade
            new_status = PLANTED_STATUS
            qa_comment = None  # Don't clear existing comments
            qa_dt = None
            new_plant_date = plant_src.strftime("%Y-%m-%d") if plant_src else plant_date
            stats["planted"] += 1

        else:
            stats["unchanged"] += 1
            continue

        if dry_run:
            if stats["qa_complete"] + stats["qa_failed"] + stats["planted"] <= 5:
                print(f"  [DRY] {label}: {current_status} → {new_status}")
            continue

        # Build UPDATE
        if qa_comment is not None:
            gpkg_cur.execute(f"""
                UPDATE "{table_name}"
                SET "Status" = ?,
                    "Pole Plant Date" = COALESCE(?, "Pole Plant Date"),
                    "{qa_comments_col}" = ?,
                    "{qa_date_col}" = ?
                WHERE fid = ?
            """, (new_status, new_plant_date, qa_comment, qa_dt, fid))
        else:
            gpkg_cur.execute(f"""
                UPDATE "{table_name}"
                SET "Status" = ?,
                    "Pole Plant Date" = COALESCE(?, "Pole Plant Date")
                WHERE fid = ?
            """, (new_status, new_plant_date, fid))

    # Re-create disabled spatial triggers
    for trig_name, trig_sql in disabled_triggers:
        gpkg_cur.execute(trig_sql)

    if not dry_run:
        gpkg_conn.commit()

    gpkg_conn.close()

    print(f"\n  Results:")
    print(f"    QA Complete:  {stats['qa_complete']}")
    print(f"    QA Failed:    {stats['qa_failed']}")
    print(f"    Planted:      {stats['planted']}")
    print(f"    Unchanged:    {stats['unchanged']}")

    # 4. Upload back to MinIO
    if not dry_run and (stats["qa_complete"] + stats["qa_failed"] + stats["planted"]) > 0:
        if qfieldcloud_upload(qf_project_id, gpkg_path, tmp):
            print("  ✓ GPKG uploaded to MinIO")
        else:
            print("  ✗ FAILED to upload GPKG")

    # Cleanup
    try:
        os.unlink(tmp)
    except OSError:
        pass


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Sync QA decisions to QField")
    parser.add_argument("--project", type=str, default=None, help="Single project name")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes only")
    args = parser.parse_args()

    projects = FF_TO_QF_CIVIL_AUDIT
    if args.project:
        if args.project not in projects:
            print(f"Unknown project: {args.project}")
            print(f"Available: {', '.join(projects.keys())}")
            sys.exit(1)
        projects = {args.project: projects[args.project]}

    print(f"QA → QField Sync | {len(projects)} project(s) | dry_run={args.dry_run}")

    for name, config in projects.items():
        try:
            sync_project(name, config, dry_run=args.dry_run)
        except Exception as e:
            print(f"\n  ERROR syncing {name}: {e}")

    print(f"\n{'='*60}")
    print("Done.")


if __name__ == "__main__":
    main()
