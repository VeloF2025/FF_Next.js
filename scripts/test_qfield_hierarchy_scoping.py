#!/usr/bin/env python3
"""Project scoping and the keep-what-you-have fallback, for the hierarchy writers.

Split from test_qfield_hierarchy_backfill because that suite is at the 300-line cap and
these are a distinct concern: not "which source wins" but "which ROWS are touched, and
what survives when neither source speaks".

Both properties were unprotected and were found by mutation, not by reading:

  * Dropping `q.project_id = s.project_id` (or the project half of either LEFT JOIN)
    left the whole backfill suite green. Live, 4 pole labels appear in more than one
    project in `pole_qa_photos` and 4 feature_ids do in `construction_qa_reviews`, so
    an unscoped write reaches another project's rows.
  * Dropping the THIRD COALESCE argument (`q.zone_no` / `r.zone_no`) also left it green.
    That argument is what preserves a column the GPKG is silent about while the OTHER
    column changes — the only shape that both fires the WHERE and depends on the
    fallback. Live, 918 pole_qa_photos and 546 construction_qa_reviews rows have no
    plan row and a non-null pon_no, so wiping it is reachable.
"""
import os
import sys

import psycopg2
import psycopg2.extras

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from qfield_hierarchy_writers import (  # noqa: E402
    _update_planning_poles, _update_reviews, _upsert_work_qa,
)
from replan_test_harness import (  # noqa: E402
    check, finish, hierarchy_fixture, start_pg, teardown_container,
)

SCHEMA = "hierarchy_scoping_test"
PROJECT = "55555555-5555-5555-5555-555555555555"
OTHER = "66666666-6666-6666-6666-666666666666"

# (label, existing zone/pon, gpkg zone/pon, expected zone/pon, why)
#
# No plan row exists for any of these, so the GPKG is the middle COALESCE argument and
# the existing value is the third. Each case changes exactly ONE column, which is what
# forces the other column through the fallback with the WHERE clause already satisfied.
SURVIVAL_CASES = [
    ("KEEPPON",  (5, 70), (7, None), (7, 70), "an existing PON survives a zone-only change"),
    ("KEEPZONE", (5, 70), (None, 71), (5, 71), "an existing zone survives a PON-only change"),
]


def main():
    url = os.environ.get("TEST_DATABASE_URL") or start_pg()
    conn = psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)
    cur = conn.cursor()
    try:
        hierarchy_fixture(cur, SCHEMA)
        conn.commit()
        cur.execute(f"SET search_path TO {SCHEMA}")

        print("a column the GPKG is silent about keeps its existing value:")
        for lab, (ez, ep), _, _, _ in SURVIVAL_CASES:
            cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)"
                        " VALUES (%s,%s,%s,%s)", (PROJECT, lab, ez, ep))
            cur.execute("INSERT INTO construction_qa_reviews"
                        " (project_id, feature_type, feature_id, zone_no, pon_no)"
                        " VALUES (%s,'pole',%s,%s,%s)", (PROJECT, lab, ez, ep))
        conn.commit()
        values = [(PROJECT, lab, gz, gp) for lab, _, (gz, gp), _, _ in SURVIVAL_CASES]
        _upsert_work_qa(cur, values, {lab for lab, *_ in SURVIVAL_CASES})
        _update_reviews(cur, values)
        conn.commit()
        for lab, _, _, (wz, wp), why in SURVIVAL_CASES:
            cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos"
                        " WHERE project_id=%s AND pole_label=%s", (PROJECT, lab))
            r = cur.fetchone()
            check(f"QA: {why} ({lab})", (r["zone_no"], r["pon_no"]) == (wz, wp))
            cur.execute("SELECT zone_no, pon_no FROM construction_qa_reviews"
                        " WHERE project_id=%s AND feature_id=%s", (PROJECT, lab))
            r = cur.fetchone()
            check(f"review: {why} ({lab})", (r["zone_no"], r["pon_no"]) == (wz, wp))

        # Same label, two projects. Only the addressed project may move. Both rows are
        # seeded identically so a leak shows up as the OTHER project's row changing.
        print("\nwrites never cross a project boundary:")
        for proj in (PROJECT, OTHER):
            cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no)"
                        " VALUES (%s,'SHAREDLABEL',%s,%s)",
                        (proj, 66 if proj == PROJECT else 11, 781 if proj == PROJECT else 111))
            cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)"
                        " VALUES (%s,'SHAREDLABEL',1,10)", (proj,))
            cur.execute("INSERT INTO construction_qa_reviews"
                        " (project_id, feature_type, feature_id, zone_no, pon_no)"
                        " VALUES (%s,'pole','SHAREDLABEL',1,10)", (proj,))
        conn.commit()
        _upsert_work_qa(cur, [(PROJECT, "SHAREDLABEL", 62, 745)], {"SHAREDLABEL"})
        _update_reviews(cur, [(PROJECT, "SHAREDLABEL", 62, 745)])
        conn.commit()

        cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos"
                    " WHERE project_id=%s AND pole_label='SHAREDLABEL'", (PROJECT,))
        r = cur.fetchone()
        check("the addressed project's QA row takes its own plan",
              (r["zone_no"], r["pon_no"]) == (66, 781))
        cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos"
                    " WHERE project_id=%s AND pole_label='SHAREDLABEL'", (OTHER,))
        r = cur.fetchone()
        check("another project's QA row with the SAME label is untouched",
              (r["zone_no"], r["pon_no"]) == (1, 10))
        cur.execute("SELECT zone_no, pon_no FROM construction_qa_reviews"
                    " WHERE project_id=%s AND feature_id='SHAREDLABEL'", (PROJECT,))
        r = cur.fetchone()
        check("the addressed project's review takes its own plan",
              (r["zone_no"], r["pon_no"]) == (66, 781))
        cur.execute("SELECT zone_no, pon_no FROM construction_qa_reviews"
                    " WHERE project_id=%s AND feature_id='SHAREDLABEL'", (OTHER,))
        r = cur.fetchone()
        check("another project's review with the SAME feature_id is untouched",
              (r["zone_no"], r["pon_no"]) == (1, 10))

        # The backfill suite only asserts the INSERT half of this return value, so
        # `return len(inserted)` alone survived there: an update-only run would report
        # 0 poles synced while silently rewriting rows.
        print("\nan update-only QA run reports what it changed:")
        cur.execute("UPDATE pole_qa_photos SET zone_no=99, pon_no=999"
                    " WHERE project_id=%s AND pole_label='SHAREDLABEL'", (PROJECT,))
        conn.commit()
        n = _upsert_work_qa(cur, [(PROJECT, "SHAREDLABEL", 62, 745)], {"SHAREDLABEL"})
        conn.commit()
        check("an update-only QA run returns 1, not 0", n == 1)

        # ...and the mirror: a row the UPDATE never touches is still work done. With
        # both sources silent the INSERT seeds NULL and the WHERE correctly declines to
        # fire, so counting only the UPDATE would report 0 for a row that was created.
        n = _upsert_work_qa(cur, [(PROJECT, "NULLSEED", None, None)], {"NULLSEED"})
        conn.commit()
        check("an insert the UPDATE never touches still counts", n == 1)

        # Re-running the identical call must be a no-op. Without the IS DISTINCT FROM
        # guard the UPDATE rewrites every addressed row unconditionally: same values,
        # but a churned updated_at and a count that never falls to zero.
        n = _upsert_work_qa(cur, [(PROJECT, "SHAREDLABEL", 62, 745)], {"SHAREDLABEL"})
        conn.commit()
        check("a second identical QA run returns 0", n == 0)

        # The plan lookup must be scoped too, not just the row being written. Here the
        # ADDRESSED project has no plan row and the OTHER project has one for the same
        # label: an unscoped join silently adopts the other project's plan. Asserting
        # the GPKG fallback makes the failure deterministic — matching on the other
        # project's row would otherwise be an arbitrary pick between two join matches.
        print("\nthe plan lookup is scoped to the addressed project:")
        cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no)"
                    " VALUES (%s,'CROSSPLAN',11,111)", (OTHER,))
        cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)"
                    " VALUES (%s,'CROSSPLAN',1,10)", (PROJECT,))
        cur.execute("INSERT INTO construction_qa_reviews"
                    " (project_id, feature_type, feature_id, zone_no, pon_no)"
                    " VALUES (%s,'pole','CROSSPLAN',1,10)", (PROJECT,))
        conn.commit()
        _upsert_work_qa(cur, [(PROJECT, "CROSSPLAN", 62, 745)], {"CROSSPLAN"})
        _update_reviews(cur, [(PROJECT, "CROSSPLAN", 62, 745)])
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM pole_qa_photos"
                    " WHERE project_id=%s AND pole_label='CROSSPLAN'", (PROJECT,))
        r = cur.fetchone()
        check("QA falls back to the GPKG, not another project's plan",
              (r["zone_no"], r["pon_no"]) == (62, 745))
        cur.execute("SELECT zone_no, pon_no FROM construction_qa_reviews"
                    " WHERE project_id=%s AND feature_id='CROSSPLAN'", (PROJECT,))
        r = cur.fetchone()
        check("review falls back to the GPKG, not another project's plan",
              (r["zone_no"], r["pon_no"]) == (62, 745))
        # validated_labels is a FILTER, but both suites had only ever passed it the full
        # label set — so deleting the filter entirely left every test green. Without it
        # _upsert_work_qa creates a QA row for every pole in the GPKG: on Thembisa POP 3
        # that is 4,590 rows against 340 real ones, inflating the very PON counts this
        # module reports. Exercise it as a filter, with something to reject.
        print("\nvalidated_labels actually filters:")
        n = _upsert_work_qa(cur, [(PROJECT, "UNVALIDATED", 4, 40)], set())
        conn.commit()
        check("a label absent from validated_labels is not written", n == 0)
        cur.execute("SELECT count(*) AS c FROM pole_qa_photos"
                    " WHERE project_id=%s AND pole_label='UNVALIDATED'", (PROJECT,))
        check("  ...and creates no QA row", cur.fetchone()["c"] == 0)
        n = _upsert_work_qa(cur, [(PROJECT, "UNVALIDATED", 4, 40),
                                  (PROJECT, "VALIDATED", 5, 50)], {"VALIDATED"})
        conn.commit()
        check("a mixed batch writes only the validated label", n == 1)
        cur.execute("SELECT count(*) AS c FROM pole_qa_photos"
                    " WHERE project_id=%s AND pole_label='UNVALIDATED'", (PROJECT,))
        check("  ...the unvalidated one is still absent", cur.fetchone()["c"] == 0)

        # The count is keyed on (project_id, pole_label). Keying on the label alone
        # collapses two real rows in two projects into one — the only batch that can
        # show it is one spanning projects, which sync_hierarchy never builds today.
        print("\nthe count does not collapse a label shared across projects:")
        for proj in (PROJECT, OTHER):
            cur.execute("INSERT INTO pole_qa_photos (project_id, pole_label, zone_no, pon_no)"
                        " VALUES (%s,'COUNTED',NULL,NULL)", (proj,))
        conn.commit()
        n = _upsert_work_qa(cur, [(PROJECT, "COUNTED", 3, 33), (OTHER, "COUNTED", 4, 44)],
                            {"COUNTED"})
        conn.commit()
        check("two projects, one label, counts 2 not 1", n == 2)

        # _update_planning_poles was never reached by the scoping property above, so
        # dropping its project predicate survived. No pole_number is currently shared
        # across projects in `poles`, so this is latent rather than live — cover it
        # before that stops being true.
        print("\nthe planning write is scoped to its project too:")
        for proj in (PROJECT, OTHER):
            cur.execute("INSERT INTO poles (project_id, pole_number, zone_no, pon_no)"
                        " VALUES (%s,'PLANSCOPE',NULL,NULL)", (proj,))
        conn.commit()
        _update_planning_poles(cur, [(PROJECT, "PLANSCOPE", 8, 88)])
        conn.commit()
        cur.execute("SELECT zone_no, pon_no FROM poles"
                    " WHERE project_id=%s AND pole_number='PLANSCOPE'", (PROJECT,))
        r = cur.fetchone()
        check("the addressed project's pole is backfilled",
              (r["zone_no"], r["pon_no"]) == (8, 88))
        cur.execute("SELECT zone_no, pon_no FROM poles"
                    " WHERE project_id=%s AND pole_number='PLANSCOPE'", (OTHER,))
        r = cur.fetchone()
        check("another project's pole with the SAME number stays NULL",
              (r["zone_no"], r["pon_no"]) == (None, None))
    finally:
        try:
            cur.execute(f"DROP SCHEMA IF EXISTS {SCHEMA} CASCADE")
            conn.commit()
        finally:
            conn.close()
            teardown_container()

    finish("hierarchy scoping")


if __name__ == "__main__":
    main()
