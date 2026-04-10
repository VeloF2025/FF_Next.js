#!/usr/bin/env python3
"""
Few-shot VLM reclassification for construction QA photos.

Uses binary few-shot prompting (2 positive + 2 negative examples per step)
to classify unclassified photos. Focuses on reviews missing 1-3 steps
with available unclassified photos.

Phase 1: Binary few-shot classification per missing step
Phase 2: Recompute step booleans
Phase 3: Auto-approve eligible reviews

Usage:
  python3 scripts/reclassify-fewshot.py --dry-run
  python3 scripts/reclassify-fewshot.py --limit 500
  python3 scripts/reclassify-fewshot.py --steps 6        # Only Level Check
  python3 scripts/reclassify-fewshot.py --steps 1,4,5,6  # Multiple steps
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
VLM_MODEL = "QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ"
BASE = "/home/velo/storage/qa-photos"
CONFIDENCE_THRESHOLD = 0.70

STEP_NAMES = {
    1: "Before Photo", 2: "During Photo", 3: "Depth Photo",
    4: "End Plates", 5: "Compaction/Backfill", 6: "Level Check",
    7: "After Photo", 8: "Signature",
}

STEP_DESCRIPTIONS = {
    1: "site before construction work begins — empty field, unmarked ground, or pre-work view of the area",
    2: "active excavation or trenching in progress — open trench, workers digging, machinery operating",
    3: "a measuring tape or ruler placed in the trench to show depth measurement",
    4: "end plates or end caps fitted on conduit pipes — close-up of pipe ends with protective caps",
    5: "backfilling or compacting the trench — soil being pushed back in, compaction equipment, or filled trench",
    6: "a spirit level or laser level being used to verify that a pole, conduit, or structure is properly level/plumb",
    7: "the completed and restored site after construction — ground leveled, area cleaned up, finished work",
}

# Step-specific negative examples (use photos from other steps)
STEP_COLUMN_MAP = {
    1: "civil_step_01_before_photo",
    2: "civil_step_02_during_photo",
    3: "civil_step_03_depth_photo",
    4: "civil_step_04_end_plates",
    5: "civil_step_05_compaction",
    6: "civil_step_06_level_check",
    7: "civil_step_07_after_photo",
}


def get_db():
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    return conn


MAX_IMAGE_DIM = 512  # Resize to fit VLM context with multiple images

def load_b64(storage_key, source=None, max_dim=MAX_IMAGE_DIM):
    """Load photo from disk or MinIO, resize if needed, return base64 JPEG."""
    # Try local filesystem first
    candidates = [
        f"{BASE}/{storage_key}",
        f"/home/velo/storage/{storage_key}",
    ]
    raw_bytes = None
    for path in candidates:
        if os.path.exists(path):
            try:
                with open(path, "rb") as f:
                    raw_bytes = f.read()
                break
            except Exception:
                pass

    # Fallback: fetch from MinIO if source is 'qfield' and key looks like a MinIO path
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


def get_exemplars(cur, step, count=2):
    """Get exemplar photos for a specific step from approved reviews."""
    cur.execute("""
        SELECT p.storage_key
        FROM construction_qa_photos p
        JOIN construction_qa_reviews r ON r.id = p.review_id
        WHERE r.workflow_status = 'approved' AND r.discipline = 'civil'
          AND p.checklist_step = %s AND p.source = 'local'
        ORDER BY RANDOM()
        LIMIT %s
    """, (step, count * 5))  # Fetch extras in case some files don't exist

    results = []
    for row in cur.fetchall():
        b64 = load_b64(row["storage_key"])
        if b64:
            results.append((row["storage_key"], b64))
        if len(results) >= count:
            break
    return results


def get_negative_exemplars(cur, step, count=2):
    """Get negative exemplar photos (from OTHER steps) for contrast."""
    other_steps = [s for s in range(1, 8) if s != step]
    cur.execute("""
        SELECT p.checklist_step, p.storage_key
        FROM construction_qa_photos p
        JOIN construction_qa_reviews r ON r.id = p.review_id
        WHERE r.workflow_status = 'approved' AND r.discipline = 'civil'
          AND p.checklist_step = ANY(%s) AND p.source = 'local'
        ORDER BY RANDOM()
        LIMIT %s
    """, (other_steps, count * 5))

    results = []
    for row in cur.fetchall():
        b64 = load_b64(row["storage_key"])
        if b64:
            results.append((row["storage_key"], b64, row["checklist_step"]))
        if len(results) >= count:
            break
    return results


def build_binary_prompt(cur, step):
    """Build few-shot binary classification prompt for a specific step."""
    name = STEP_NAMES[step]
    desc = STEP_DESCRIPTIONS[step]

    positives = get_exemplars(cur, step, 2)
    negatives = get_negative_exemplars(cur, step, 2)

    if len(positives) < 2 or len(negatives) < 2:
        print(f"  WARNING: Not enough exemplars for step {step} ({len(positives)} pos, {len(negatives)} neg)")
        return None

    messages = []
    messages.append({"role": "user", "content": [{"type": "text", "text":
        f"I'll show you examples of '{name}' photos from fiber optic construction, "
        f"and examples that are NOT '{name}'. Then I'll ask you to classify new photos.\n\n"
        f"A '{name}' photo shows: {desc}"}]})
    messages.append({"role": "assistant", "content": "Ready. Show me the examples."})

    for key, b64 in positives:
        messages.append({"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": f"This IS a {name} photo."},
        ]})
        messages.append({"role": "assistant", "content": f"YES - this is a {name}."})

    for key, b64, other_step in negatives:
        other_name = STEP_NAMES[other_step]
        messages.append({"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": f"This is NOT a {name} photo."},
        ]})
        messages.append({"role": "assistant", "content": f"NO - this is not a {name}, it looks like a {other_name}."})

    return messages


def ask_binary(messages, photo_b64, step_name):
    """Ask VLM binary YES/NO with few-shot context."""
    test_msgs = messages + [{"role": "user", "content": [
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{photo_b64}"}},
        {"type": "text", "text": f"Is this a {step_name} photo? Reply YES or NO with confidence (0.0-1.0)."},
    ]}]

    try:
        resp = requests.post(
            f"{VLM_URL}/v1/chat/completions",
            json={"model": VLM_MODEL, "messages": test_msgs, "max_tokens": 20, "temperature": 0.1},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()
        if "choices" not in data:
            return False, 0.0
        text = data["choices"][0]["message"]["content"].strip()

        is_yes = text.upper().startswith("YES")
        conf = 0.0
        for part in text.split():
            try:
                val = float(part)
                if 0.0 <= val <= 1.0:
                    conf = val
                    break
            except ValueError:
                continue

        return is_yes, conf
    except Exception as e:
        print(f"    VLM error: {e}")
        return False, 0.0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=1000, help="Max VLM calls total")
    parser.add_argument("--steps", default="1,2,3,4,5,6,7", help="Steps to classify (comma-separated)")
    parser.add_argument("--max-missing", type=int, default=3, help="Max missing steps per review to process")
    args = parser.parse_args()

    target_steps = set(int(s) for s in args.steps.split(","))
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    print(f"Building few-shot prompts for steps: {sorted(target_steps)}")
    prompts = {}
    for step in target_steps:
        prompts[step] = build_binary_prompt(cur, step)
        if prompts[step]:
            print(f"  Step {step} ({STEP_NAMES[step]}): ready")

    # ── Phase 1: Binary few-shot classification ──────────────────────────────
    print(f"\nPhase 1: Binary few-shot classification (limit={args.limit})")

    # Find reviews with unclassified photos, missing 1-N steps, ordered by coverage
    step_cols = " + ".join(f"COALESCE(r.{STEP_COLUMN_MAP[s]}, false)::int" for s in range(1, 8))
    cur.execute(f"""
        SELECT r.id, r.feature_id,
          ({step_cols}) AS step_count,
          {', '.join(f'COALESCE(r.{STEP_COLUMN_MAP[s]}, false) AS has_step_{s}' for s in range(1, 8))}
        FROM construction_qa_reviews r
        WHERE r.discipline = 'civil'
          AND r.workflow_status NOT IN ('approved')
          AND ({step_cols}) >= %s
        ORDER BY ({step_cols}) DESC, r.photo_count DESC
    """, (7 - args.max_missing,))
    reviews = cur.fetchall()
    print(f"  Found {len(reviews)} reviews with {7 - args.max_missing}+ steps")

    vlm_calls = 0
    reclassified = 0
    reviews_helped = 0

    for rev in reviews:
        if vlm_calls >= args.limit:
            print(f"  Hit VLM limit ({args.limit})")
            break

        rid = rev["id"]
        fid = rev["feature_id"]

        # Determine which steps are missing
        missing_steps = []
        for s in range(1, 8):
            if not rev[f"has_step_{s}"] and s in target_steps and prompts.get(s):
                missing_steps.append(s)

        if not missing_steps:
            continue

        # Get unclassified photos for this review
        cur.execute("""
            SELECT id, source, storage_key
            FROM construction_qa_photos
            WHERE review_id = %s AND COALESCE(checklist_step, 0) = 0
            ORDER BY created_at
        """, (rid,))
        photos = cur.fetchall()
        if not photos:
            continue

        found_any = False
        for missing_step in missing_steps:
            if vlm_calls >= args.limit:
                break

            step_name = STEP_NAMES[missing_step]
            prompt = prompts[missing_step]

            for photo in photos:
                if vlm_calls >= args.limit:
                    break

                b64 = load_b64(photo["storage_key"])
                if not b64:
                    continue

                vlm_calls += 1
                is_match, conf = ask_binary(prompt, b64, step_name)

                if is_match and conf >= CONFIDENCE_THRESHOLD:
                    print(f"  {fid}: photo {photo['id'][:8]}... → Step {missing_step} ({step_name}) conf={conf:.2f}")
                    reclassified += 1
                    found_any = True

                    if not args.dry_run:
                        cur.execute("""
                            UPDATE construction_qa_photos
                            SET checklist_step = %s, step_label = %s, updated_at = NOW()
                            WHERE id = %s
                        """, (missing_step, step_name, photo["id"]))
                        conn.commit()

                    # Remove from candidates for other steps
                    photos = [p for p in photos if p["id"] != photo["id"]]
                    break  # One photo per missing step is enough

        if found_any:
            reviews_helped += 1

    print(f"\n  VLM calls: {vlm_calls}")
    print(f"  Photos reclassified: {reclassified}")
    print(f"  Reviews helped: {reviews_helped}")

    # ── Phase 2: Recompute step booleans ─────────────────────────────────────
    print("\nPhase 2: Recomputing step booleans...")
    cur.execute("""
        WITH photo_steps AS (
            SELECT
                p.review_id,
                bool_or(p.checklist_step = 1 AND COALESCE(p.vlm_valid, false) = true) AS has_step1,
                bool_or(p.checklist_step = 2 AND COALESCE(p.vlm_valid, false) = true) AS has_step2,
                bool_or(p.checklist_step = 3 AND COALESCE(p.vlm_valid, false) = true) AS has_step3,
                bool_or(p.checklist_step = 4 AND COALESCE(p.vlm_valid, false) = true) AS has_step4,
                bool_or(p.checklist_step = 5 AND COALESCE(p.vlm_valid, false) = true) AS has_step5,
                bool_or(p.checklist_step = 6 AND COALESCE(p.vlm_valid, false) = true) AS has_step6,
                bool_or(p.checklist_step = 7 AND COALESCE(p.vlm_valid, false) = true) AS has_step7,
                bool_or(p.checklist_step = 8 AND COALESCE(p.vlm_valid, false) = true) AS has_step8,
                COUNT(*) AS photo_cnt
            FROM construction_qa_photos p
            GROUP BY p.review_id
        )
        UPDATE construction_qa_reviews r
        SET
            civil_step_01_before_photo = COALESCE(ps.has_step1, false),
            civil_step_02_during_photo = COALESCE(ps.has_step2, false),
            civil_step_03_depth_photo = COALESCE(ps.has_step3, false),
            civil_step_04_end_plates = COALESCE(ps.has_step4, false),
            civil_step_05_compaction = COALESCE(ps.has_step5, false),
            civil_step_06_level_check = COALESCE(ps.has_step6, false),
            civil_step_07_after_photo = COALESCE(ps.has_step7, false),
            civil_step_08_signature = COALESCE(ps.has_step8, false),
            photo_count = COALESCE(ps.photo_cnt, 0),
            updated_at = NOW()
        FROM photo_steps ps
        WHERE r.id = ps.review_id
          AND r.discipline = 'civil'
          AND (
            r.civil_step_01_before_photo IS DISTINCT FROM COALESCE(ps.has_step1, false)
            OR r.civil_step_02_during_photo IS DISTINCT FROM COALESCE(ps.has_step2, false)
            OR r.civil_step_03_depth_photo IS DISTINCT FROM COALESCE(ps.has_step3, false)
            OR r.civil_step_04_end_plates IS DISTINCT FROM COALESCE(ps.has_step4, false)
            OR r.civil_step_05_compaction IS DISTINCT FROM COALESCE(ps.has_step5, false)
            OR r.civil_step_06_level_check IS DISTINCT FROM COALESCE(ps.has_step6, false)
            OR r.civil_step_07_after_photo IS DISTINCT FROM COALESCE(ps.has_step7, false)
            OR r.civil_step_08_signature IS DISTINCT FROM COALESCE(ps.has_step8, false)
            OR r.photo_count IS DISTINCT FROM COALESCE(ps.photo_cnt, 0)
          )
        RETURNING r.id
    """)
    booleans_fixed = cur.rowcount
    if not args.dry_run:
        conn.commit()
    else:
        conn.rollback()
    print(f"  Fixed {booleans_fixed} review booleans")

    # ── Phase 3: Auto-approve ────────────────────────────────────────────────
    print("\nPhase 3: Auto-approving eligible reviews...")
    cur.execute("""
        UPDATE construction_qa_reviews
        SET workflow_status = 'approved', qa_decision = 'PASS',
            qa_decision_by = 'VLM Auto-Approve', updated_at = NOW()
        WHERE discipline = 'civil'
          AND workflow_status IN ('pending', 'retake_required', 'unidentified')
          AND photo_count >= 7
          AND COALESCE(civil_step_03_depth_photo, false) = true
          AND COALESCE(civil_step_04_end_plates, false) = true
          AND COALESCE(civil_step_05_compaction, false) = true
          AND COALESCE(civil_step_06_level_check, false) = true
          AND COALESCE(civil_step_07_after_photo, false) = true
          AND (COALESCE(civil_step_01_before_photo, false) = true
               OR COALESCE(civil_step_02_during_photo, false) = true)
        RETURNING id, feature_id
    """)
    approved = cur.fetchall()
    if not args.dry_run:
        conn.commit()
    else:
        conn.rollback()
    print(f"  Auto-approved {len(approved)} reviews")
    for a in approved[:15]:
        print(f"    {a['feature_id']}")
    if len(approved) > 15:
        print(f"    ... and {len(approved) - 15} more")

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  VLM calls:              {vlm_calls}")
    print(f"  Photos reclassified:    {reclassified}")
    print(f"  Reviews helped:         {reviews_helped}")
    print(f"  Booleans recomputed:    {booleans_fixed}")
    print(f"  Auto-approved:          {len(approved)}")
    if args.dry_run:
        print("  MODE: DRY RUN (no changes written)")
    print("=" * 60)

    cur.execute("""
        SELECT workflow_status, COUNT(*) AS cnt
        FROM construction_qa_reviews WHERE discipline = 'civil'
        GROUP BY 1 ORDER BY cnt DESC
    """)
    print("\nFinal status distribution:")
    for row in cur.fetchall():
        print(f"  {row['workflow_status']:20s} {row['cnt']}")

    cur.execute("""
        SELECT
          (COALESCE(civil_step_01_before_photo,false)::int + COALESCE(civil_step_02_during_photo,false)::int +
           COALESCE(civil_step_03_depth_photo,false)::int + COALESCE(civil_step_04_end_plates,false)::int +
           COALESCE(civil_step_05_compaction,false)::int + COALESCE(civil_step_06_level_check,false)::int +
           COALESCE(civil_step_07_after_photo,false)::int) AS steps, COUNT(*) AS cnt
        FROM construction_qa_reviews WHERE discipline = 'civil' AND workflow_status NOT IN ('approved')
        GROUP BY 1 ORDER BY 1 DESC
    """)
    print("\nNon-approved step coverage:")
    for row in cur.fetchall():
        print(f"  {row['steps']}/7: {row['cnt']} reviews")

    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
