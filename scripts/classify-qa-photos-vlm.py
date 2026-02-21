#!/usr/bin/env python3
"""
Batch VLM classification of unassigned construction QA photos.

Downloads each unclassified photo from SharePoint or QField (MinIO),
sends to VLM (Qwen3-VL on Velocity:8100) for visual classification
into checklist steps, and updates the DB.

Usage:
  python3 scripts/classify-qa-photos-vlm.py --project Lawley --limit 50 --dry-run
  python3 scripts/classify-qa-photos-vlm.py --project all --limit 200
  python3 scripts/classify-qa-photos-vlm.py --source qfield --project all --limit 500
  python3 scripts/classify-qa-photos-vlm.py --source all --project all --limit 1000

Requires: psycopg2, requests, Pillow
"""

import argparse
import base64
import io
import json
import re
import subprocess
import sys
import time

import psycopg2
import psycopg2.extras
import requests

# -- SharePoint Graph API config -----------------------------------------------

SP_TENANT_ID = "f22e6344-a35d-43b0-ad8c-a247f513c1ee"
SP_CLIENT_ID = "075bd672-bffa-45ba-9fd0-724535e612db"
SP_CLIENT_SECRET = "Ozw8Q~HG1PMZFPNb0Ze1f-eTYrtglVioRzy2lakF"
GRAPH_BASE = "https://graph.microsoft.com/v1.0"

# -- MinIO / QField config -----------------------------------------------------

VELOCITY_HOST = "100.96.203.105"
VELOCITY_USER = "velo"
MINIO_BUCKET = "qfieldcloud-prod"
MINIO_CONTAINER = "qfieldcloud-minio-1"

# -- VLM config ----------------------------------------------------------------

VLM_URL = "http://100.96.203.105:8100"
VLM_MODEL = "Qwen/Qwen3-VL-8B-Instruct"
VLM_MAX_DIM = 1024

# -- Checklist definitions -----------------------------------------------------

CIVIL_STEPS = {
    1: "Foundation / Base",
    2: "Full Pole Visible",
    3: "Pole Label",
    4: "CCA H4 Tag",
    5: "Vertical Alignment",
    6: "Guy Wires / Stays",
    7: "Slack Bracket",
}

CIVIL_STEP_DB_COLS = {
    1: "civil_step_01_foundation",
    2: "civil_step_02_full_pole",
    3: "civil_step_03_pole_label",
    4: "civil_step_04_cca_tag",
    5: "civil_step_05_vertical",
    6: "civil_step_06_guy_wires",
    7: "civil_step_07_slack_bracket",
}

VLM_CLASSIFY_PROMPT = """You are a construction QA photo classifier for fiber optic pole planting.

Classify this photo into exactly ONE of these 7 checklist steps:

1. Foundation / Base — Shows the hole, depth measurement, compaction, concrete at pole base, backfill, or excavation BEFORE the pole is fully erected. Ground-level close-up of the base area.
2. Full Pole Visible — Shows the complete pole standing upright, visible from base to top. A wide shot showing the full pole in the landscape.
3. Pole Label — Close-up of the pole number tag/label attached to the pole. Shows text/numbers on a metal or plastic tag.
4. CCA H4 Tag — Close-up of the CCA/H4 treatment stamp or tag on the pole wood. Usually stamped text saying "CCA H4" or similar.
5. Vertical Alignment — Shows the pole's vertical alignment/plumb. Usually taken from a distance to show the pole is straight.
6. Guy Wires / Stays — Shows guy wires or stay cables attached to the pole for stabilization. Wires running from pole to ground anchors.
7. Slack Bracket — Shows a slack bracket or cable management hardware mounted on the pole.
0. Unrelated — Photo does not clearly show any of the above (e.g. team selfie, vehicle, landscape without pole, blurry/dark photo).

Respond with ONLY a JSON object:
{"step": <number 0-7>, "confidence": <0.0-1.0>, "reason": "<brief reason>"}"""


def get_sp_token():
    """Get MS Graph API bearer token."""
    resp = requests.post(
        f"https://login.microsoftonline.com/{SP_TENANT_ID}/oauth2/v2.0/token",
        data={
            "client_id": SP_CLIENT_ID,
            "client_secret": SP_CLIENT_SECRET,
            "scope": "https://graph.microsoft.com/.default",
            "grant_type": "client_credentials",
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def download_sp_photo(token, drive_id, item_id):
    """Download a photo from SharePoint. Returns bytes or None."""
    url = f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/content"
    try:
        resp = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60)
        resp.raise_for_status()
        if len(resp.content) > 10_000_000:
            return None
        return resp.content
    except Exception:
        return None


def download_qfield_photo(storage_key, local_minio=False):
    """Download a photo from QField MinIO. Returns bytes or None.

    If local_minio=True, runs docker exec directly (for running on Velocity).
    Otherwise, SSHes to Velocity first.
    """
    object_path = storage_key.lstrip("/")
    mc_path = f"local/{MINIO_BUCKET}/{object_path}"
    escaped_path = mc_path.replace("'", "'\\''")

    if local_minio:
        cmd = ["docker", "exec", MINIO_CONTAINER, "mc", "cat", mc_path]
    else:
        cmd = [
            "ssh", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10",
            f"{VELOCITY_USER}@{VELOCITY_HOST}",
            f"docker exec {MINIO_CONTAINER} mc cat '{escaped_path}'"
        ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0:
            return None
        data = result.stdout
        if len(data) < 100 or len(data) > 10_000_000:
            return None
        # Validate magic bytes (JPEG or PNG)
        if data[:2] == b'\xff\xd8' or data[:4] == b'\x89PNG':
            return data
        return None
    except (subprocess.TimeoutExpired, Exception):
        return None


def resize_for_vlm(photo_bytes):
    """Resize photo for VLM token limits. Returns base64 JPEG string."""
    from PIL import Image
    img = Image.open(io.BytesIO(photo_bytes))
    img.thumbnail((VLM_MAX_DIM, VLM_MAX_DIM), Image.LANCZOS)
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def vlm_classify(photo_b64):
    """Send photo to VLM for civil step classification.

    Returns (step, confidence, reason) or (None, None, error_msg).
    """
    try:
        resp = requests.post(
            f"{VLM_URL}/v1/chat/completions",
            json={
                "model": VLM_MODEL,
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}", "detail": "high"},
                        },
                        {"type": "text", "text": VLM_CLASSIFY_PROMPT},
                    ],
                }],
                "max_tokens": 256,
                "temperature": 0.1,
            },
            timeout=60,
        )
        resp.raise_for_status()
        text = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        return parse_classification(text)
    except Exception as e:
        return None, None, str(e)


def parse_classification(text):
    """Parse VLM classification response.

    Returns (step, confidence, reason).
    """
    try:
        json_match = re.search(r"\{[^}]*\}", text)
        if json_match:
            parsed = json.loads(json_match.group())
            step = int(parsed.get("step", 0))
            confidence = float(parsed.get("confidence", 0))
            reason = parsed.get("reason", "")
            if 0 <= step <= 7 and 0 <= confidence <= 1:
                return step, confidence, reason
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Fallback: look for step number in text
    m = re.search(r"step\s*[:#]?\s*(\d)", text, re.IGNORECASE)
    if m:
        step = int(m.group(1))
        if 0 <= step <= 7:
            return step, 0.5, text[:100]

    return None, None, f"Could not parse: {text[:100]}"


def run_classification(project_name, db_url, limit=100, dry_run=False, discipline="civil", source="all", local_minio=False):
    """Batch classify unassigned photos via VLM."""
    print(f"\n{'='*70}")
    print(f"  VLM Photo Classification — {discipline.title()}")
    print(f"  Project: {project_name}")
    print(f"  Source: {source}")
    print(f"  Limit: {limit}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"{'='*70}\n")

    # -- Auth ------------------------------------------------------------------
    print("  [1/3] Setup...")
    sp_token = None
    if source in ("sharepoint", "all"):
        try:
            sp_token = get_sp_token()
        except Exception as e:
            if source == "sharepoint":
                print(f"    ERROR: SharePoint auth failed: {e}")
                sys.exit(1)
            print(f"    WARN: SharePoint auth failed, will skip SP photos: {e}")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Get project ID
    project_filter = ""
    params = []
    if project_name.lower() != "all":
        cur.execute("SELECT id FROM projects WHERE project_name = %s", (project_name,))
        row = cur.fetchone()
        if not row:
            print(f"    ERROR: Project '{project_name}' not found")
            sys.exit(1)
        project_filter = "AND p.project_id = %s::uuid"
        params.append(str(row["id"]))

    # Build source filter
    if source == "all":
        source_filter = "AND p.source IN ('sharepoint', 'qfield')"
    else:
        source_filter = f"AND p.source = '{source}'"

    # -- Fetch unclassified photos ---------------------------------------------
    print("  [2/3] Fetching unclassified photos...")
    query = f"""
        SELECT p.id, p.storage_key, p.source, p.filename, p.review_id,
               r.feature_id, r.discipline, pr.project_name
        FROM construction_qa_photos p
        JOIN construction_qa_reviews r ON r.id = p.review_id
        JOIN projects pr ON pr.id = p.project_id
        WHERE p.checklist_step IS NULL
          AND r.discipline = %s
          {source_filter}
          {project_filter}
        ORDER BY pr.project_name, r.feature_id
        LIMIT %s
    """
    cur.execute(query, [discipline] + params + [limit])
    photos = cur.fetchall()
    print(f"    Found {len(photos)} unclassified {discipline} photos to process\n")

    if not photos:
        print("    Nothing to do.")
        cur.close()
        conn.close()
        return

    # -- Classify each photo ---------------------------------------------------
    print("  [3/3] Classifying via VLM...\n")
    stats = {"classified": 0, "unrelated": 0, "failed": 0, "skipped": 0}
    step_counts = {i: 0 for i in range(8)}
    review_updates = {}  # review_id -> set of steps found
    start_time = time.time()

    for i, photo in enumerate(photos):
        photo_id = str(photo["id"])
        storage_key = photo["storage_key"]
        photo_source = photo["source"]
        filename = photo["filename"] or "unknown"
        feature = photo["feature_id"]
        proj = photo["project_name"]

        # Progress
        elapsed = time.time() - start_time
        rate = (i + 1) / elapsed if elapsed > 0 else 0
        eta = (len(photos) - i - 1) / rate if rate > 0 else 0

        src_tag = "SP" if photo_source == "sharepoint" else "QF"
        print(f"    [{i+1}/{len(photos)}] [{src_tag}] {proj}/{feature}/{filename[:30]}", end=" ", flush=True)

        # Download based on source
        photo_bytes = None
        if photo_source == "sharepoint":
            parts = storage_key.split(":")
            if len(parts) < 3 or parts[0] != "sharepoint":
                stats["skipped"] += 1
                print("bad key")
                continue
            drive_id = parts[1]
            item_id = ":".join(parts[2:])
            photo_bytes = download_sp_photo(sp_token, drive_id, item_id)
        elif photo_source == "qfield":
            photo_bytes = download_qfield_photo(storage_key, local_minio=local_minio)
        else:
            stats["skipped"] += 1
            print(f"unknown source: {photo_source}")
            continue

        if not photo_bytes:
            print("download failed")
            stats["failed"] += 1
            continue

        # Resize + classify
        try:
            b64 = resize_for_vlm(photo_bytes)
        except Exception as e:
            print(f"resize error: {e}")
            stats["failed"] += 1
            continue

        step, confidence, reason = vlm_classify(b64)

        if step is None:
            print(f"parse error: {reason[:50]}")
            stats["failed"] += 1
            continue

        if step == 0:
            print(f"-> unrelated ({confidence:.2f}): {reason[:40]}")
            stats["unrelated"] += 1
            # Still update the photo so we don't reprocess it
            if not dry_run:
                cur.execute("""
                    UPDATE construction_qa_photos
                    SET checklist_step = 0, step_label = 'Unrelated',
                        vlm_confidence = %s, vlm_feedback = %s, vlm_processed_at = NOW(), updated_at = NOW()
                    WHERE id = %s::uuid
                """, (confidence, reason[:500], photo_id))
            continue

        step_label = CIVIL_STEPS.get(step, f"Step {step}")
        print(f"-> Step {step}: {step_label} ({confidence:.2f})")

        step_counts[step] += 1
        stats["classified"] += 1

        # Track which reviews need step boolean updates
        review_id = str(photo["review_id"])
        review_updates.setdefault(review_id, set()).add(step)

        if not dry_run:
            cur.execute("""
                UPDATE construction_qa_photos
                SET checklist_step = %s, step_label = %s,
                    vlm_confidence = %s, vlm_feedback = %s, vlm_processed_at = NOW(), updated_at = NOW()
                WHERE id = %s::uuid
            """, (step, step_label, confidence, reason[:500], photo_id))

        # Commit every 25 photos
        if not dry_run and (i + 1) % 25 == 0:
            conn.commit()
            if elapsed > 0:
                print(f"        -- committed, {rate:.1f} photos/s, ETA {int(eta)}s --")

    # -- Update review step booleans -------------------------------------------
    if not dry_run and review_updates:
        print(f"\n    Updating step flags on {len(review_updates)} reviews...")
        for review_id, steps in review_updates.items():
            set_clauses = []
            for s in steps:
                col = CIVIL_STEP_DB_COLS.get(s)
                if col:
                    set_clauses.append(f"{col} = TRUE")
            if set_clauses:
                sql = f"UPDATE construction_qa_reviews SET {', '.join(set_clauses)}, updated_at = NOW() WHERE id = %s::uuid"
                cur.execute(sql, (review_id,))

    if not dry_run:
        conn.commit()

    elapsed = time.time() - start_time

    # -- Summary ---------------------------------------------------------------
    print(f"\n{'='*70}")
    print(f"  CLASSIFICATION {'(DRY RUN) ' if dry_run else ''}COMPLETE")
    print(f"  Photos processed:  {len(photos)}")
    print(f"  Classified:        {stats['classified']}")
    print(f"  Unrelated (step 0):{stats['unrelated']}")
    print(f"  Failed:            {stats['failed']}")
    print(f"  Skipped:           {stats['skipped']}")
    print(f"  Time:              {elapsed:.0f}s ({len(photos)/elapsed:.1f} photos/s)")
    print(f"  Reviews updated:   {len(review_updates)}")
    print(f"\n  Step distribution:")
    for s in range(1, 8):
        bar = "#" * min(step_counts[s], 50)
        print(f"    {s}. {CIVIL_STEPS[s]:25s} {step_counts[s]:4d} {bar}")
    print(f"    0. {'Unrelated':25s} {stats['unrelated']:4d}")
    print(f"{'='*70}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch VLM classification of unassigned QA photos")
    parser.add_argument("--project", required=True, help="Project name or 'all'")
    parser.add_argument("--limit", type=int, default=100, help="Max photos to process (default 100)")
    parser.add_argument("--dry-run", action="store_true", help="Classify but don't update DB")
    parser.add_argument("--discipline", default="civil", help="Discipline to classify (default: civil)")
    parser.add_argument("--source", default="all", choices=["sharepoint", "qfield", "all"],
                        help="Photo source to classify (default: all)")
    parser.add_argument("--local-minio", action="store_true",
                        help="Use local docker exec for MinIO (when running on Velocity)")
    parser.add_argument("--db-url", help="Database URL (defaults to DATABASE_URL env var)")
    args = parser.parse_args()

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("ERROR: Requires Pillow. Install with: pip install Pillow")
        sys.exit(1)

    import os
    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: No database URL. Set DATABASE_URL or use --db-url")
        sys.exit(1)

    run_classification(args.project, db_url, limit=args.limit, dry_run=args.dry_run,
                       discipline=args.discipline, source=args.source,
                       local_minio=args.local_minio)
