#!/usr/bin/env python3
"""
Backfill unlabeled Mamelodi pole-audit photos in qfield_photo_validations.

Root cause: original Jan-2026 pole-audit photos (`mam-poles_*`) were bulk
ingested with feature_id = filename, feature_type = NULL, checklist_step = NULL.
The works-qa sync only pulls rows with feature_type='pole' + a resolvable
checklist_step, so these are invisible. This script reverse-looks-up each
unlabeled row's photo filename in MAMPoles.gpkg step columns and re-keys it.

Dry-run by default. Pass --commit to apply inside a transaction.
"""

import argparse
import os
import re
import sqlite3
import sys

import psycopg2
import psycopg2.extras

# Default targets the Mamelodi audit project; override via env for other projects.
QF_PROJECT_ID = os.environ.get("QF_PROJECT_ID", "2ce80264-170c-4f05-ada1-68220d7e5885")  # FT_Mamelodi_POP1
GPKG_PATH = os.environ.get("MAM_GPKG", "/tmp/mam_backfill.gpkg")
# Connection string comes from the environment only — never hardcode credentials.
# See .claude/credentials.local.md for the dev/prod DATABASE_URL values.
DB_URL = os.environ.get("DATABASE_URL")

STEP_COL_RE = re.compile(r"^([1-8])[\.\s]")
STEM_RE = re.compile(r"([A-Za-z0-9_\-]+)\.(?:jpg|jpeg|png|heic)", re.IGNORECASE)


def stem_of(value):
    if not value:
        return None
    m = STEM_RE.search(value)
    return m.group(1) if m else None


def build_gpkg_map(path):
    con = sqlite3.connect(path)
    cols = [r[1] for r in con.execute("PRAGMA table_info(MAMPoles)")]
    label_col = "label" if "label" in cols else cols[2]
    step_cols = {c: int(STEP_COL_RE.match(c).group(1)) for c in cols if STEP_COL_RE.match(c)}
    mapping = {}
    for row in con.execute('SELECT * FROM "MAMPoles"'):
        d = dict(zip(cols, row))
        label = d.get(label_col)
        if not label:
            continue
        for col, step in step_cols.items():
            val = d.get(col)
            if val and str(val) != "None":
                stem = stem_of(str(val))
                if stem:
                    mapping.setdefault(stem, set()).add((label, step))
    con.close()
    return mapping, sorted(set(step_cols.values()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true")
    args = ap.parse_args()

    if not DB_URL:
        sys.exit("DATABASE_URL not set (see .claude/credentials.local.md)")
    if not os.path.exists(GPKG_PATH):
        sys.exit(f"GPKG not found: {GPKG_PATH}")

    gpkg_map, steps = build_gpkg_map(GPKG_PATH)
    print(f"GPKG step columns: {steps}")
    print(f"GPKG photo filename stems indexed: {len(gpkg_map)}")

    con = psycopg2.connect(DB_URL)
    cur = con.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """
        SELECT id, feature_id, feature_type, checklist_step, work_type, photo_key
        FROM qfield_photo_validations
        WHERE project_id = %s
          AND (feature_type IS NULL OR checklist_step IS NULL)
        """,
        (QF_PROJECT_ID,),
    )
    rows = cur.fetchall()
    print(f"Unlabeled validation rows in project: {len(rows)}")

    updates, conflicts, no_match, step8 = [], [], [], 0
    for r in rows:
        stem = stem_of(r["feature_id"] or "") or stem_of(r["photo_key"] or "")
        targets = gpkg_map.get(stem) if stem else None
        if not targets:
            no_match.append(r)
            continue
        if len(targets) > 1:
            conflicts.append((r, targets))
            continue
        label, step = next(iter(targets))
        if step == 8:
            step8 += 1
        updates.append((r["id"], label, step, r["feature_id"]))

    print("\n================ DRY-RUN SUMMARY ================")
    print(f"  Will relabel : {len(updates)}")
    print(f"    of which step 8 (no civil slot, won't surface): {step8}")
    print(f"  Conflicts    : {len(conflicts)}  (SKIPPED)")
    print(f"  No GPKG match: {len(no_match)}  (left untouched)")

    print("\n--- A353 check ---")
    a353 = [u for u in updates if "A353" in u[1]]
    for u in a353:
        print(f"  id={u[0]}  {u[3]!r}  ->  feature_id={u[1]!r} step={u[2]}")
    if not a353:
        print("  (no A353 in relabel set)")

    print("\n--- sample of 8 relabels ---")
    for u in updates[:8]:
        print(f"  {u[3]!r:45s} -> {u[1]!r:14s} step={u[2]}")

    if conflicts:
        print("\n--- sample conflicts (skipped) ---")
        for r, t in conflicts[:5]:
            print(f"  {r['feature_id']!r} -> {sorted(t)}")

    # distinct poles that will newly appear / gain photos
    print(f"\n  distinct poles touched: {len(set(u[1] for u in updates))}")

    if not args.commit:
        print("\nDRY-RUN ONLY. No changes written.")
        con.close()
        return

    print("\nApplying updates in a transaction...")
    psycopg2.extras.execute_batch(
        cur,
        """
        UPDATE qfield_photo_validations
        SET feature_id = %s, feature_type = 'pole', checklist_step = %s,
            -- force civil work_type: these are pole-audit steps from MAMPoles.gpkg
            -- civil columns. A pre-existing 'activation' work_type would make the
            -- works-qa sync treat the photo as OPTICAL (dome_NN), not civil.
            work_type = 'pole_installation'
        WHERE id = %s
        """,
        [(label, step, _id) for (_id, label, step, _old) in updates],
    )
    con.commit()
    print(f"Committed {len(updates)} updates.")
    con.close()


if __name__ == "__main__":
    main()
