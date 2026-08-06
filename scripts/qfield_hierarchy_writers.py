#!/usr/bin/env python3
"""The three statements that write zone/PON, split out of qfield_hierarchy_sync.

⚠️ WHO OWNS THE ZONE DECIDES THE DIRECTION. `plan_owns` is not a style flag:

  plan_owns=True   the PLAN is the source. Existing rows are CORRECTED to
                   v_pole_planning, and a new QA row is SEEDED from it. A stale field
                   attribute can never overrule a planned value.
  plan_owns=False  the GPKG is the only source the project has (no rows in `poles`),
                   so it keeps its authority and may overwrite.

Getting it backwards corrupts data one way and freezes it the other. Both failures
happened on 2026-08-06 — see the qfield_hierarchy_sync docstring for the incident, and
scripts/test_qfield_hierarchy_backfill.py for the executable contract.

`_update_planning_poles` takes no `plan_owns`: it can only match a `poles` row, and
plan_owns is False exactly when there are none.
"""
import psycopg2.extras


def _update_planning_poles(cur, hierarchy_values):
    """Backfill only — the GPKG fills a NULL and never overwrites a planned value.

    No authority switch here, unlike the QA and review writers. `plan_owns_hierarchy()`
    is False exactly when the project has no rows in `poles`, and this statement can
    only ever match a `poles` row — so on a no-plan project it matches nothing whatever
    the COALESCE order. An authority parameter would be unreachable code pretending to
    be a decision.
    """
    changed = psycopg2.extras.execute_values(
        cur,
        """
        UPDATE poles AS p SET
          pon_no = COALESCE(p.pon_no, h.pon_no::integer),
          zone_no = COALESCE(p.zone_no, h.zone_no::integer),
          updated_at = NOW()
        FROM (VALUES %s) AS h(project_id, pole_label, zone_no, pon_no)
        WHERE p.project_id = h.project_id::uuid
          AND p.pole_number = h.pole_label
          AND (
            p.pon_no IS DISTINCT FROM COALESCE(p.pon_no, h.pon_no::integer)
            OR p.zone_no IS DISTINCT FROM COALESCE(p.zone_no, h.zone_no::integer)
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


def _upsert_work_qa(cur, hierarchy_values, validated_labels, plan_owns):
    """Create missing QA rows, then align existing ones with whoever owns the zone.

    Deliberately two statements. A single ON CONFLICT cannot express this: the INSERT
    wants "plan, else GPKG" (so a photographed-but-unplanned pole still gets a zone),
    while the UPDATE wants "plan, else leave alone" (so the GPKG cannot overwrite a
    planned value). Both read EXCLUDED, so one expression cannot serve both.
    """
    qa_values = [
        value for value in hierarchy_values if value[1] in validated_labels
    ]
    if not qa_values:
        return 0

    # 1. Seed new rows. With a plan, seed FROM the plan and fall back to the GPKG for a
    #    pole the plan does not cover. Seeding straight from the GPKG is what left 86
    #    rows on Thembisa POP 3 disagreeing with the plan — two of them
    #    (TEM.P.M074/M075) for labels the plan does not contain at all, which inflated
    #    PON 818's pole count.
    seed_zone = "COALESCE(v.zone_no, s.zone_no)" if plan_owns else "s.zone_no"
    seed_pon = "COALESCE(v.pon_no, s.pon_no)" if plan_owns else "s.pon_no"
    psycopg2.extras.execute_values(
        cur,
        f"""
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT s.project_id::uuid, s.pole_label, {seed_zone}, {seed_pon}
        FROM (VALUES %s) AS s(project_id, pole_label, zone_no, pon_no)
        LEFT JOIN v_pole_planning v
          ON v.project_id = s.project_id::uuid AND v.pole_number = s.pole_label
        ON CONFLICT (project_id, pole_label) DO NOTHING
        """,
        qa_values,
        page_size=200,
    )

    # 2. Correct existing rows. With a plan the PLAN is the source — not the GPKG — so
    #    a row that has drifted is repaired rather than frozen. Without a plan the GPKG
    #    keeps its authority, because nothing else can correct those projects.
    if plan_owns:
        changed = psycopg2.extras.execute_values(
            cur,
            """
            UPDATE pole_qa_photos AS q SET
              zone_no = COALESCE(v.zone_no, q.zone_no),
              pon_no = COALESCE(v.pon_no, q.pon_no),
              updated_at = NOW()
            FROM (VALUES %s) AS s(project_id, pole_label, zone_no, pon_no)
            JOIN v_pole_planning v
              ON v.project_id = s.project_id::uuid AND v.pole_number = s.pole_label
            WHERE q.project_id = s.project_id::uuid
              AND q.pole_label = s.pole_label
              AND (
                q.zone_no IS DISTINCT FROM COALESCE(v.zone_no, q.zone_no)
                OR q.pon_no IS DISTINCT FROM COALESCE(v.pon_no, q.pon_no)
              )
            RETURNING q.pole_label
            """,
            qa_values,
            page_size=200,
            fetch=True,
        )
        return len(changed)

    changed = psycopg2.extras.execute_values(
        cur,
        """
        UPDATE pole_qa_photos AS q SET
          zone_no = COALESCE(s.zone_no::integer, q.zone_no),
          pon_no = COALESCE(s.pon_no::integer, q.pon_no),
          updated_at = NOW()
        FROM (VALUES %s) AS s(project_id, pole_label, zone_no, pon_no)
        WHERE q.project_id = s.project_id::uuid
          AND q.pole_label = s.pole_label
          AND (
            q.zone_no IS DISTINCT FROM COALESCE(s.zone_no::integer, q.zone_no)
            OR q.pon_no IS DISTINCT FROM COALESCE(s.pon_no::integer, q.pon_no)
          )
        RETURNING q.pole_label
        """,
        qa_values,
        page_size=200,
        fetch=True,
    )
    return len(changed)


def _update_reviews(cur, hierarchy_values, plan_owns):
    """Align review rows with whoever owns the zone.

    ⚠️ When the plan owns it, the source here is `v_pole_planning`, NOT the GPKG.
    `construction_qa_reviews` has no other plan-driven writer — the replan importer
    touches `poles` and `pole_qa_photos` only — so if this function merely backfilled
    from the GPKG, a review row that already disagreed with the plan would be frozen
    wrong forever. That is not cosmetic: zoneDeliveryReadRepository gates handover on
    `WHERE zone_no = $2 AND pon_no = $3`, so a mis-filed review blocks its own zone's
    handover and can pass a different zone on the wrong evidence. Measured 2026-08-06:
    114 rows disagreed (Thembisa POP 3 104, Mohadin 8, Mamelodi 2).

    With no plan, the GPKG remains the only source and keeps its authority.
    """
    if plan_owns:
        changed = psycopg2.extras.execute_values(
            cur,
            """
            UPDATE construction_qa_reviews AS r SET
              zone_no = COALESCE(v.zone_no, r.zone_no),
              pon_no = COALESCE(v.pon_no, r.pon_no),
              updated_at = NOW()
            FROM (VALUES %s) AS h(project_id, pole_label, zone_no, pon_no)
            JOIN v_pole_planning v
              ON v.project_id = h.project_id::uuid AND v.pole_number = h.pole_label
            WHERE r.project_id = h.project_id::uuid
              AND r.feature_type = 'pole'
              AND r.feature_id = h.pole_label
              AND (
                r.zone_no IS DISTINCT FROM COALESCE(v.zone_no, r.zone_no)
                OR r.pon_no IS DISTINCT FROM COALESCE(v.pon_no, r.pon_no)
              )
            RETURNING r.id
            """,
            hierarchy_values,
            page_size=200,
            fetch=True,
        )
        return len(changed)

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
