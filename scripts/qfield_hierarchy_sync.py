"""Persist verified QField audit hierarchy into FibreFlow QA rows.

⚠️ zone/PON authority is PER-POLE and lives in qfield_hierarchy_writers — read its
docstring before touching any write. In one line: the plan owns a pole if the plan HAS
that pole, otherwise the GPKG does, otherwise leave the value alone.

Both halves are load-bearing and each was a real incident on 2026-08-06. Letting the
GPKG win over a planned pole silently reverted 98 Thembisa POP 3 poles the replan had
just corrected. Letting the plan win over a pole it does not contain skipped 1,190
pole_qa_photos and 1,196 construction_qa_reviews rows that then had no source at all.

See [[qfield-pole-zone-comes-from-boundaries-not-attributes]] for why the audit layer's
attributes cannot be trusted to overrule a plan.
"""
import json
import os
import subprocess
import sys

import psycopg2.extras

from qfield_hierarchy import resolve_hierarchy
from qfield_hierarchy_writers import (
    _update_planning_poles, _update_reviews, _upsert_work_qa, _validated_pole_labels,
)


def hierarchy_backfill_needed(cur, ff_project_id, config):
    """Force one same-version re-scan while photographed HT poles lack zones."""
    if not config.get("zone_col"):
        return False
    cur.execute(
        """
        SELECT EXISTS (
          SELECT 1 FROM pole_qa_photos
          WHERE project_id = %s::uuid AND zone_no IS NULL
        ) AS needed
        """,
        (ff_project_id,),
    )
    return bool(cur.fetchone()["needed"])


def resolve_spatial_pon_map(qf_project_id):
    """Run the read-only design resolver used by QField reconciliation."""
    resolver = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "qfield-recon",
        "resolve_pon_poles.py",
    )
    try:
        result = subprocess.run(
            [sys.executable, resolver, "--project-id", qf_project_id],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            print(f"  WARN: spatial PON resolver failed: {result.stderr.strip()[:200]}")
            return {}
        payload = json.loads(result.stdout)
        if not payload.get("available"):
            print("  WARN: spatial PON design layers unavailable")
            return {}
        pole_map = payload.get("poleToPon", {})
        print(f"  Spatial PON map: {len(pole_map)} poles across "
              f"{len(payload.get('designPons', []))} PONs")
        return pole_map
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as exc:
        print(f"  WARN: spatial PON resolver unavailable: {exc}")
        return {}


def _hierarchy_by_label(rows, label_col, config, spatial_pon_map):
    hierarchy = {}
    for row in rows:
        label = row[label_col] if label_col in row.keys() else None
        if not label:
            continue
        label = str(label).strip()
        if not label:
            continue
        pon_no, zone_no = resolve_hierarchy(
            row,
            label=label,
            pon_col=config.get("pon_col"),
            zone_col=config.get("zone_col"),
            spatial_pon_map=spatial_pon_map,
        )
        if pon_no is not None or zone_no is not None:
            hierarchy[label] = (pon_no, zone_no)
    return hierarchy


def sync_hierarchy(cur, conn, ff_project_id, rows, label_col, config, spatial_pon_map):
    """Sync verified GPKG hierarchy into planning, review, and Work QA rows."""
    hierarchy = _hierarchy_by_label(rows, label_col, config, spatial_pon_map)
    if not hierarchy:
        return {"mapped": 0, "poles": 0, "qa_poles": 0, "reviews": 0}

    hierarchy_values = [
        (ff_project_id, label, zone, pon)
        for label, (pon, zone) in hierarchy.items()
    ]
    poles_updated = _update_planning_poles(cur, hierarchy_values)
    validated = _validated_pole_labels(cur, ff_project_id, list(hierarchy))
    qa_updated = _upsert_work_qa(cur, hierarchy_values, validated)
    reviews_updated = _update_reviews(cur, hierarchy_values)
    conn.commit()
    return {
        "mapped": len(hierarchy),
        "poles": poles_updated,
        "qa_poles": qa_updated,
        "reviews": reviews_updated,
    }
