#!/usr/bin/env python3
"""
Targeted VLM reclassification of "Unrelated" photos on partial-coverage poles.

For each pending civil pole that is missing exactly 1-2 checklist steps and has
at least one photo classified as Unrelated (checklist_step=0), the script asks
the VLM a binary YES/NO question per missing step.  If the VLM answers YES with
confidence >= 0.8, the photo is reclassified to that step and the review's step
boolean flag is updated.

Usage:
  python3 scripts/reclassify-targeted.py --project Lawley --dry-run
  python3 scripts/reclassify-targeted.py --project Lawley --limit 200
  python3 scripts/reclassify-targeted.py --project all --limit 500 --local-minio

Requires: psycopg2, requests, Pillow
"""

import argparse
import base64
import io
import json
import os
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
VLM_MODEL = "QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ"
VLM_MAX_DIM = 1024

# -- Confidence threshold for accepting a reclassification ---------------------

CONFIDENCE_THRESHOLD = 0.8

# ==============================================================================
# Civil step definitions — Pole Install Capture Checklist
# ==============================================================================

CIVIL_STEPS = {
    1: "Before Photo",
    2: "During Photo",
    3: "Depth Photo",
    4: "End Plates",
    5: "Compaction / Backfill",
    6: "Level Check",
    7: "After Photo",
    8: "Signature",
}

CIVIL_STEP_DB_COLS = {
    1: "civil_step_01_before_photo",
    2: "civil_step_02_during_photo",
    3: "civil_step_03_depth_photo",
    4: "civil_step_04_end_plates",
    5: "civil_step_05_compaction",
    6: "civil_step_06_level_check",
    7: "civil_step_07_after_photo",
    8: "civil_step_08_signature",
}

# ==============================================================================
# Binary VLM prompts — one per step (or grouped where logic is identical).
# Format: the placeholder {step_name} is not used here; prompts are keyed by
# step number for clarity.
# ==============================================================================

BINARY_PROMPTS = {
    # Steps 1 & 2 share "before/during digging" visual language
    1: (
        "Does this photo show: ground markings where a hole will be dug, an area before pole "
        "installation begins, workers digging, tools near a hole, or any active construction/"
        "digging activity? Answer YES if ANY of these are visible."
    ),
    2: (
        "Does this photo show: ground markings where a hole will be dug, an area before pole "
        "installation begins, workers digging, tools near a hole, or any active construction/"
        "digging activity? Answer YES if ANY of these are visible."
    ),
    3: (
        "Does this photo show: a measuring tape or ruler placed inside a dug hole to show depth? "
        "Answer YES only if a measurement tool inside a hole is clearly visible."
    ),
    4: (
        "Does this photo show: end plates on a pole, metal plates at base/top of pole, CCA H4 tags, "
        "yellow identification labels with zone/PON numbers, pole markings, close-up of pole "
        "identification, or a pole end with visible metal insert? "
        "Answer YES if ANY of these are visible."
    ),
    5: (
        "Does this photo show: backfill material around a pole base, sand and cement mix around an "
        "installed pole, blue powder or cement around pole base, ground being compacted, or aggregate "
        "material packed around the base of a standing pole? Answer YES if ANY of these are visible."
    ),
    6: (
        "Does this photo show: a spirit level (bubble level tool) held against a pole? "
        "Answer YES only if a spirit level tool is clearly visible."
    ),
    7: (
        "Does this photo show: a pole standing upright in the landscape, a completed pole installation "
        "viewed from any distance, or a pole installed in the ground even if partially obscured by "
        "buildings? Answer YES if a standing installed pole is visible."
    ),
    # Step 8 (Signature) — rarely Unrelated, but handle it anyway
    8: (
        "Does this photo show: a contractor signature, a sign-off sheet, or a completion document "
        "with a handwritten signature? Answer YES only if a signature or signed form is clearly visible."
    ),
}

# Binary response template instructed to VLM
BINARY_INSTRUCTION = (
    "\n\nRespond with ONLY a JSON object — no other text:\n"
    '{"match": true or false, "confidence": 0.0-1.0, "reason": "<10 words>"}'
)

# ==============================================================================
# Download helpers — copied verbatim from classify-qa-photos-vlm.py
# ==============================================================================


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
        resp = requests.get(
            url, headers={"Authorization": f"Bearer {token}"}, timeout=60
        )
        resp.raise_for_status()
        if len(resp.content) > 50_000_000:
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
            f"docker exec {MINIO_CONTAINER} mc cat '{escaped_path}'",
        ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0:
            return None
        data = result.stdout
        if len(data) < 100 or len(data) > 50_000_000:
            return None
        # Validate magic bytes (JPEG or PNG)
        if data[:2] == b"\xff\xd8" or data[:4] == b"\x89PNG":
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


# ==============================================================================
# VLM binary query
# ==============================================================================


def vlm_binary_call(photo_b64, step_number):
    """Ask the VLM a binary YES/NO question for a single step.

    Returns (match: bool, confidence: float, reason: str) or (None, None, error).
    """
    base_question = BINARY_PROMPTS.get(step_number)
    if not base_question:
        return None, None, f"No prompt defined for step {step_number}"

    prompt = base_question + BINARY_INSTRUCTION

    try:
        resp = requests.post(
            f"{VLM_URL}/v1/chat/completions",
            json={
                "model": VLM_MODEL,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/jpeg;base64,{photo_b64}",
                                    "detail": "high",
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
                "max_tokens": 128,
                "temperature": 0.1,
            },
            timeout=60,
        )
        resp.raise_for_status()
        raw = resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception as e:
        return None, None, f"VLM request failed: {e}"

    return parse_binary_response(raw)


def parse_binary_response(text):
    """Parse {"match": bool, "confidence": float, "reason": str} from VLM text.

    Returns (match: bool | None, confidence: float | None, reason: str).
    """
    try:
        json_match = re.search(r"\{[^}]*\}", text, re.DOTALL)
        if json_match:
            parsed = json.loads(json_match.group())
            match = parsed.get("match")
            confidence = float(parsed.get("confidence", 0.0))
            reason = str(parsed.get("reason", ""))
            if isinstance(match, bool) and 0.0 <= confidence <= 1.0:
                return match, confidence, reason
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Fallback: look for YES/NO keywords
    lower = text.lower()
    if "yes" in lower:
        return True, 0.5, text[:80]
    if "no" in lower:
        return False, 0.5, text[:80]

    return None, None, f"Could not parse: {text[:80]}"


# ==============================================================================
# Photo download helper (routing by source)
# ==============================================================================


def fetch_photo_bytes(photo, sp_token, local_minio):
    """Download photo bytes from the correct source. Returns bytes or None."""
    source = photo["source"]
    storage_key = photo["storage_key"]

    if source == "sharepoint":
        parts = storage_key.split(":")
        if len(parts) < 3 or parts[0] != "sharepoint":
            return None, "bad sharepoint key"
        drive_id = parts[1]
        item_id = ":".join(parts[2:])
        if not sp_token:
            return None, "no SP token"
        return download_sp_photo(sp_token, drive_id, item_id), None

    if source == "qfield":
        return download_qfield_photo(storage_key, local_minio=local_minio), None

    return None, f"unknown source: {source}"


# ==============================================================================
# SQL helpers
# ==============================================================================

PARTIAL_POLES_QUERY = """
SELECT
    r.id          AS review_id,
    r.feature_id,
    NOT (r.civil_step_01_before_photo OR r.civil_step_02_during_photo)
                  AS needs_before_during,
    NOT r.civil_step_03_depth_photo   AS needs_depth,
    NOT r.civil_step_04_end_plates    AS needs_end_plates,
    NOT r.civil_step_05_compaction    AS needs_compaction,
    NOT r.civil_step_06_level_check   AS needs_level,
    NOT r.civil_step_07_after_photo   AS needs_after,
    NOT r.civil_step_08_signature     AS needs_signature
FROM construction_qa_reviews r
WHERE r.project_id = %s::uuid
  AND r.workflow_status = 'pending'
  AND r.discipline = 'civil'
  AND r.photo_count >= 5
  AND (
        CASE WHEN NOT (r.civil_step_01_before_photo OR r.civil_step_02_during_photo) THEN 1 ELSE 0 END
      + CASE WHEN NOT r.civil_step_03_depth_photo   THEN 1 ELSE 0 END
      + CASE WHEN NOT r.civil_step_04_end_plates    THEN 1 ELSE 0 END
      + CASE WHEN NOT r.civil_step_05_compaction    THEN 1 ELSE 0 END
      + CASE WHEN NOT r.civil_step_06_level_check   THEN 1 ELSE 0 END
      + CASE WHEN NOT r.civil_step_07_after_photo   THEN 1 ELSE 0 END
     ) BETWEEN 1 AND 3
ORDER BY r.feature_id
LIMIT %s
"""

UNRELATED_PHOTOS_QUERY = """
SELECT p.id, p.storage_key, p.source, p.filename
FROM construction_qa_photos p
WHERE p.review_id = %s::uuid
  AND p.checklist_step = 0
ORDER BY p.created_at
"""

UPDATE_PHOTO_SQL = """
UPDATE construction_qa_photos
SET checklist_step    = %s,
    step_label        = %s,
    vlm_confidence    = %s,
    vlm_feedback      = %s,
    vlm_processed_at  = NOW(),
    updated_at        = NOW()
WHERE id = %s::uuid
"""

UPDATE_REVIEW_FLAG_SQL_TEMPLATE = """
UPDATE construction_qa_reviews
SET {col} = TRUE, updated_at = NOW()
WHERE id = %s::uuid
"""


def missing_steps_for_pole(pole_row):
    """Return list of (step_number, db_col) pairs that are still missing.

    Steps 1 and 2 share needs_before_during — if that flag is True we queue
    step 1 first, then step 2, giving Unrelated photos two chances.
    """
    missing = []
    if pole_row["needs_before_during"]:
        missing.append(1)  # Before Photo
        missing.append(2)  # During Photo — second chance with same flag
    if pole_row["needs_depth"]:
        missing.append(3)
    if pole_row["needs_end_plates"]:
        missing.append(4)
    if pole_row["needs_compaction"]:
        missing.append(5)
    if pole_row["needs_level"]:
        missing.append(6)
    if pole_row["needs_after"]:
        missing.append(7)
    if pole_row.get("needs_signature"):
        missing.append(8)
    return missing


# ==============================================================================
# Main reclassification routine
# ==============================================================================


def run_reclassification(project_name, db_url, limit=500, dry_run=False, local_minio=False):
    """Main entry point for targeted reclassification."""
    print(f"\n{'='*70}")
    print("  Targeted VLM Reclassification — Unrelated Photos on Partial Poles")
    print(f"  Project:    {project_name}")
    print(f"  Limit:      {limit} poles")
    print(f"  Threshold:  confidence >= {CONFIDENCE_THRESHOLD}")
    print(f"  Mode:       {'DRY RUN (no DB writes)' if dry_run else 'LIVE'}")
    print(f"{'='*70}\n")

    # -- Setup -----------------------------------------------------------------
    print("  [1/4] Authenticating...")

    sp_token = None
    try:
        sp_token = get_sp_token()
        print("    SharePoint token: OK")
    except Exception as e:
        print(f"    SharePoint token: FAILED ({e}) — SharePoint photos will be skipped")

    conn = psycopg2.connect(db_url)
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # -- Resolve project -------------------------------------------------------
    print("  [2/4] Resolving project...")
    if project_name.lower() == "all":
        cur.execute("SELECT id, project_name FROM projects ORDER BY project_name")
        projects = cur.fetchall()
    else:
        cur.execute(
            "SELECT id, project_name FROM projects WHERE project_name = %s",
            (project_name,),
        )
        projects = cur.fetchall()
        if not projects:
            print(f"    ERROR: Project '{project_name}' not found")
            cur.close()
            conn.close()
            sys.exit(1)

    print(f"    Found {len(projects)} project(s)")

    # -- Collect all partial poles ---------------------------------------------
    print("  [3/4] Fetching partial-coverage poles (missing 1-2 steps, photo_count >= 5)...")

    all_poles = []
    for proj in projects:
        cur.execute(PARTIAL_POLES_QUERY, (str(proj["id"]), limit))
        rows = cur.fetchall()
        for row in rows:
            all_poles.append((proj["project_name"], dict(row)))
        if rows:
            print(f"    {proj['project_name']}: {len(rows)} partial poles")

    # Apply overall limit across projects
    if len(all_poles) > limit:
        all_poles = all_poles[:limit]

    print(f"    Total: {len(all_poles)} partial poles to examine\n")

    if not all_poles:
        print("    Nothing to do — no partial poles with Unrelated photos found.")
        cur.close()
        conn.close()
        return

    # -- Process each pole -----------------------------------------------------
    print("  [4/4] Processing poles...\n")

    stats = {
        "poles_examined": 0,
        "poles_skipped_no_unrelated": 0,
        "photos_examined": 0,
        "photos_reclassified": 0,
        "photos_no_match": 0,
        "photos_download_failed": 0,
        "photos_vlm_failed": 0,
        "poles_promoted": 0,      # became fully covered after reclassification
    }

    commit_counter = 0

    for proj_name, pole in all_poles:
        review_id = str(pole["review_id"])
        feature_id = pole["feature_id"]
        stats["poles_examined"] += 1

        # Which steps are still missing?
        missing = missing_steps_for_pole(pole)
        missing_labels = [CIVIL_STEPS[s] for s in dict.fromkeys(missing)]  # deduplicated labels

        # Fetch Unrelated photos for this pole
        cur.execute(UNRELATED_PHOTOS_QUERY, (review_id,))
        unrelated_photos = cur.fetchall()

        if not unrelated_photos:
            stats["poles_skipped_no_unrelated"] += 1
            continue

        print(
            f"  Pole {feature_id} ({proj_name})"
            f" — missing: {', '.join(missing_labels)}"
            f" — {len(unrelated_photos)} Unrelated photo(s)"
        )

        # Track which steps we have already filled in this pole's session
        # (avoids reclassifying two photos to the same step)
        filled_steps = set()
        reclassified_count = 0

        for step_number in dict.fromkeys(missing):  # unique missing steps in order
            if step_number in filled_steps:
                continue

            step_label = CIVIL_STEPS[step_number]
            db_col = CIVIL_STEP_DB_COLS[step_number]

            for photo in unrelated_photos:
                photo_id = str(photo["id"])
                filename = photo["filename"] or "unknown"
                stats["photos_examined"] += 1

                # Download
                photo_bytes, err = fetch_photo_bytes(photo, sp_token, local_minio)
                if not photo_bytes:
                    reason = err or "download failed"
                    print(f"    [{photo_id[:8]}] {filename[:35]} -> download failed ({reason})")
                    stats["photos_download_failed"] += 1
                    continue

                # Resize
                try:
                    b64 = resize_for_vlm(photo_bytes)
                except Exception as exc:
                    print(f"    [{photo_id[:8]}] {filename[:35]} -> resize error: {exc}")
                    stats["photos_vlm_failed"] += 1
                    continue

                # Binary VLM query
                match, confidence, reason = vlm_binary_call(b64, step_number)

                if match is None:
                    print(
                        f"    [{photo_id[:8]}] {filename[:35]}"
                        f" Step {step_number} ({step_label}) -> VLM parse error: {reason[:50]}"
                    )
                    stats["photos_vlm_failed"] += 1
                    continue

                conf_str = f"{confidence:.2f}"
                if match and confidence >= CONFIDENCE_THRESHOLD:
                    print(
                        f"    [{photo_id[:8]}] {filename[:35]}"
                        f" Step {step_number} ({step_label}) -> MATCH {conf_str}: {reason[:50]}"
                    )
                    stats["photos_reclassified"] += 1
                    reclassified_count += 1
                    filled_steps.add(step_number)

                    if not dry_run:
                        # Update photo record
                        cur.execute(
                            UPDATE_PHOTO_SQL,
                            (step_number, step_label, confidence, reason[:500], photo_id),
                        )
                        # Update review step boolean flag
                        flag_sql = UPDATE_REVIEW_FLAG_SQL_TEMPLATE.format(col=db_col)
                        cur.execute(flag_sql, (review_id,))

                    # One photo per step is enough — stop checking remaining Unrelated photos
                    break

                else:
                    direction = "YES but low conf" if match else "NO"
                    print(
                        f"    [{photo_id[:8]}] {filename[:35]}"
                        f" Step {step_number} ({step_label}) -> {direction} {conf_str}: {reason[:40]}"
                    )
                    stats["photos_no_match"] += 1

        # Did we fill all missing steps for this pole?
        if not dry_run and reclassified_count > 0:
            # Re-check coverage: are all 6 checklist steps now TRUE?
            cur.execute(
                """
                SELECT
                    (civil_step_01_before_photo OR civil_step_02_during_photo) AS ok_before,
                    civil_step_03_depth_photo   AS ok_depth,
                    civil_step_04_end_plates    AS ok_end_plates,
                    civil_step_05_compaction    AS ok_compaction,
                    civil_step_06_level_check   AS ok_level,
                    civil_step_07_after_photo   AS ok_after
                FROM construction_qa_reviews
                WHERE id = %s::uuid
                """,
                (review_id,),
            )
            coverage = cur.fetchone()
            if coverage and all(coverage.values()):
                stats["poles_promoted"] += 1
                print(f"    -> Pole {feature_id} is now fully covered (all 6 steps present)")

        # Commit every 10 poles
        commit_counter += 1
        if not dry_run and commit_counter % 10 == 0:
            conn.commit()
            print(f"    -- committed after {commit_counter} poles --")

    # Final commit
    if not dry_run:
        conn.commit()

    cur.close()
    conn.close()

    # -- Summary ---------------------------------------------------------------
    print(f"\n{'='*70}")
    print(f"  RECLASSIFICATION {'(DRY RUN) ' if dry_run else ''}COMPLETE")
    print(f"  Poles examined:           {stats['poles_examined']}")
    print(f"  Poles skipped (no unrelated photos): {stats['poles_skipped_no_unrelated']}")
    print(f"  Photos examined:          {stats['photos_examined']}")
    print(f"  Photos reclassified:      {stats['photos_reclassified']}")
    print(f"  Photos no match:          {stats['photos_no_match']}")
    print(f"  Photos download failed:   {stats['photos_download_failed']}")
    print(f"  Photos VLM failed:        {stats['photos_vlm_failed']}")
    print(f"  Poles promoted (fully covered): {stats['poles_promoted']}")
    print(f"{'='*70}")


# ==============================================================================
# CLI
# ==============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description=(
            "Targeted VLM reclassification: asks binary YES/NO per missing step "
            "for Unrelated photos on partial-coverage poles."
        )
    )
    parser.add_argument(
        "--project",
        required=True,
        help="Project name (must match projects.project_name) or 'all'",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=500,
        help="Max poles to process across all projects (default 500)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run VLM queries but do not write to the database",
    )
    parser.add_argument(
        "--db-url",
        help="PostgreSQL connection string (defaults to DATABASE_URL env var)",
    )
    parser.add_argument(
        "--local-minio",
        action="store_true",
        help="Use local docker exec for MinIO (when running directly on Velocity)",
    )
    args = parser.parse_args()

    try:
        from PIL import Image  # noqa: F401
    except ImportError:
        print("ERROR: Requires Pillow. Install with: pip install Pillow")
        sys.exit(1)

    db_url = args.db_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: No database URL. Set DATABASE_URL or use --db-url")
        sys.exit(1)

    run_reclassification(
        project_name=args.project,
        db_url=db_url,
        limit=args.limit,
        dry_run=args.dry_run,
        local_minio=args.local_minio,
    )
