#!/usr/bin/env python3
"""
Optical step classification for pole audit photos.

Many pole reviews are classified as 'civil' but actually contain optical
dome/closure photos. This script:
1. Finds civil pole reviews with 0 civil steps and unclassified photos
2. Classifies photos against optical dome steps (1-8) via VLM
3. Updates checklist_step on matched photos
4. Optionally reclassifies review discipline to 'optical'

Usage:
  python3 scripts/reclassify-optical.py --dry-run
  python3 scripts/reclassify-optical.py --limit 500
  python3 scripts/reclassify-optical.py --limit 1000 --min-photos 3
"""

import argparse
import base64
import io
import os
import subprocess

import psycopg2
import psycopg2.extras
import requests
from PIL import Image

DB_URL = os.environ.get("DATABASE_URL", "")
VLM_URL = "http://100.96.203.105:8100"
VLM_MODEL = "Qwen/Qwen3-VL-8B-Instruct"
BASE = "/home/velo/storage/qa-photos"
MAX_IMAGE_DIM = 512
CONFIDENCE_THRESHOLD = 0.70

# Optical dome steps (1-8)
OPTICAL_STEPS = {
    1: {"name": "Dome on Pole", "col": "optical_step_01_dome_on_pole",
        "desc": "a fiber optic dome/closure/enclosure mounted on or attached to a pole"},
    2: {"name": "Dome Label", "col": "optical_step_02_dome_label",
        "desc": "a label, sticker, or ID tag on a fiber optic dome/closure showing identification"},
    3: {"name": "Open Dome", "col": "optical_step_03_open_dome",
        "desc": "an opened fiber optic dome/closure showing internal trays, splices, or fiber routing"},
    4: {"name": "Splice Protectors", "col": "optical_step_04_splice_protectors",
        "desc": "splice protectors, heat shrink sleeves, or fusion splice protection on fiber strands"},
    5: {"name": "Slack Management", "col": "optical_step_05_slack_management",
        "desc": "fiber cable slack coiled, stored, or managed on a pole or in a closure — excess cable loops"},
    6: {"name": "Strength Members", "col": "optical_step_06_strength_members",
        "desc": "strength members (steel wire or aramid yarn) secured, clamped, or grounded at a closure entry"},
    7: {"name": "Seals & Dustcaps", "col": "optical_step_07_seals_dustcaps",
        "desc": "seals, gaskets, or dustcaps on closure ports — properly sealed dome entries"},
    8: {"name": "Pole ID", "col": "optical_step_08_pole_id",
        "desc": "a pole number plate, ID tag, or identification marking on a utility pole"},
}

# Categories that are NOT optical steps but useful for filtering
NON_STEP_CATEGORIES = {
    9: "Full pole view (general)",
    10: "Cables on pole (no specific step)",
    11: "Ground/environment shot",
    12: "Other/unrelated",
}


def get_db():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    return conn


def load_b64(storage_key, max_dim=MAX_IMAGE_DIM):
    """Load photo from disk or MinIO, resize, return base64 JPEG."""
    raw_bytes = None
    for path in [f"{BASE}/{storage_key}", f"/home/velo/storage/{storage_key}"]:
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    raw_bytes = f.read()
                break
            except Exception:
                pass

    if raw_bytes is None and storage_key.startswith("projects/"):
        try:
            escaped = storage_key.replace("'", "'\\''")
            result = subprocess.run(
                ["docker", "exec", "qfieldcloud-minio-1", "mc", "cat",
                 f"local/qfieldcloud-prod/{escaped}"],
                capture_output=True, timeout=15,
            )
            if result.returncode == 0 and len(result.stdout) > 2000:
                raw_bytes = result.stdout
        except Exception:
            pass

    if raw_bytes is None or len(raw_bytes) < 2000:
        return None

    try:
        img = Image.open(io.BytesIO(raw_bytes))
        if max(img.size) > max_dim:
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=75)
        data = buf.getvalue()
        if len(data) < 2000:
            return None
        return base64.b64encode(data).decode()
    except Exception:
        return None


def classify_optical(b64):
    """Classify a photo against optical dome steps. Returns (step_number, confidence)."""
    step_list = "\n".join(
        f"{s}={info['name']}: {info['desc']}"
        for s, info in OPTICAL_STEPS.items()
    )

    resp = requests.post(f"{VLM_URL}/v1/chat/completions", json={
        "model": VLM_MODEL,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": f"""Classify this fiber/telecom pole infrastructure photo.

Which category BEST matches? Choose exactly one:
{step_list}
0=None of the above (general pole view, ground shot, unrelated, or unclear)

Reply in this exact format:
STEP: <number>
CONFIDENCE: <0.0-1.0>

Be strict — only assign a step if the photo clearly shows that specific feature."""}
        ]}],
        "max_tokens": 50,
        "temperature": 0.1,
    }, timeout=30)

    text = resp.json()["choices"][0]["message"]["content"].strip()
    step = 0
    conf = 0.0
    for line in text.split("\n"):
        line = line.strip().upper()
        if line.startswith("STEP:"):
            try:
                step = int(line.split(":")[1].strip())
            except (ValueError, IndexError):
                pass
        elif line.startswith("CONFIDENCE:"):
            try:
                conf = float(line.split(":")[1].strip())
            except (ValueError, IndexError):
                pass
    return step, conf


def main():
    parser = argparse.ArgumentParser(description="Optical step classification for pole photos")
    parser.add_argument("--limit", type=int, default=500, help="Max VLM calls")
    parser.add_argument("--min-photos", type=int, default=3, help="Min photos per review to process")
    parser.add_argument("--max-per-review", type=int, default=12, help="Max photos to classify per review")
    parser.add_argument("--max-civil-steps", type=int, default=1, help="Max civil steps to consider for reclassification")
    parser.add_argument("--reclassify-discipline", action="store_true", help="Also change review discipline to optical")
    parser.add_argument("--dry-run", action="store_true", help="Don't write changes")
    args = parser.parse_args()

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # Find civil pole reviews with few civil steps and unclassified photos
    cur.execute("""
        SELECT r.id, r.feature_id, r.project_id, r.photo_count,
          (COALESCE(r.civil_step_01_before_photo,false)::int + COALESCE(r.civil_step_02_during_photo,false)::int +
           COALESCE(r.civil_step_03_depth_photo,false)::int + COALESCE(r.civil_step_04_end_plates,false)::int +
           COALESCE(r.civil_step_05_compaction,false)::int + COALESCE(r.civil_step_06_level_check,false)::int +
           COALESCE(r.civil_step_07_after_photo,false)::int) AS civil_steps
        FROM construction_qa_reviews r
        WHERE r.discipline = 'civil' AND r.feature_type = 'pole'
          AND r.workflow_status <> 'approved'
          AND (COALESCE(r.civil_step_01_before_photo,false)::int + COALESCE(r.civil_step_02_during_photo,false)::int +
               COALESCE(r.civil_step_03_depth_photo,false)::int + COALESCE(r.civil_step_04_end_plates,false)::int +
               COALESCE(r.civil_step_05_compaction,false)::int + COALESCE(r.civil_step_06_level_check,false)::int +
               COALESCE(r.civil_step_07_after_photo,false)::int) <= %s
          AND r.photo_count >= %s
        ORDER BY r.photo_count DESC
    """, (args.max_civil_steps, args.min_photos))
    reviews = cur.fetchall()
    print(f"Found {len(reviews)} civil pole reviews with <={args.max_civil_steps} civil steps and >={args.min_photos} photos")

    vlm_calls = 0
    photos_classified = 0
    reviews_with_optical = 0
    reviews_reclassified = 0
    step_counts = {s: 0 for s in OPTICAL_STEPS}
    load_fails = 0

    for rev in reviews:
        if vlm_calls >= args.limit:
            print(f"\n  Hit VLM limit ({args.limit})")
            break

        rid = rev["id"]
        fid = rev["feature_id"]

        # Get unclassified photos
        cur.execute("""
            SELECT id, source, storage_key
            FROM construction_qa_photos
            WHERE review_id = %s AND COALESCE(checklist_step, 0) = 0
            ORDER BY created_at
        """, (rid,))
        photos = cur.fetchall()
        if not photos:
            continue

        found_steps = {}  # step -> [(photo_id, conf)]
        review_calls = 0

        for photo in photos:
            if vlm_calls >= args.limit:
                break
            if review_calls >= args.max_per_review:
                break

            b64 = load_b64(photo["storage_key"])
            if not b64:
                load_fails += 1
                continue

            vlm_calls += 1
            review_calls += 1
            step, conf = classify_optical(b64)

            if step in OPTICAL_STEPS and conf >= CONFIDENCE_THRESHOLD:
                step_name = OPTICAL_STEPS[step]["name"]
                if step not in found_steps:
                    found_steps[step] = []
                found_steps[step].append((photo["id"], conf))
                photos_classified += 1
                step_counts[step] += 1

                if not args.dry_run:
                    cur.execute("""
                        UPDATE construction_qa_photos
                        SET checklist_step = %s, step_label = %s, updated_at = NOW()
                        WHERE id = %s
                    """, (step, step_name, photo["id"]))
                    conn.commit()

        if found_steps:
            reviews_with_optical += 1
            steps_str = ", ".join(f"S{s}({len(v)})" for s, v in sorted(found_steps.items()))
            print(f"  {fid}: {steps_str}")

            # Reclassify review discipline if requested and enough optical steps found
            if args.reclassify_discipline and len(found_steps) >= 2 and not args.dry_run:
                cur.execute("""
                    UPDATE construction_qa_reviews
                    SET discipline = 'optical', optical_sub_type = 'dome', updated_at = NOW()
                    WHERE id = %s
                """, (rid,))
                conn.commit()
                reviews_reclassified += 1

    # Phase 2: Recompute optical step booleans
    print(f"\nPhase 2: Recomputing optical step booleans...")
    cur.execute("""
        WITH photo_steps AS (
            SELECT p.review_id,
                bool_or(p.checklist_step = 1) AS s1, bool_or(p.checklist_step = 2) AS s2,
                bool_or(p.checklist_step = 3) AS s3, bool_or(p.checklist_step = 4) AS s4,
                bool_or(p.checklist_step = 5) AS s5, bool_or(p.checklist_step = 6) AS s6,
                bool_or(p.checklist_step = 7) AS s7, bool_or(p.checklist_step = 8) AS s8,
                COUNT(*) AS cnt
            FROM construction_qa_photos p
            JOIN construction_qa_reviews r ON r.id = p.review_id
            WHERE r.feature_type = 'pole'
            GROUP BY p.review_id
        )
        UPDATE construction_qa_reviews r SET
            optical_step_01_dome_on_pole = COALESCE(ps.s1, false),
            optical_step_02_dome_label = COALESCE(ps.s2, false),
            optical_step_03_open_dome = COALESCE(ps.s3, false),
            optical_step_04_splice_protectors = COALESCE(ps.s4, false),
            optical_step_05_slack_management = COALESCE(ps.s5, false),
            optical_step_06_strength_members = COALESCE(ps.s6, false),
            optical_step_07_seals_dustcaps = COALESCE(ps.s7, false),
            optical_step_08_pole_id = COALESCE(ps.s8, false),
            photo_count = COALESCE(ps.cnt, 0),
            updated_at = NOW()
        FROM photo_steps ps
        WHERE r.id = ps.review_id
          AND (r.optical_step_01_dome_on_pole IS DISTINCT FROM COALESCE(ps.s1, false)
            OR r.optical_step_02_dome_label IS DISTINCT FROM COALESCE(ps.s2, false)
            OR r.optical_step_03_open_dome IS DISTINCT FROM COALESCE(ps.s3, false)
            OR r.optical_step_04_splice_protectors IS DISTINCT FROM COALESCE(ps.s4, false)
            OR r.optical_step_05_slack_management IS DISTINCT FROM COALESCE(ps.s5, false)
            OR r.optical_step_06_strength_members IS DISTINCT FROM COALESCE(ps.s6, false)
            OR r.optical_step_07_seals_dustcaps IS DISTINCT FROM COALESCE(ps.s7, false)
            OR r.optical_step_08_pole_id IS DISTINCT FROM COALESCE(ps.s8, false)
            OR r.photo_count IS DISTINCT FROM COALESCE(ps.cnt, 0))
    """)
    bool_fixed = cur.rowcount
    conn.commit()
    print(f"  Fixed {bool_fixed} optical step booleans")

    print(f"""
============================================================
SUMMARY
============================================================
  VLM calls:              {vlm_calls}
  Photos classified:      {photos_classified}
  Reviews with optical:   {reviews_with_optical}
  Reviews reclassified:   {reviews_reclassified}
  Load failures:          {load_fails}
  Booleans recomputed:    {bool_fixed}
  {"MODE: DRY RUN (no changes written)" if args.dry_run else ""}
============================================================

Step breakdown:""")
    for s, info in OPTICAL_STEPS.items():
        print(f"  Step {s} ({info['name']}): {step_counts[s]}")

    conn.close()


if __name__ == "__main__":
    main()
