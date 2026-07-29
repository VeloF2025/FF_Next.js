"""Persist verified QField audit hierarchy into FibreFlow QA rows."""
import json
import os
import subprocess
import sys

import psycopg2.extras

from qfield_hierarchy import resolve_hierarchy


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


def _update_planning_poles(cur, hierarchy_values):
    changed = psycopg2.extras.execute_values(
        cur,
        """
        UPDATE poles AS p SET
          pon_no = COALESCE(h.pon_no::integer, p.pon_no),
          zone_no = COALESCE(h.zone_no::integer, p.zone_no),
          updated_at = NOW()
        FROM (VALUES %s) AS h(project_id, pole_label, zone_no, pon_no)
        WHERE p.project_id = h.project_id::uuid
          AND p.pole_number = h.pole_label
          AND (
            p.pon_no IS DISTINCT FROM COALESCE(h.pon_no::integer, p.pon_no)
            OR p.zone_no IS DISTINCT FROM COALESCE(h.zone_no::integer, p.zone_no)
          )
        RETURNING p.id
        """,
        hierarchy_values,
        page_size=200,
        fetch=True,
    )
    return len(changed)


def _validated_pole_labels(cur, ff_project_id, labels):
    cur.execute(
        """
        SELECT DISTINCT q.feature_id
        FROM qfield_photo_validations q
        JOIN qfield_projects qp ON qp.qfield_project_id = q.project_id::text
        JOIN qfield_project_links l ON l.qfield_project_id = qp.id
        WHERE l.fibreflow_project_id = %s::uuid
          AND q.feature_type = 'pole'
          AND q.feature_id = ANY(%s::text[])
        """,
        (ff_project_id, labels),
    )
    return {row["feature_id"] for row in cur.fetchall()}


def _upsert_work_qa(cur, hierarchy_values, validated_labels):
    qa_values = [
        value for value in hierarchy_values if value[1] in validated_labels
    ]
    if not qa_values:
        return 0
    changed = psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        VALUES %s
        ON CONFLICT (project_id, pole_label) DO UPDATE SET
          zone_no = COALESCE(EXCLUDED.zone_no, pole_qa_photos.zone_no),
          pon_no = COALESCE(EXCLUDED.pon_no, pole_qa_photos.pon_no),
          updated_at = NOW()
        WHERE
          pole_qa_photos.zone_no IS DISTINCT FROM
            COALESCE(EXCLUDED.zone_no, pole_qa_photos.zone_no)
          OR pole_qa_photos.pon_no IS DISTINCT FROM
            COALESCE(EXCLUDED.pon_no, pole_qa_photos.pon_no)
        RETURNING pole_label
        """,
        qa_values,
        page_size=200,
        fetch=True,
    )
    return len(changed)


def _update_reviews(cur, hierarchy_values):
    changed = psycopg2.extras.execute_values(
        cur,
        """
        UPDATE construction_qa_reviews AS r SET
          zone_no = COALESCE(h.zone_no::integer, r.zone_no),
          pon_no = COALESCE(h.pon_no::integer, r.pon_no),
          updated_at = NOW()
        FROM (VALUES %s) AS h(project_id, pole_label, zone_no, pon_no)
        WHERE r.project_id = h.project_id::uuid
          AND r.feature_type = 'pole'
          AND r.feature_id = h.pole_label
          AND (
            r.zone_no IS DISTINCT FROM COALESCE(h.zone_no::integer, r.zone_no)
            OR r.pon_no IS DISTINCT FROM COALESCE(h.pon_no::integer, r.pon_no)
          )
        RETURNING r.id
        """,
        hierarchy_values,
        page_size=200,
        fetch=True,
    )
    return len(changed)


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
