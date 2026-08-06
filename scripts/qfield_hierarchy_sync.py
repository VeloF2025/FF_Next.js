"""Persist verified QField audit hierarchy into FibreFlow QA rows.

⚠️ WRITE DIRECTION DEPENDS ON WHO OWNS THE ZONE. Read `plan_owns_hierarchy()` before
touching any statement here — the COALESCE argument order is chosen per project, not
fixed, and getting it backwards silently corrupts data in one direction or freezes it
in the other.

  project HAS a plan  ->  COALESCE(existing, gpkg)   BACKFILL: fill NULLs, never
                                                     overwrite what the plan owns
  project has NO plan ->  COALESCE(gpkg, existing)   AUTHORITATIVE: the GPKG is the
                                                     only zone source there is

Both halves are load-bearing, and each was a real incident:

* Backfill (plan exists). Measured 2026-08-06, Thembisa POP 3: this module was
  unconditionally `COALESCE(gpkg, existing)`. The audit layer's zone_no/pon_no
  attributes are stale on a replanned project, so one extractor run rewrote 98 poles
  the replan import had just corrected — TEM.P.I544 zone 66 -> 62, TEM.P.M040 zone
  69 -> 6. Nothing errored; the plan silently reverted.

* Authoritative (no plan). Making it unconditionally backfill-only was ALSO wrong:
  Mahikeng, Middelburg, Namakgale and Cradock have zero rows in `poles` and zero in
  `v_pole_planning`. Their zone comes from the GPKG `Phase` column and nowhere else —
  there is no replan importer for HT projects. Freezing them at their first-ingest
  zone removes the only correction mechanism those projects have (499 zoned QA rows
  on Mahikeng + Namakgale alone).

So the rule is not "the GPKG is untrustworthy" — it is "the PLAN outranks the GPKG,
where a plan exists". See [[qfield-pole-zone-comes-from-boundaries-not-attributes]] for
why the audit layer's attributes cannot be trusted to overrule a plan.
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


def plan_owns_hierarchy(cur, ff_project_id):
    """True when this project has a plan, so the plan outranks the GPKG.

    A project with rows in `poles` has a design that something else maintains — the
    replan importer, a design GPKG import, or SOW. For those, a field-captured
    attribute must never overrule it.

    A project with NO poles rows has no plan to protect: the audit GPKG is the only
    place its zone/PON has ever come from, so it must stay authoritative or those
    projects can never be corrected again.

    Deliberately keyed on `poles`, not `v_pole_planning`: the view UNIONs `sow_poles`,
    so a project could show planning rows that no writer actually maintains. Presence
    of a real `poles` row is the honest test of "someone owns this plan".
    """
    cur.execute(
        "SELECT EXISTS(SELECT 1 FROM poles WHERE project_id = %s::uuid) AS has_plan",
        (ff_project_id,),
    )
    return bool(cur.fetchone()["has_plan"])


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
    plan_owns = plan_owns_hierarchy(cur, ff_project_id)
    poles_updated = _update_planning_poles(cur, hierarchy_values)
    validated = _validated_pole_labels(cur, ff_project_id, list(hierarchy))
    qa_updated = _upsert_work_qa(cur, hierarchy_values, validated, plan_owns)
    reviews_updated = _update_reviews(cur, hierarchy_values, plan_owns)
    conn.commit()
    return {
        "mapped": len(hierarchy),
        "poles": poles_updated,
        "qa_poles": qa_updated,
        "reviews": reviews_updated,
        "plan_owns": plan_owns,
    }
