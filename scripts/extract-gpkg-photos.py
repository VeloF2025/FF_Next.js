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
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras

# ── Config ────────────────────────────────────────────────────────────────────

DB_URL = os.environ.get("DATABASE_URL")
MINIO_BUCKET = "qfieldcloud-prod"

# QFieldCloud project → FibreFlow project mapping
# Each entry defines how to read the GPKG for that project
PROJECTS = {
    "Lawley": {
        "qf_project_id": "2e988631-462b-448f-ae15-bb693a68cd55",
        "ff_project_id": "4eb13426-b2a1-472d-9b3c-277082ae9b55",
        "gpkg_path": "LAWPoles.gpkg",
        "table_name": "LAWPoles",
        "label_col": "label",
    },
    "Mohadin": {
        "qf_project_id": "bec5f353-2e83-4f6b-989a-fca83ad94e16",
        "ff_project_id": "bf9a90db-e758-4c05-b999-694cd63c451f",
        "gpkg_path": "MOAPoles.gpkg",
        "table_name": "MOAPoles",
        "label_col": "label",
    },
    "Mamelodi": {
        "qf_project_id": "2ce80264-170c-4f05-ada1-68220d7e5885",
        "ff_project_id": "7003dc06-9af7-4a7c-bc6c-a177d77784f2",
        "gpkg_path": "MAMPoles.gpkg",
        "table_name": "MAMPoles",
        "label_col": "label",
    },
    "Etwatwa": {
        "qf_project_id": "47585401-1b25-4d3b-8d18-4337ea26df88",
        "ff_project_id": "c7255076-1d2f-41ce-97bb-858b8c87ee27",
        "gpkg_path": "PolesAudit.gpkg",
        "table_name": "PolesAudit",
        "label_col": "label",
    },
    "Thembisa POP 1": {
        "qf_project_id": "63341eb4-bc81-4607-a3d6-580ea2a7457c",
        "ff_project_id": "7d8b94d6-8e5a-4dbb-9ede-69ce3884e004",
        "gpkg_path": "Poles.gpkg",
        "table_name": "Poles",
        "label_col": "label_1",
    },
    "Thembisa POP 3": {
        "qf_project_id": "5f3b962a-7901-43f7-a284-1c1a9ed7f3d1",
        "ff_project_id": "1de088dd-fe24-43fb-b8d3-94fca61ef91d",
        "gpkg_path": "THM_3_Poles.gpkg",
        "table_name": "thm_3_poles",
        "label_col": "label_1",
    },
    "Tonga": {
        "qf_project_id": "7fe59cdc-b1d5-475d-8448-5cf2e9f7175b",
        "ff_project_id": "ce3bf310-d6ba-4ede-ab36-a8c902a5efc6",
        "gpkg_path": "Civil Audit.gpkg",
        "table_name": "civil_audit",
        "label_col": "Pole Label",
    },
}

# Also check these alternate GPKGs per project (civil audit vs poles audit)
ALTERNATE_GPKGS = {
    "Mamelodi": {"gpkg_path": "civil_audit_.gpkg", "table_name": "civil_audit_", "label_col": "label"},
    "Thembisa POP 1": {"gpkg_path": "civil_audit_.gpkg", "table_name": "civil_audit_", "label_col": "label_1"},
    "Thembisa POP 3": {"gpkg_path": "civil_audit_.gpkg", "table_name": "civil_audit_", "label_col": "label_1"},
}


# ── Step column detection ─────────────────────────────────────────────────────

# Match GPKG column names to checklist steps using the leading number
STEP_PATTERNS = [
    (re.compile(r"^1[\.\s].*(?:before|mark)", re.IGNORECASE), 1, "Before Photo"),
    (re.compile(r"^2[\.\s].*(?:during|digging)", re.IGNORECASE), 2, "During Photo"),
    (re.compile(r"^3[\.\s].*(?:depth|measuring)", re.IGNORECASE), 3, "Depth Photo"),
    (re.compile(r"^4[\.\s].*(?:end.?plate|visible)", re.IGNORECASE), 4, "End Plates"),
    (re.compile(r"^5[\.\s].*(?:compact|backfill)", re.IGNORECASE), 5, "Compaction"),
    (re.compile(r"^6[\.\s].*(?:level|spirit)", re.IGNORECASE), 6, "Level Check"),
    (re.compile(r"^7[\.\s].*(?:after|picture)", re.IGNORECASE), 7, "After Photo"),
    (re.compile(r"^8[\.\s].*(?:label|foto|photo)", re.IGNORECASE), 8, "Pole Label"),
]

# Extra photo columns (optical / misc) — no step assignment
EXTRA_PHOTO_PATTERNS = [
    re.compile(r"^Photo.*Joint", re.IGNORECASE),
    re.compile(r"^Photo.*Label", re.IGNORECASE),
    re.compile(r"^Photo.*Slack", re.IGNORECASE),
    re.compile(r"^Photo.*Pole", re.IGNORECASE),
    re.compile(r"^Photo.*Sla", re.IGNORECASE),
    re.compile(r"^Pole.*Photo$", re.IGNORECASE),
    re.compile(r"^Joint.*Photo$", re.IGNORECASE),
    re.compile(r"^Lable.*Photo$", re.IGNORECASE),
    re.compile(r"^Slack.*Photo$", re.IGNORECASE),
]

# Optical dome step columns
OPTICAL_STEP_PATTERNS = [
    (re.compile(r"^1[\.\s].*dome.*pole", re.IGNORECASE), 1, "Dome on Pole"),
    (re.compile(r"^2[\.\s].*dome.*label", re.IGNORECASE), 2, "Dome Label"),
    (re.compile(r"^3[\.\s].*open.*dome", re.IGNORECASE), 3, "Open Dome"),
    (re.compile(r"^4[\.\s].*splice.*protect", re.IGNORECASE), 4, "Splice Protectors"),
    (re.compile(r"^5[\.\s].*slack.*manage", re.IGNORECASE), 5, "Slack Management"),
    (re.compile(r"^6[\.\s].*strength.*member", re.IGNORECASE), 6, "Strength Members"),
    (re.compile(r"^7[\.\s].*seal.*dust", re.IGNORECASE), 7, "Seals & Dust Caps"),
    (re.compile(r"^8[\.\s].*pole.*id", re.IGNORECASE), 8, "Pole ID"),
]


def detect_step_columns(columns):
    """Detect which columns contain photo references and their step numbers."""
    step_cols = {}  # col_name -> (step, label, discipline)
    extra_cols = []  # col_name (no step)

    for col in columns:
        col_clean = col.strip()
        # Check civil step patterns
        for pattern, step, label in STEP_PATTERNS:
            if pattern.match(col_clean):
                step_cols[col] = (step, label, "civil")
                break
        else:
            # Check optical step patterns
            for pattern, step, label in OPTICAL_STEP_PATTERNS:
                if pattern.match(col_clean):
                    step_cols[col] = (step, label, "optical")
                    break
            else:
                # Check extra photo columns
                for pattern in EXTRA_PHOTO_PATTERNS:
                    if pattern.match(col_clean):
                        extra_cols.append(col)
                        break

    return step_cols, extra_cols


def is_photo_value(val):
    """Check if a column value looks like a photo reference."""
    if not val or not str(val).strip():
        return False
    s = str(val).strip()
    return any(ext in s.lower() for ext in [".jpg", ".jpeg", ".png", ".heic"])


# ── PON/zone sync ─────────────────────────────────────────────────────────────

def sync_pon_zone(cur, conn, ff_project_id, rows, columns, label_col):
    """
    Sync pon_no and zone_no from GPKG to poles table.

    Handles two patterns:
    1. Direct columns: pon_no + zone_no (most projects)
    2. Block label: BL column like VTN_TOG_Z0A_B048 → extract number → pon_no
    """
    col_set = set(columns)

    # Detect which pattern this GPKG uses
    has_pon_no = "pon_no" in col_set
    has_zone_no = "zone_no" in col_set
    has_bl = "BL" in col_set

    if not has_pon_no and not has_bl:
        return 0  # No PON data in this GPKG

    updates = []
    for row in rows:
        label = row[label_col] if label_col in row.keys() else None
        if not label:
            continue
        label = str(label).strip()
        if not label:
            continue

        pon_no = None
        zone_no = None

        if has_pon_no:
            # Direct pon_no column (Lawley, Mamelodi, Etwatwa, THM1, THM3)
            raw_pon = row["pon_no"]
            if raw_pon is not None:
                try:
                    pon_no = int(str(raw_pon).strip().split(",")[0])  # Handle "30,035" → 30
                except (ValueError, IndexError):
                    pass
            if has_zone_no:
                raw_zone = row["zone_no"]
                if raw_zone is not None:
                    try:
                        zone_no = int(str(raw_zone).strip())
                    except ValueError:
                        pass
        elif has_bl:
            # Block label pattern (Tonga): VTN_TOG_Z0A_B048 → pon_no=48
            bl = row["BL"]
            if bl:
                m = re.search(r"_B(\d+)$", str(bl).strip())
                if m:
                    pon_no = int(m.group(1))
                    zone_no = 1  # Tonga is all zone 1

        if pon_no is not None:
            updates.append((pon_no, zone_no, ff_project_id, label))

    if not updates:
        return 0

    # Batch update — only where values differ
    psycopg2.extras.execute_batch(cur, """
        UPDATE poles SET
            pon_no = COALESCE(%s, pon_no),
            zone_no = COALESCE(%s, zone_no),
            updated_at = NOW()
        WHERE project_id = %s AND pole_number = %s
          AND (pon_no IS DISTINCT FROM %s OR zone_no IS DISTINCT FROM %s)
    """, [(p, z, pid, lbl, p, z) for p, z, pid, lbl in updates], page_size=200)

    updated = cur.rowcount
    conn.commit()
    return updated


# ── QFieldCloud API + MinIO helpers ──────────────────────────────────────────

QFIELD_API_URL = os.environ.get('QFIELD_API_URL', 'https://qfield.fibreflow.app/api/v1/')
QFIELD_USERNAME = os.environ.get('QFIELD_USERNAME')
QFIELD_PASSWORD = os.environ.get('QFIELD_PASSWORD')

_qfc_session = None

def _get_qfc_session():
    """Get authenticated QFieldCloud API session (cached)."""
    global _qfc_session
    if _qfc_session is not None:
        return _qfc_session
    if not QFIELD_USERNAME or not QFIELD_PASSWORD:
        print("    WARN: QFIELD_USERNAME / QFIELD_PASSWORD env vars not set, skipping QFC API")
        return None
    import requests as _requests
    _qfc_session = _requests.Session()
    resp = _qfc_session.post(f'{QFIELD_API_URL}auth/login/', json={
        'username': QFIELD_USERNAME,
        'password': QFIELD_PASSWORD,
    })
    if resp.status_code != 200:
        print(f"    WARN: QFieldCloud auth failed: {resp.status_code}")
        _qfc_session = None
        return None
    token = resp.json().get('token')
    _qfc_session.headers['Authorization'] = f'Token {token}'
    return _qfc_session


def qfc_list_dcim_files(qf_project_id):
    """List DCIM photos via QFieldCloud REST API.

    Returns a dict mapping filename → API download path.
    The API sees all files including those stored in deltas/packages
    that are invisible to direct MinIO mc ls.
    """
    session = _get_qfc_session()
    if not session:
        return {}
    try:
        resp = session.get(f'{QFIELD_API_URL}files/{qf_project_id}/')
        if resp.status_code != 200:
            print(f"    WARN: QFieldCloud files list failed: {resp.status_code}")
            return {}
        files = resp.json()
        dcim_files = {}
        for f in files:
            name = f.get('name', '')
            if not name.startswith('DCIM/'):
                continue
            lower = name.lower()
            if not any(lower.endswith(ext) for ext in ('.jpg', '.jpeg', '.png', '.heic')):
                continue
            filename = name[len('DCIM/'):]
            # Build a storage key compatible with existing DB records
            dcim_files[filename] = f"projects/{qf_project_id}/files/{name}"
        return dcim_files
    except Exception as e:
        print(f"    WARN: qfc_list_dcim_files error: {e}")
        return {}


def minio_list_dcim_directory(qf_project_id):
    """Batch-list the entire DCIM directory for a QFieldCloud project.

    First tries the QFieldCloud REST API (sees all files including deltas).
    Falls back to direct MinIO mc ls if the API is unavailable.

    Returns a dict mapping filename → storage key.
    """
    # Try API first — it sees delta-merged files that mc ls misses
    api_files = qfc_list_dcim_files(qf_project_id)
    if api_files:
        return api_files

    # Fallback: direct MinIO listing (only sees flat files/ directory)
    print(f"    Falling back to direct MinIO ls...")
    dcim_prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/DCIM/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", "--recursive", dcim_prefix],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            print(f"    WARN: mc ls DCIM failed for {qf_project_id}: {result.stderr.strip()[:120]}")
            return {}

        dcim_files = {}
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            std_idx = line.find(" STANDARD ")
            if std_idx == -1:
                continue
            rel_path = line[std_idx + len(" STANDARD "):].rstrip("/")
            if rel_path.startswith("DCIM/"):
                rel_path = rel_path[len("DCIM/"):]
            ver_match = re.search(r'/v(\d{14}-[a-fA-F0-9]+)$', rel_path)
            if not ver_match:
                continue
            version_seg = "v" + ver_match.group(1)
            filename = rel_path[:ver_match.start()]
            existing_ver = dcim_files.get(filename)
            if existing_ver is None or version_seg > existing_ver.rsplit("/", 1)[-1]:
                dcim_files[filename] = (
                    f"projects/{qf_project_id}/files/DCIM/{filename}/{version_seg}"
                )
        return dcim_files
    except Exception as e:
        print(f"    WARN: minio_list_dcim_directory error: {e}")
        return {}


def minio_download_latest(qf_project_id, gpkg_path, dest_path):
    """Download the latest version of a GPKG from MinIO."""
    prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None, None

        # Parse versions, pick latest.
        # Use STANDARD-marker parsing to handle filenames containing spaces.
        versions = []
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            std_idx = line.find(" STANDARD ")
            if std_idx == -1:
                continue
            ver = line[std_idx + len(" STANDARD "):].strip().rstrip("/")
            if ver:
                versions.append(ver)
        if not versions:
            return None, None

        versions.sort()
        latest = versions[-1]

        # Download
        src = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{gpkg_path}/{latest}"
        dl = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat", src],
            capture_output=True, timeout=30,
        )
        if dl.returncode != 0 or len(dl.stdout) < 1000:
            return None, None

        with open(dest_path, "wb") as f:
            f.write(dl.stdout)
        return latest, len(dl.stdout)

    except Exception as e:
        print(f"    MinIO error: {e}")
        return None, None


def minio_resolve_photo_version(qf_project_id, dcim_path):
    """Resolve DCIM/filename.jpg to its latest versioned MinIO path."""
    prefix = f"local/{MINIO_BUCKET}/projects/{qf_project_id}/files/{dcim_path}/"
    try:
        result = subprocess.run(
            ["docker", "exec", "qfieldcloud-minio-1", "mc", "ls", prefix],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0 or not result.stdout.strip():
            return None

        # Use STANDARD-marker parsing to handle filenames containing spaces.
        versions = []
        for line in result.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            std_idx = line.find(" STANDARD ")
            if std_idx == -1:
                continue
            ver = line[std_idx + len(" STANDARD "):].strip().rstrip("/")
            if ver:
                versions.append(ver)
        if not versions:
            return None

        versions.sort()
        return f"projects/{qf_project_id}/files/{dcim_path}/{versions[-1]}"
    except Exception:
        return None


# ── Main extraction ───────────────────────────────────────────────────────────

def extract_project(conn, project_name, config, dry_run=False, force=False):
    """Extract photo references from a project's GPKG and upsert into DB."""
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    qf_id = config["qf_project_id"]
    ff_id = config["ff_project_id"]

    print(f"\n{'='*60}")
    print(f"Project: {project_name}")
    print(f"  QField: {qf_id}")
    print(f"  GPKG:   {config['gpkg_path']}")

    # Check delta — skip if GPKG version unchanged
    if not force:
        cur.execute(
            "SELECT last_version FROM qfield_gpkg_sync_state WHERE qf_project_id = %s AND gpkg_path = %s",
            (qf_id, config["gpkg_path"]),
        )
        state = cur.fetchone()
    else:
        state = None

    # Download GPKG
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        version, size = minio_download_latest(qf_id, config["gpkg_path"], tmp_path)
        if not version:
            print(f"  SKIP: Could not download GPKG")
            return 0, 0

        print(f"  Version: {version} ({size // 1024}KB)")

        # Delta check
        if state and state["last_version"] == version and not force:
            print(f"  SKIP: Already processed this version")
            return 0, 0

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
                print(f"  ERROR: Table '{config['table_name']}' not found. Available: {tables}")
                db.close()
                return 0, 0

        rows = db.execute(f"SELECT * FROM [{table_name}]").fetchall()
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

        # ── Batch-list MinIO DCIM directory once per project ─────────────────
        # dcim_index maps filename.jpg -> versioned storage key (or absent if not uploaded)
        print(f"  Listing MinIO DCIM directory...")
        dcim_index = minio_list_dcim_directory(qf_id)
        print(f"  MinIO DCIM files found: {len(dcim_index)}")

        # Get existing photo keys in qfield_photo_validations for this project
        cur.execute(
            "SELECT photo_key FROM qfield_photo_validations WHERE project_id = %s",
            (qf_id,),
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
            """Return (storage_key, upload_status) for a DCIM-relative path.

            Uses the pre-fetched dcim_index for O(1) lookup instead of per-file
            docker exec calls. Falls back to the slow individual resolution only
            when the batch listing was empty (docker unavailable etc.).
            """
            filename = dcim_path.replace("DCIM/", "").lstrip("/")
            if dcim_index:
                versioned = dcim_index.get(filename)
                if versioned:
                    return versioned, "available"
                # File referenced in GPKG but absent from MinIO
                return f"projects/{qf_id}/files/{dcim_path}", "pending_upload"
            # Batch listing failed — fall back to individual resolution
            versioned = minio_resolve_photo_version(qf_id, dcim_path)
            if versioned:
                return versioned, "available"
            return f"projects/{qf_id}/files/{dcim_path}", "pending_upload"

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

                full_key, upload_status = _resolve_key(dcim_path)

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

                # Upsert into qfield_photo_validations
                cur.execute("""
                    INSERT INTO qfield_photo_validations
                    (id, photo_key, feature_id, feature_type, work_type, project_id,
                     checklist_step, step_label, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s::uuid, %s, %s, NOW())
                    ON CONFLICT (id) DO NOTHING
                """, (
                    str(uuid.uuid4()), full_key, feature_id,
                    "pole", "pole_installation", qf_id,
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

                full_key, upload_status = _resolve_key(dcim_path)

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
                    "pole", "pole_installation", qf_id,
                    None, None,
                ))
                existing_keys.add(full_key)
                existing_filenames.add(base_fn)
                photos_upserted += 1

        if photos_skipped_missing:
            print(f"  Skipped {photos_skipped_missing} photos not yet uploaded to MinIO")

        db.close()

        # ── Sync PON/zone assignments from GPKG to poles + reviews ──
        if not dry_run:
            poles_pon_updated = sync_pon_zone(cur, conn, ff_id, rows, columns, label_col)
            if poles_pon_updated > 0:
                print(f"  PON/zone: {poles_pon_updated} poles updated, cascading to reviews...")
                cur.execute("""
                    UPDATE construction_qa_reviews r
                    SET zone_no = p.zone_no, pon_no = p.pon_no, updated_at = NOW()
                    FROM poles p
                    WHERE r.project_id = %s
                      AND r.feature_type = 'pole'
                      AND r.feature_id = p.pole_number
                      AND p.project_id = r.project_id
                      AND (r.zone_no IS DISTINCT FROM p.zone_no OR r.pon_no IS DISTINCT FROM p.pon_no)
                """, (ff_id,))
                reviews_updated = cur.rowcount
                conn.commit()
                print(f"  PON/zone: {reviews_updated} reviews updated")

        if not dry_run:
            # Update sync state
            cur.execute("""
                INSERT INTO qfield_gpkg_sync_state (qf_project_id, gpkg_path, last_version, last_synced_at, row_count)
                VALUES (%s::uuid, %s, %s, NOW(), %s)
                ON CONFLICT (qf_project_id, gpkg_path) DO UPDATE SET
                    last_version = EXCLUDED.last_version,
                    last_synced_at = NOW(),
                    row_count = EXCLUDED.row_count
            """, (qf_id, config["gpkg_path"], version, len(rows)))
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
