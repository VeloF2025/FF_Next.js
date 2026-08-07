"""The three statements that write zone/PON, split out of qfield_hierarchy_sync.

⚠️ AUTHORITY IS PER-POLE, NOT PER-PROJECT. Every QA/review write resolves to:

    COALESCE(plan value, gpkg value, existing value)

which reads as one rule: **the plan owns a pole if the plan HAS that pole; otherwise
the GPKG does; otherwise leave it alone.** Three behaviours fall out of it, and all
three are required — each was a real incident on 2026-08-06:

  pole IS in the plan      plan wins, so a stale field attribute can never overrule it.
                           (An earlier version let the GPKG win and silently reverted 98
                           Thembisa POP 3 poles the replan had just corrected —
                           TEM.P.I544 zone 66 -> 62, TEM.P.M040 zone 69 -> 6.)

  pole is NOT in the plan   the GPKG wins, because it is the only source that pole has.
                           (An earlier version INNER JOINed the plan, which skipped these
                           rows entirely: 1,190 pole_qa_photos and 1,196
                           construction_qa_reviews rows on plan-owning projects have no
                           plan row and a NULL zone, and could never be filled again.)

  neither has a value       keep what is there.

A project-level "does this project have a plan" switch was tried and removed: it is just
this rule with worse resolution. A project with no plan is simply one where no pole is in
the plan, so the GPKG wins for all of them — Mahikeng, Middelburg, Namakgale and Cradock
(0 rows in `poles`) keep their only correction mechanism with no special case, and there
is no second code path to leave untested.

`_update_planning_poles` is different and stays BACKFILL-ONLY: it writes the plan itself,
so the GPKG may fill a NULL there but must never overwrite.

⚠️ `feature_type = 'pole'` in the review writer is load-bearing, not defensive: review
rows of other feature types share `feature_id` values with pole labels in the same
project (21 live), and dropping the filter would rewrite their zones from pole data.

⚠️ Ordering note: `_update_planning_poles` runs first, so a GPKG value it writes into a
NULL plan cell becomes "the plan" for the QA/review writers later in the same
transaction. That is intended — the invariant is that all three tables agree with the
plan once the run completes — but it does mean a GPKG value can reach a QA row that
already held a different value, via the plan.

⚠️ `v_pole_planning` prefers `sow_poles` over `poles` per column, while
`_update_planning_poles` writes `poles`. On a project carrying both, the QA/review rows
therefore follow SOW where it has a value and `poles` where it does not — which is the
intended precedence, but means `poles` and the QA tables can hold different values for a
pole SOW covers and `poles` does not.

The executable contract is scripts/test_qfield_hierarchy_backfill.py.
"""
import psycopg2.extras


def _update_planning_poles(cur, hierarchy_values):
    """Backfill the plan itself — fill a NULL, never overwrite.

    No authority switch: this can only match a `poles` row, and it writes the very
    table the other two writers treat as authoritative.
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


def _upsert_work_qa(cur, hierarchy_values, validated_labels):
    """Create missing QA rows, then align every row with plan-then-GPKG.

    The INSERT deliberately seeds zone/PON as NULL and lets the UPDATE below resolve
    them, so precedence is decided in exactly ONE place. Resolving it in the INSERT too
    would be unverifiable dead logic: the UPDATE recomputes every row this statement
    inserts, in the same call, so any precedence bug seeded here is overwritten before
    the transaction ends and no test could observe it. A NULL seed always differs from
    a resolved value, so the UPDATE's WHERE fires on each new row; when the plan and
    the GPKG are both silent it stays NULL, which is the same outcome either way.
    """
    qa_values = [
        value for value in hierarchy_values if value[1] in validated_labels
    ]
    if not qa_values:
        return 0

    inserted = psycopg2.extras.execute_values(
        cur,
        """
        INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)
        SELECT s.project_id::uuid, s.pole_label, NULL::integer, NULL::integer
        FROM (VALUES %s) AS s(project_id, pole_label, zone_no, pon_no)
        ON CONFLICT (project_id, pole_label) DO NOTHING
        RETURNING pole_label
        """,
        qa_values,
        page_size=200,
        fetch=True,
    )

    updated = psycopg2.extras.execute_values(
        cur,
        """
        UPDATE pole_qa_photos AS q SET
          zone_no = COALESCE(v.zone_no, s.zone_no::integer, q.zone_no),
          pon_no = COALESCE(v.pon_no, s.pon_no::integer, q.pon_no),
          updated_at = NOW()
        FROM (VALUES %s) AS s(project_id, pole_label, zone_no, pon_no)
        LEFT JOIN v_pole_planning v
          ON v.project_id = s.project_id::uuid AND v.pole_number = s.pole_label
        WHERE q.project_id = s.project_id::uuid
          AND q.pole_label = s.pole_label
          AND (
            q.zone_no IS DISTINCT FROM COALESCE(v.zone_no, s.zone_no::integer, q.zone_no)
            OR q.pon_no IS DISTINCT FROM COALESCE(v.pon_no, s.pon_no::integer, q.pon_no)
          )
        RETURNING q.pole_label
        """,
        qa_values,
        page_size=200,
        fetch=True,
    )
    # DISTINCT labels, not a sum: seeding the INSERT with NULLs means the UPDATE fires
    # on every row this call just inserted, so adding the two counts reports each new
    # row twice. The caller logs this as `qa_poles`, so a sum would overstate the work
    # done — and a run that inserted 40 rows and changed nothing else would claim 80.
    return len({row["pole_label"] for row in inserted}
               | {row["pole_label"] for row in updated})


def _update_reviews(cur, hierarchy_values):
    """Align pole review rows with plan-then-GPKG.

    `construction_qa_reviews` has no other plan-driven writer — the replan importer
    touches `poles` and `pole_qa_photos` only — so if this merely backfilled, a review
    that disagreed with the plan would stay wrong forever. That is load-bearing:
    zoneDeliveryReadRepository gates handover on `WHERE zone_no = $2 AND pon_no = $3`,
    so a mis-filed review blocks its own zone and its evidence can pass another.
    """
    changed = psycopg2.extras.execute_values(
        cur,
        """
        UPDATE construction_qa_reviews AS r SET
          zone_no = COALESCE(v.zone_no, h.zone_no::integer, r.zone_no),
          pon_no = COALESCE(v.pon_no, h.pon_no::integer, r.pon_no),
          updated_at = NOW()
        FROM (VALUES %s) AS h(project_id, pole_label, zone_no, pon_no)
        LEFT JOIN v_pole_planning v
          ON v.project_id = h.project_id::uuid AND v.pole_number = h.pole_label
        WHERE r.project_id = h.project_id::uuid
          AND r.feature_type = 'pole'
          AND r.feature_id = h.pole_label
          AND (
            r.zone_no IS DISTINCT FROM COALESCE(v.zone_no, h.zone_no::integer, r.zone_no)
            OR r.pon_no IS DISTINCT FROM COALESCE(v.pon_no, h.pon_no::integer, r.pon_no)
          )
        RETURNING r.id
        """,
        hierarchy_values,
        page_size=200,
        fetch=True,
    )
    return len(changed)
