#!/usr/bin/env python3
"""
Batch VLM classification of unassigned construction QA photos.

Downloads each unclassified photo from SharePoint or QField (MinIO),
sends to VLM (Qwen3-VL on Velocity:8100) for visual classification
into checklist steps per Velocity Fibre / Fibertime spec documents:
  - Pole Install Capture Checklist (8 civil steps)
  - Optical Checklist: Distribution Dome (8 steps) + Main Joint (6 steps)

Usage:
  python3 scripts/classify-qa-photos-vlm.py --project Lawley --limit 50 --dry-run
  python3 scripts/classify-qa-photos-vlm.py --project all --limit 200
  python3 scripts/classify-qa-photos-vlm.py --discipline splicing --project all --limit 500
  python3 scripts/classify-qa-photos-vlm.py --source qfield --project all --limit 1000
  python3 scripts/classify-qa-photos-vlm.py --reclassify --project all --limit 1000

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

# ==============================================================================
# Checklist definitions — aligned with Velocity Fibre / Fibertime spec docs
# ==============================================================================

# -- Civil: Pole Install Capture Checklist (8 steps, 3 phases) -----------------
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

# -- Splicing: Distribution Dome (8 steps) ------------------------------------
SPLICING_DOME_STEPS = {
    1: "Dome on Pole",
    2: "Dome Label",
    3: "Open Dome",
    4: "Splice Protectors",
    5: "Slack Management",
    6: "Strength Members",
    7: "Seals & Dust Caps",
    8: "Pole ID",
}

SPLICING_DOME_DB_COLS = {
    1: "splicing_step_01_dome_on_pole",
    2: "splicing_step_02_dome_label",
    3: "splicing_step_03_open_dome",
    4: "splicing_step_04_splice_protectors",
    5: "splicing_step_05_slack_management",
    6: "splicing_step_06_strength_members",
    7: "splicing_step_07_seals_dustcaps",
    8: "splicing_step_08_pole_id",
}

# -- Splicing: Main Joint (6 steps, numbered 11-16) ---------------------------
SPLICING_JOINT_STEPS = {
    11: "Cable Entries",
    12: "Strength Members",
    13: "Tube Routing",
    14: "Tray Entries",
    15: "Coiling & Protectors",
    16: "Readable Labels",
}

SPLICING_JOINT_DB_COLS = {
    11: "splicing_step_11_cable_entries",
    12: "splicing_step_12_strength_members",
    13: "splicing_step_13_tube_routing",
    14: "splicing_step_14_tray_entries",
    15: "splicing_step_15_coiling_protectors",
    16: "splicing_step_16_readable_labels",
}

# ==============================================================================
# VLM Prompts — per discipline, with visual descriptions for each step
# ==============================================================================

VLM_PROMPT_CIVIL = """You are a construction QA photo classifier for fiber optic POLE INSTALLATION.

Classify this photo into exactly ONE of these 8 checklist steps from the Pole Install Capture Checklist:

Phase A — Pre-Install Context:
1. Before Photo — Shows the ground BEFORE digging. You should see markings on the ground (circle, square, or X) indicating where the pole hole will be dug. No hole visible yet.
2. During Photo — Shows staff actively digging the hole OR the compaction process in progress. People working, tools visible, hole partially dug.
3. Depth Photo — Shows a measuring tape or ruler placed inside the dug hole to document the depth. The tape measure is the key visual indicator.
4. End Plates — Close-up showing the end plates of the pole clearly visible. Metal plates at the base or top of the pole.
5. Compaction / Backfill — Shows the backfill material around the pole base. Must be a MIXED sand and cement combination (not just a heap of sand or cement separately). Shows the ground being compacted around the installed pole.

Phase B — Installation Execution:
6. Level Check — Shows a spirit level (bubble level tool) held against the pole to verify it is plumb/vertical. The spirit level tool is the key visual indicator.
7. After Photo — Shows the completed pole installation. A wide shot showing the full pole standing upright in the landscape, taken from a distance. May include a close-up of the ground level plus a standing-back full pole view.

Phase C — Assets & IDs:
8. Signature — Shows a contractor signature, sign-off sheet, or completion document. Paper/form with handwritten signature visible.

0. Unrelated — Photo does not clearly show any of the above (e.g. team selfie, vehicle, landscape without pole context, blurry/dark photo, equipment closeup).

Respond with ONLY a JSON object:
{"step": <number 0-8>, "confidence": <0.0-1.0>, "reason": "<brief reason>"}"""


VLM_PROMPT_SPLICING_DOME = """You are a construction QA photo classifier for fiber optic DISTRIBUTION DOME JOINT installation.

Classify this photo into exactly ONE of these 8 checklist steps from the Optical Checklist (Distribution Dome FT Specification):

1. Dome on Pole — Wide shot showing the splice dome enclosure installed on a pole. Shows the full dome mounted in its position.
2. Dome Label — Close-up of the dome label showing the Pole ID and/or Fibre ID text clearly readable.
3. Open Dome — Shows the dome opened with fibre routing and splice tray layout visible inside. Interior of the dome visible.
4. Splice Protectors — Close-up showing splice protectors fitted correctly over the fibre splices inside the dome.
5. Slack Management — Shows slack cable management inside the dome. Neat fibre loops and cable organization within the enclosure.
6. Strength Members — Shows strength members (aramid yarn or steel wire) secured properly inside the dome.
7. Seals & Dust Caps — Shows the dome seals tightened and dust caps in place on unused ports. Weatherproofing visible.
8. Pole ID — Close-up of the Pole ID label/tag attached to the pole near the dome. Number or barcode tag readable.

0. Unrelated — Photo does not clearly show any dome joint related content (e.g. just a pole without dome, cable stringing, team photo, vehicle).

Respond with ONLY a JSON object:
{"step": <number 0-8>, "confidence": <0.0-1.0>, "reason": "<brief reason>"}"""


VLM_PROMPT_SPLICING_JOINT = """You are a construction QA photo classifier for fiber optic MAIN JOINT (inline closure) installation.

Classify this photo into exactly ONE of these 6 checklist steps from the Optical Checklist (Main Joint FT Specification):

11. Cable Entries — Shows labelled cable entries into the main joint closure. Cable markings and entry points visible.
12. Strength Members — Shows strength members (aramid yarn or steel wire) properly secured within the joint closure.
13. Tube Routing — Shows fibre tubes routed neatly within the closure from entry to splice tray area.
14. Tray Entries — Shows fibre entering the splice trays in an organized manner.
15. Coiling & Protectors — Shows fibre coiling loops and visible splice protectors (heat shrinks or mechanical splice holders).
16. Readable Labels — Shows clear, readable labels on cables, tubes, or the closure itself.

0. Unrelated — Photo does not clearly show any main joint related content.

Respond with ONLY a JSON object:
{"step": <number 0 or 11-16>, "confidence": <0.0-1.0>, "reason": "<brief reason>"}"""


VLM_PROMPT_SPLICING_DETECT = """Look at this photo of a fiber optic splice joint/enclosure.

Is this a:
A) Distribution Dome — a smaller dome-shaped enclosure typically mounted on a pole
B) Main Joint — a larger inline closure typically at ground level or on a strand, with multiple cable entries

Respond with ONLY a JSON object:
{"type": "dome" or "main_joint", "confidence": <0.0-1.0>, "reason": "<brief reason>"}"""


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
            f"docker exec {MINIO_CONTAINER} mc cat '{escaped_path}'"
        ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        if result.returncode != 0:
            return None
        data = result.stdout
        if len(data) < 100 or len(data) > 50_000_000:
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


def vlm_call(photo_b64, prompt):
    """Send photo + prompt to VLM. Returns raw text response or error string."""
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
                        {"type": "text", "text": prompt},
                    ],
                }],
                "max_tokens": 256,
                "temperature": 0.1,
            },
            timeout=60,
        )
        resp.raise_for_status()
        return resp.json().get("choices", [{}])[0].get("message", {}).get("content", "")
    except Exception as e:
        return f"ERROR: {e}"


def parse_classification(text, valid_steps):
    """Parse VLM classification response.

    Returns (step, confidence, reason).
    valid_steps is a set of allowed step numbers (e.g. {0,1,2,...,8} for civil).
    """
    try:
        json_match = re.search(r"\{[^}]*\}", text)
        if json_match:
            parsed = json.loads(json_match.group())
            step = int(parsed.get("step", -1))
            confidence = float(parsed.get("confidence", 0))
            reason = parsed.get("reason", "")
            if step in valid_steps and 0 <= confidence <= 1:
                return step, confidence, reason
    except (json.JSONDecodeError, ValueError, TypeError):
        pass

    # Fallback: look for step number in text
    m = re.search(r"step\s*[:#]?\s*(\d+)", text, re.IGNORECASE)
    if m:
        step = int(m.group(1))
        if step in valid_steps:
            return step, 0.5, text[:100]

    return None, None, f"Could not parse: {text[:100]}"


def detect_joint_type(photo_b64):
    """Detect whether a splicing photo shows a dome or main joint.

    Returns 'dome', 'main_joint', or None if detection fails.
    """
    text = vlm_call(photo_b64, VLM_PROMPT_SPLICING_DETECT)
    if text.startswith("ERROR:"):
        return None
    try:
        json_match = re.search(r"\{[^}]*\}", text)
        if json_match:
            parsed = json.loads(json_match.group())
            jtype = parsed.get("type", "").lower().strip()
            if jtype in ("dome", "main_joint"):
                return jtype
    except (json.JSONDecodeError, ValueError):
        pass
    # Fallback: keyword search
    lower = text.lower()
    if "main_joint" in lower or "main joint" in lower or "inline" in lower:
        return "main_joint"
    if "dome" in lower or "distribution" in lower:
        return "dome"
    return None


def get_steps_for_discipline(discipline, sub_type=None):
    """Return (steps_dict, db_cols_dict, prompt, valid_step_set) for a discipline."""
    if discipline == "civil":
        valid = {0} | set(CIVIL_STEPS.keys())
        return CIVIL_STEPS, CIVIL_STEP_DB_COLS, VLM_PROMPT_CIVIL, valid
    elif discipline == "splicing":
        if sub_type == "main_joint":
            valid = {0} | set(SPLICING_JOINT_STEPS.keys())
            return SPLICING_JOINT_STEPS, SPLICING_JOINT_DB_COLS, VLM_PROMPT_SPLICING_JOINT, valid
        else:
            # Default to dome
            valid = {0} | set(SPLICING_DOME_STEPS.keys())
            return SPLICING_DOME_STEPS, SPLICING_DOME_DB_COLS, VLM_PROMPT_SPLICING_DOME, valid
    else:
        # Optical — no spec-aligned prompt yet, use placeholder
        return {}, {}, "", set()


def run_classification(project_name, db_url, limit=100, dry_run=False, discipline="civil",
                       source="all", local_minio=False, reclassify=False):
    """Batch classify unassigned photos via VLM."""
    print(f"\n{'='*70}")
    print(f"  VLM Photo Classification — {discipline.title()}")
    print(f"  Project: {project_name}")
    print(f"  Source: {source}")
    print(f"  Limit: {limit}")
    print(f"  Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"  Reclassify: {'YES (overwriting existing)' if reclassify else 'No (unclassified only)'}")
    print(f"{'='*70}\n")

    if discipline == "optical":
        print("    WARNING: Optical (cable stringing) classification not yet spec-aligned.")
        print("    No client spec provided. Skipping.")
        return

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

    # Classification filter — skip already-classified unless reclassifying
    if reclassify:
        classify_filter = ""  # Process all photos
    else:
        classify_filter = "AND p.checklist_step IS NULL"

    # -- Fetch photos ----------------------------------------------------------
    print("  [2/3] Fetching photos to classify...")
    query = f"""
        SELECT p.id, p.storage_key, p.source, p.filename, p.review_id,
               r.feature_id, r.discipline, r.splicing_sub_type, pr.project_name
        FROM construction_qa_photos p
        JOIN construction_qa_reviews r ON r.id = p.review_id
        JOIN projects pr ON pr.id = p.project_id
        WHERE r.discipline = %s
          {classify_filter}
          {source_filter}
          {project_filter}
        ORDER BY pr.project_name, r.feature_id
        LIMIT %s
    """
    cur.execute(query, [discipline] + params + [limit])
    photos = cur.fetchall()
    print(f"    Found {len(photos)} {discipline} photos to process\n")

    if not photos:
        print("    Nothing to do.")
        cur.close()
        conn.close()
        return

    # -- Classify each photo ---------------------------------------------------
    print("  [3/3] Classifying via VLM...\n")
    stats = {"classified": 0, "unrelated": 0, "failed": 0, "skipped": 0, "dome": 0, "main_joint": 0}
    step_counts = {}
    review_updates = {}  # review_id -> set of (step, db_col) tuples
    review_sub_types = {}  # review_id -> detected sub_type
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

        # Resize
        try:
            b64 = resize_for_vlm(photo_bytes)
        except Exception as e:
            print(f"resize error: {e}")
            stats["failed"] += 1
            continue

        # For splicing: detect dome vs main joint first
        sub_type = None
        if discipline == "splicing":
            sub_type = photo.get("splicing_sub_type")
            if not sub_type:
                sub_type = detect_joint_type(b64)
                if not sub_type:
                    sub_type = "dome"  # Default to dome if detection fails
                    print(f"(defaulting to dome) ", end="", flush=True)
            if sub_type == "dome":
                stats["dome"] += 1
            else:
                stats["main_joint"] += 1

        # Get step definitions for this discipline/sub_type
        steps_dict, db_cols, prompt, valid_steps = get_steps_for_discipline(discipline, sub_type)
        if not prompt:
            stats["skipped"] += 1
            print("no prompt for discipline")
            continue

        # Classify
        text = vlm_call(b64, prompt)
        if text.startswith("ERROR:"):
            print(f"VLM error: {text[:50]}")
            stats["failed"] += 1
            continue

        step, confidence, reason = parse_classification(text, valid_steps)

        if step is None:
            print(f"parse error: {reason[:50]}")
            stats["failed"] += 1
            continue

        if step == 0:
            print(f"-> unrelated ({confidence:.2f}): {reason[:40]}")
            stats["unrelated"] += 1
            if not dry_run:
                cur.execute("""
                    UPDATE construction_qa_photos
                    SET checklist_step = 0, step_label = 'Unrelated',
                        vlm_confidence = %s, vlm_feedback = %s, vlm_processed_at = NOW(), updated_at = NOW()
                    WHERE id = %s::uuid
                """, (confidence, reason[:500], photo_id))
            continue

        step_label = steps_dict.get(step, f"Step {step}")
        print(f"-> Step {step}: {step_label} ({confidence:.2f})")

        step_counts[step] = step_counts.get(step, 0) + 1
        stats["classified"] += 1

        # Track which reviews need step boolean updates
        review_id = str(photo["review_id"])
        db_col = db_cols.get(step)
        if db_col:
            review_updates.setdefault(review_id, set()).add((step, db_col))

        # Track sub_type for splicing reviews
        if discipline == "splicing" and sub_type:
            review_sub_types[review_id] = sub_type

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
        for review_id, step_cols in review_updates.items():
            set_clauses = []
            for _step, col in step_cols:
                set_clauses.append(f"{col} = TRUE")
            # Also set splicing_sub_type if detected
            if discipline == "splicing" and review_id in review_sub_types:
                set_clauses.append(f"splicing_sub_type = '{review_sub_types[review_id]}'")
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
    if discipline == "splicing":
        print(f"  Dome joints:       {stats['dome']}")
        print(f"  Main joints:       {stats['main_joint']}")
    print(f"  Time:              {elapsed:.0f}s ({len(photos)/elapsed:.1f} photos/s)" if elapsed > 0 else "")
    print(f"  Reviews updated:   {len(review_updates)}")

    # Step distribution
    print(f"\n  Step distribution:")
    if discipline == "civil":
        for s in range(1, 9):
            label = CIVIL_STEPS.get(s, f"Step {s}")
            count = step_counts.get(s, 0)
            bar = "#" * min(count, 50)
            print(f"    {s}. {label:30s} {count:4d} {bar}")
    elif discipline == "splicing":
        print(f"    --- Distribution Dome ---")
        for s in range(1, 9):
            label = SPLICING_DOME_STEPS.get(s, f"Step {s}")
            count = step_counts.get(s, 0)
            bar = "#" * min(count, 50)
            print(f"    {s:2d}. {label:30s} {count:4d} {bar}")
        print(f"    --- Main Joint ---")
        for s in range(11, 17):
            label = SPLICING_JOINT_STEPS.get(s, f"Step {s}")
            count = step_counts.get(s, 0)
            bar = "#" * min(count, 50)
            print(f"    {s:2d}. {label:30s} {count:4d} {bar}")

    print(f"    {'':2s}  {'Unrelated':30s} {stats['unrelated']:4d}")
    print(f"{'='*70}")

    cur.close()
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Batch VLM classification of unassigned QA photos")
    parser.add_argument("--project", required=True, help="Project name or 'all'")
    parser.add_argument("--limit", type=int, default=100, help="Max photos to process (default 100)")
    parser.add_argument("--dry-run", action="store_true", help="Classify but don't update DB")
    parser.add_argument("--discipline", default="civil", choices=["civil", "splicing", "optical"],
                        help="Discipline to classify (default: civil)")
    parser.add_argument("--source", default="all", choices=["sharepoint", "qfield", "all"],
                        help="Photo source to classify (default: all)")
    parser.add_argument("--local-minio", action="store_true",
                        help="Use local docker exec for MinIO (when running on Velocity)")
    parser.add_argument("--db-url", help="Database URL (defaults to DATABASE_URL env var)")
    parser.add_argument("--reclassify", action="store_true",
                        help="Re-classify all photos including already classified ones")
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
                       local_minio=args.local_minio, reclassify=args.reclassify)
